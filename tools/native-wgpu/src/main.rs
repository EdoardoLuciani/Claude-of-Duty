mod math;
mod measure;
mod renderer;
mod scene;
#[cfg(test)]
mod scene_tests;

use anyhow::{Context, Result, ensure};
use clap::{Parser, ValueEnum};
use measure::{Measurement, Sample};
use renderer::{Gpu, Renderer};
use std::{collections::VecDeque, path::PathBuf, sync::Arc, time::Instant};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{Key, NamedKey},
    window::{Window, WindowId},
};

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Present {
    Fifo,
    Immediate,
    Mailbox,
}
#[derive(Parser, Debug)]
#[command(
    about = "Native Rust/WGPU port of the recorded direct-WebGPU scene experiment. No JavaScript runtime."
)]
struct Options {
    #[arg(long)]
    data: PathBuf,
    #[arg(long, default_value_t = 5)]
    agents: u32,
    /// Offscreen throughput benchmark; default is an animated desktop window.
    #[arg(long)]
    benchmark: bool,
    /// Measured frames (default 900 offscreen, unlimited interactive window).
    #[arg(long)]
    frames: Option<usize>,
    #[arg(long, default_value_t = 120)]
    warmup: usize,
    #[arg(long, default_value_t = 1920)]
    width: u32,
    #[arg(long, default_value_t = 1080)]
    height: u32,
    /// Explicit queue-completion bound, not an unbounded enqueue-only benchmark.
    #[arg(long,default_value_t=2,value_parser=clap::value_parser!(u32).range(1..=16))]
    in_flight: u32,
    #[arg(long,value_enum,default_value_t=Present::Fifo)]
    present: Present,
    #[arg(long)]
    adapter: Option<String>,
    /// Separate diagnostic: GPU timestamps, one completed frame at a time.
    #[arg(long)]
    gpu: bool,
    /// Enable Vulkan validation layers (not used in primary timings). WGPU API validation is always on.
    #[arg(long)]
    validation: bool,
    #[arg(long)]
    freeze: bool,
    #[arg(long)]
    out: Option<PathBuf>,
    /// Write offscreen GPU-output PNGs here after measurement, not during it.
    #[arg(long)]
    capture: Option<PathBuf>,
    #[arg(long, value_delimiter = ',', default_value = "0,60,119")]
    poses: Vec<usize>,
}
fn instance(validation: bool) -> wgpu::Instance {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = wgpu::Backends::VULKAN;
    // This flag controls Vulkan layers, not wgpu-core's safe API validation.
    desc.flags = if validation {
        wgpu::InstanceFlags::VALIDATION
    } else {
        wgpu::InstanceFlags::empty()
    };
    wgpu::Instance::new(desc)
}
fn drain_oldest(
    r: &Renderer,
    pending: &mut VecDeque<wgpu::SubmissionIndex>,
    limit: u32,
) -> Result<()> {
    if pending.len() >= limit as usize {
        r.gpu.wait(pending.pop_front())?;
    }
    Ok(())
}
fn benchmark(options: &Options) -> Result<()> {
    ensure!(
        !cfg!(debug_assertions),
        "benchmark requires cargo run --release"
    );
    let data = scene::Scene::load(&options.data, options.agents)?;
    let instance = instance(options.validation);
    let (gpu, _) = pollster::block_on(Gpu::new(
        &instance,
        None,
        options.adapter.as_deref(),
        options.gpu,
    ))?;
    let mut r = Renderer::new(
        gpu,
        data,
        options.width,
        options.height,
        wgpu::TextureFormat::Bgra8Unorm,
        options.gpu,
        options.freeze,
    )?;
    let target = renderer::texture(
        &r.gpu.device,
        options.width,
        options.height,
        r.format,
        wgpu::TextureUsages::RENDER_ATTACHMENT,
    );
    let view = target.create_view(&Default::default());
    let limit = if options.gpu { 1 } else { options.in_flight };
    let mut pending = VecDeque::with_capacity(limit as usize + 1);
    for i in 0..options.warmup {
        let (index, _) = r.render(i, &view)?;
        pending.push_back(index);
        drain_oldest(&r, &mut pending, limit)?;
    }
    r.gpu.wait(None)?;
    pending.clear();
    let frames = options.frames.unwrap_or(900);
    let mut m = Measurement::start(frames);
    for i in 0..frames {
        let start = Instant::now();
        let (index, stats) = r.render(i, &view)?;
        let render_ms = start.elapsed().as_secs_f64() * 1000.;
        pending.push_back(index);
        let start = Instant::now();
        drain_oldest(&r, &mut pending, limit)?;
        let gpu_ms = r.gpu_times()?;
        m.samples.push(Sample {
            pose: i % r.scene.meta.frame_count,
            render_ms,
            wait_ms: start.elapsed().as_secs_f64() * 1000.,
            stats,
            gpu_ms,
        });
    }
    r.gpu.wait(None)?;
    m.finish(&r, options, "offscreen", None)?;
    measure::captures(&mut r, options)?;
    Ok(())
}
struct Desktop {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
    iteration: usize,
    measurement: Option<Measurement>,
    pending: VecDeque<wgpu::SubmissionIndex>,
    clock: Instant,
    title_clock: Instant,
    title_frames: usize,
}
struct App {
    options: Options,
    desktop: Option<Desktop>,
    failure: Option<String>,
}
impl App {
    fn open(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        let window = Arc::new(
            event_loop.create_window(
                Window::default_attributes()
                    .with_title("Rust / WGPU recorded scene — Escape to close")
                    .with_inner_size(winit::dpi::PhysicalSize::new(
                        self.options.width,
                        self.options.height,
                    )),
            )?,
        );
        let size = window.inner_size();
        let instance = instance(self.options.validation);
        let surface = instance.create_surface(window.clone())?;
        let (gpu, adapter) = pollster::block_on(Gpu::new(
            &instance,
            Some(&surface),
            self.options.adapter.as_deref(),
            self.options.gpu,
        ))?;
        let caps = surface.get_capabilities(&adapter);
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .context("surface configuration")?;
        config.format = caps
            .formats
            .iter()
            .copied()
            .find(|f| {
                matches!(
                    f,
                    wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
                )
            })
            .context("surface must support non-sRGB target: shader already encodes gamma")?;
        config.present_mode = match self.options.present {
            Present::Fifo => wgpu::PresentMode::Fifo,
            Present::Immediate => wgpu::PresentMode::Immediate,
            Present::Mailbox => wgpu::PresentMode::Mailbox,
        };
        ensure!(
            caps.present_modes.contains(&config.present_mode),
            "requested presentation mode unavailable: {:?}; supported {:?}",
            config.present_mode,
            caps.present_modes
        );
        config.desired_maximum_frame_latency = self.options.in_flight;
        surface.configure(&gpu.device, &config);
        let data = scene::Scene::load(&self.options.data, self.options.agents)?;
        let renderer = Renderer::new(
            gpu,
            data,
            config.width,
            config.height,
            config.format,
            self.options.gpu,
            self.options.freeze,
        )?;
        eprintln!(
            "Desktop: {}x{} {:?}, supported {:?}",
            config.width, config.height, config.present_mode, caps.present_modes
        );
        self.desktop = Some(Desktop {
            window,
            surface,
            config,
            renderer,
            iteration: 0,
            measurement: None,
            pending: VecDeque::with_capacity(17),
            clock: Instant::now(),
            title_clock: Instant::now(),
            title_frames: 0,
        });
        Ok(())
    }
    fn redraw(&mut self) -> Result<bool> {
        let d = self.desktop.as_mut().unwrap();
        if d.config.width == 0 || d.config.height == 0 {
            return Ok(false);
        }
        let finite = self.options.frames.is_some();
        if finite && d.iteration == self.options.warmup && d.measurement.is_none() {
            d.renderer.gpu.wait(None)?;
            d.pending.clear();
            d.measurement = Some(Measurement::start(self.options.frames.unwrap()));
        }
        let texture = match d.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                d.surface.configure(&d.renderer.gpu.device, &d.config);
                return Ok(false);
            }
            other => anyhow::bail!("surface acquisition failed: {other:?}"),
        };
        let pose = if finite {
            if d.iteration < self.options.warmup {
                d.iteration
            } else {
                d.iteration - self.options.warmup
            }
        } else {
            (d.clock.elapsed().as_secs_f64() * 60.) as usize
        };
        let start = Instant::now();
        let (index, stats) = d
            .renderer
            .render(pose, &texture.texture.create_view(&Default::default()))?;
        let render_ms = start.elapsed().as_secs_f64() * 1000.;
        d.window.pre_present_notify();
        d.renderer.gpu.queue.present(texture);
        d.pending.push_back(index);
        let start = Instant::now();
        drain_oldest(
            &d.renderer,
            &mut d.pending,
            if self.options.gpu {
                1
            } else {
                self.options.in_flight
            },
        )?;
        let gpu_ms = d.renderer.gpu_times()?;
        if let Some(m) = &mut d.measurement {
            m.samples.push(Sample {
                pose: pose % d.renderer.scene.meta.frame_count,
                render_ms,
                wait_ms: start.elapsed().as_secs_f64() * 1000.,
                stats,
                gpu_ms,
            });
        }
        d.iteration += 1;
        d.title_frames += 1;
        if d.title_clock.elapsed().as_secs_f64() >= 1. {
            let fps = d.title_frames as f64 / d.title_clock.elapsed().as_secs_f64();
            d.window.set_title(&format!("Rust / WGPU — {} agents — {fps:.0} presented fps — {render_ms:.3} ms encode/submit — Escape to close",self.options.agents));
            d.title_clock = Instant::now();
            d.title_frames = 0;
        }
        if let Some(frames) = self.options.frames
            && d.iteration >= self.options.warmup + frames
        {
            d.renderer.gpu.wait(None)?;
            d.measurement.as_ref().unwrap().finish(
                &d.renderer,
                &self.options,
                "window",
                Some(format!("{:?}", d.config.present_mode)),
            )?;
            measure::captures(&mut d.renderer, &self.options)?;
            return Ok(true);
        }
        Ok(false)
    }
    fn fail(&mut self, error: anyhow::Error, event_loop: &ActiveEventLoop) {
        self.failure = Some(format!("{error:#}"));
        event_loop.exit();
    }
}
impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.desktop.is_none()
            && let Err(e) = self.open(event_loop)
        {
            self.fail(e, event_loop);
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested
            | WindowEvent::KeyboardInput {
                event:
                    winit::event::KeyEvent {
                        logical_key: Key::Named(NamedKey::Escape),
                        state: ElementState::Pressed,
                        ..
                    },
                ..
            } => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(d) = &mut self.desktop {
                    if self.options.frames.is_some()
                        && d.measurement.is_some()
                        && (size.width != d.config.width || size.height != d.config.height)
                    {
                        self.fail(
                            anyhow::anyhow!("window resized during measurement"),
                            event_loop,
                        );
                        return;
                    }
                    d.config.width = size.width;
                    d.config.height = size.height;
                    if size.width > 0 && size.height > 0 {
                        d.surface.configure(&d.renderer.gpu.device, &d.config);
                        d.renderer.resize(size.width, size.height);
                    }
                }
            }
            WindowEvent::RedrawRequested => match self.redraw() {
                Ok(true) => event_loop.exit(),
                Ok(false) => {}
                Err(e) => self.fail(e, event_loop),
            },
            _ => {}
        }
    }
    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(d) = &self.desktop {
            d.window.request_redraw();
        }
    }
}
fn main() -> Result<()> {
    let options = Options::parse();
    ensure!([5, 12].contains(&options.agents), "agents must be 5 or 12");
    ensure!(
        options.width > 0 && options.height > 0 && options.frames != Some(0),
        "nonzero dimensions/frame count required"
    );
    if let Some(out) = &options.out {
        std::fs::write(out, b"{\"failure\":\"incomplete\"}")?;
    }
    if options.benchmark {
        benchmark(&options)
    } else {
        let event_loop = EventLoop::new()?;
        let mut app = App {
            options,
            desktop: None,
            failure: None,
        };
        event_loop.run_app(&mut app)?;
        if let Some(e) = app.failure {
            anyhow::bail!(e)
        }
        Ok(())
    }
}
