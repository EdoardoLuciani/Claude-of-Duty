use crate::{math, scene::Scene};
use anyhow::{Context, Result, ensure};
use serde::Serialize;
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use wgpu::util::DeviceExt;

pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub info: wgpu::AdapterInfo,
    errors: Arc<Mutex<Vec<String>>>,
}
impl Gpu {
    pub async fn new(
        instance: &wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
        name: Option<&str>,
        timestamps: bool,
    ) -> Result<(Self, wgpu::Adapter)> {
        let adapters = instance.enumerate_adapters(wgpu::Backends::VULKAN).await;
        let mut adapters: Vec<_> = adapters
            .into_iter()
            .filter(|a| {
                a.get_info().device_type != wgpu::DeviceType::Cpu
                    && surface.is_none_or(|s| a.is_surface_supported(s))
                    && name.is_none_or(|n| {
                        a.get_info().name.to_lowercase().contains(&n.to_lowercase())
                    })
            })
            .collect();
        adapters.sort_by_key(|a| {
            if a.get_info().device_type == wgpu::DeviceType::DiscreteGpu {
                0
            } else {
                1
            }
        });
        let adapter = adapters
            .into_iter()
            .next()
            .context("no matching hardware Vulkan adapter; refusing CPU fallback")?;
        let info = adapter.get_info();
        let features = if timestamps {
            wgpu::Features::TIMESTAMP_QUERY
        } else {
            wgpu::Features::empty()
        };
        ensure!(
            adapter.features().contains(features),
            "adapter lacks timestamp queries"
        );
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("native renderer lab"),
                required_features: features,
                ..Default::default()
            })
            .await?;
        let errors = Arc::new(Mutex::new(Vec::new()));
        let handler = errors.clone();
        device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
            handler.lock().unwrap().push(e.to_string())
        }));
        let handler = errors.clone();
        device.set_device_lost_callback(move |reason, message| {
            if reason != wgpu::DeviceLostReason::Destroyed {
                handler
                    .lock()
                    .unwrap()
                    .push(format!("device lost {reason:?}: {message}"));
            }
        });
        eprintln!(
            "Adapter: {} / {} / {} ({:?})",
            info.name, info.driver, info.driver_info, info.backend
        );
        Ok((
            Self {
                device,
                queue,
                info,
                errors,
            },
            adapter,
        ))
    }
    pub fn check(&self) -> Result<()> {
        ensure!(
            self.errors.lock().unwrap().is_empty(),
            "GPU errors: {:?}",
            self.errors.lock().unwrap()
        );
        Ok(())
    }
    pub fn wait(&self, index: Option<wgpu::SubmissionIndex>) -> Result<()> {
        self.device.poll(wgpu::PollType::Wait {
            submission_index: index,
            timeout: Some(Duration::from_secs(60)),
        })?;
        self.check()
    }
}
fn buffer(
    device: &wgpu::Device,
    label: &str,
    data: &[u8],
    usage: wgpu::BufferUsages,
) -> wgpu::Buffer {
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(label),
        contents: data,
        usage: usage | wgpu::BufferUsages::COPY_DST,
    })
}
pub fn texture(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub draws: [u64; 5],
    pub triangles: [u64; 5],
}
struct Draw {
    mesh: usize,
    range: usize,
    first: u32,
    side: usize,
}
struct Geometry {
    vertex: wgpu::Buffer,
    index: wgpu::Buffer,
}
struct Timing {
    queries: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
}
pub struct Renderer {
    pub gpu: Gpu,
    pub scene: Scene,
    pub format: wgpu::TextureFormat,
    pub width: u32,
    pub height: u32,
    geometry: Vec<Geometry>,
    models: wgpu::Buffer,
    bones: wgpu::Buffer,
    instances: wgpu::Buffer,
    frame_buffers: Vec<wgpu::Buffer>,
    frame_groups: Vec<wgpu::BindGroup>,
    objects: wgpu::BindGroup,
    colors: wgpu::BindGroup,
    shadow_depth: Vec<wgpu::TextureView>,
    shadow_color: Vec<wgpu::TextureView>,
    depth: wgpu::TextureView,
    pipelines: Vec<wgpu::RenderPipeline>,
    draws: Vec<Draw>,
    timing: Option<Timing>,
    pub freeze: bool,
}
impl Renderer {
    pub fn new(
        gpu: Gpu,
        scene: Scene,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        timestamps: bool,
        freeze: bool,
    ) -> Result<Self> {
        ensure!(
            width > 0
                && height > 0
                && width <= gpu.device.limits().max_texture_dimension_2d
                && height <= gpu.device.limits().max_texture_dimension_2d,
            "unsupported output dimensions"
        );
        let d = &gpu.device;
        let geometry = scene
            .meta
            .geometries
            .iter()
            .map(|g| Geometry {
                vertex: buffer(
                    d,
                    "geometry",
                    &scene.binary[g.vertex.offset..g.vertex.offset + g.vertex.bytes],
                    wgpu::BufferUsages::VERTEX,
                ),
                index: buffer(
                    d,
                    "indices",
                    &scene.binary[g.index.offset..g.index.offset + g.index.bytes],
                    wgpu::BufferUsages::INDEX,
                ),
            })
            .collect();
        let models = buffer(
            d,
            "object table",
            bytemuck::cast_slice(&scene.models),
            wgpu::BufferUsages::STORAGE,
        );
        let bones = buffer(
            d,
            "bone palettes",
            bytemuck::cast_slice(&scene.bones),
            wgpu::BufferUsages::STORAGE,
        );
        let mut records: Vec<u32> = Vec::new();
        let mut draws = Vec::new();
        for (i, m) in scene.meta.meshes.iter().enumerate() {
            for (r, range) in m.ranges.iter().enumerate() {
                let first = (records.len() / 4) as u32;
                for n in 0..m.count as usize {
                    records.extend_from_slice(&[
                        (scene.bases[i] + n) as u32,
                        range.material as u32,
                        if m.skinned {
                            scene.bone_offsets[m.skeleton as usize] as u32
                        } else {
                            u32::MAX
                        },
                        0,
                    ]);
                }
                draws.push(Draw {
                    mesh: i,
                    range: r,
                    first,
                    side: scene.meta.materials[range.material].side,
                });
            }
        }
        let instances = buffer(
            d,
            "draw-instance records",
            bytemuck::cast_slice(&records),
            wgpu::BufferUsages::VERTEX,
        );
        let colors: Vec<f32> = scene
            .meta
            .materials
            .iter()
            .flat_map(|m| [m.color[0], m.color[1], m.color[2], 1.])
            .collect();
        let gpu_colors = buffer(
            d,
            "surface colors",
            bytemuck::cast_slice(&colors),
            wgpu::BufferUsages::STORAGE,
        );
        let shadow_depth: Vec<_> = (0..3)
            .map(|_| {
                texture(
                    d,
                    1024,
                    1024,
                    wgpu::TextureFormat::Depth32Float,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                )
                .create_view(&Default::default())
            })
            .collect();
        // Match the actual JS implementation, including its three dummy color
        // attachments (the older experiment README incorrectly calls it depth-only).
        let shadow_color = (0..3)
            .map(|_| {
                texture(
                    d,
                    1024,
                    1024,
                    wgpu::TextureFormat::Rgba8Unorm,
                    wgpu::TextureUsages::RENDER_ATTACHMENT,
                )
                .create_view(&Default::default())
            })
            .collect();
        let depth = texture(
            d,
            width,
            height,
            wgpu::TextureFormat::Depth32Float,
            wgpu::TextureUsages::RENDER_ATTACHMENT,
        )
        .create_view(&Default::default());
        let buffer_entry = |binding, visibility, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Buffer {
                ty,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let frame_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[buffer_entry(
                0,
                wgpu::ShaderStages::VERTEX_FRAGMENT,
                wgpu::BufferBindingType::Uniform,
            )],
        });
        let object_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                buffer_entry(
                    0,
                    wgpu::ShaderStages::VERTEX,
                    wgpu::BufferBindingType::Storage { read_only: true },
                ),
                buffer_entry(
                    1,
                    wgpu::ShaderStages::VERTEX,
                    wgpu::BufferBindingType::Storage { read_only: true },
                ),
            ],
        });
        let mut entries: Vec<_> = (0..3)
            .map(|binding| wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Depth,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            })
            .collect();
        entries.push(buffer_entry(
            3,
            wgpu::ShaderStages::FRAGMENT,
            wgpu::BufferBindingType::Storage { read_only: true },
        ));
        let color_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &entries,
        });
        let objects = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &object_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: models.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: bones.as_entire_binding(),
                },
            ],
        });
        let mut entries: Vec<_> = shadow_depth
            .iter()
            .enumerate()
            .map(|(i, v)| wgpu::BindGroupEntry {
                binding: i as u32,
                resource: wgpu::BindingResource::TextureView(v),
            })
            .collect();
        entries.push(wgpu::BindGroupEntry {
            binding: 3,
            resource: gpu_colors.as_entire_binding(),
        });
        let colors = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &color_layout,
            entries: &entries,
        });
        let frame_buffers: Vec<_> = scene
            .uniforms
            .iter()
            .map(|v| {
                buffer(
                    d,
                    "frame",
                    bytemuck::cast_slice(v),
                    wgpu::BufferUsages::UNIFORM,
                )
            })
            .collect();
        let frame_groups = frame_buffers
            .iter()
            .map(|b| {
                d.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &frame_layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: b.as_entire_binding(),
                    }],
                })
            })
            .collect();
        let shader = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("prototype WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let vertices = wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x3,2=>Uint32x4,3=>Float32x4];
        let record = wgpu::vertex_attr_array![4=>Uint32x4];
        let mut pipelines = Vec::new();
        for shadow in [true, false] {
            for side in 0..3 {
                let layouts = if shadow {
                    vec![Some(&frame_layout), Some(&object_layout)]
                } else {
                    vec![
                        Some(&frame_layout),
                        Some(&object_layout),
                        Some(&color_layout),
                    ]
                };
                let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &layouts,
                    immediate_size: 0,
                });
                pipelines.push(d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: None,
                    layout: Some(&layout),
                    vertex: wgpu::VertexState {
                        module: &shader,
                        entry_point: Some("vs"),
                        compilation_options: Default::default(),
                        buffers: &[
                            Some(wgpu::VertexBufferLayout {
                                array_stride: 56,
                                step_mode: wgpu::VertexStepMode::Vertex,
                                attributes: &vertices,
                            }),
                            Some(wgpu::VertexBufferLayout {
                                array_stride: 16,
                                step_mode: wgpu::VertexStepMode::Instance,
                                attributes: &record,
                            }),
                        ],
                    },
                    primitive: wgpu::PrimitiveState {
                        cull_mode: match side {
                            0 => Some(wgpu::Face::Back),
                            1 => Some(wgpu::Face::Front),
                            _ => None,
                        },
                        ..Default::default()
                    },
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth32Float,
                        depth_write_enabled: Some(true),
                        depth_compare: Some(wgpu::CompareFunction::Less),
                        stencil: Default::default(),
                        bias: Default::default(),
                    }),
                    multisample: Default::default(),
                    fragment: Some(wgpu::FragmentState {
                        module: &shader,
                        entry_point: Some(if shadow { "fs_depth" } else { "fs" }),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: if shadow {
                                wgpu::TextureFormat::Rgba8Unorm
                            } else {
                                format
                            },
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    multiview_mask: None,
                    cache: None,
                }));
            }
        }
        let timing = timestamps.then(|| Timing {
            queries: d.create_query_set(&wgpu::QuerySetDescriptor {
                label: None,
                ty: wgpu::QueryType::Timestamp,
                count: 10,
            }),
            resolve: d.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 80,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            read: d.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 80,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }),
        });
        gpu.check()?;
        Ok(Self {
            gpu,
            scene,
            format,
            width,
            height,
            geometry,
            models,
            bones,
            instances,
            frame_buffers,
            frame_groups,
            objects,
            colors,
            shadow_depth,
            shadow_color,
            depth,
            pipelines,
            draws,
            timing,
            freeze,
        })
    }
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.depth = texture(
            &self.gpu.device,
            width,
            height,
            wgpu::TextureFormat::Depth32Float,
            wgpu::TextureUsages::RENDER_ATTACHMENT,
        )
        .create_view(&Default::default());
    }
    pub fn render(
        &mut self,
        index: usize,
        output: &wgpu::TextureView,
    ) -> Result<(wgpu::SubmissionIndex, Stats)> {
        self.gpu.check()?;
        self.scene.update(index, self.freeze);
        let s = &self.scene;
        let q = &self.gpu.queue;
        q.write_buffer(&self.bones, 0, bytemuck::cast_slice(&s.bones));
        for span in &s.spans {
            q.write_buffer(
                &self.models,
                (span.start * 4) as u64,
                bytemuck::cast_slice(&s.models[span.clone()]),
            );
        }
        for p in 3..5 {
            q.write_buffer(
                &self.frame_buffers[p],
                0,
                bytemuck::cast_slice(&s.uniforms[p]),
            );
        }
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        let mut stats = Stats::default();
        for p in 0..5 {
            let shadow = p < 3;
            let color = if shadow {
                &self.shadow_color[p]
            } else {
                output
            };
            let depth = if shadow {
                &self.shadow_depth[p]
            } else {
                &self.depth
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(["shadow-0", "shadow-1", "shadow-2", "world", "view"][p]),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: color,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if p == 4 {
                            wgpu::LoadOp::Load
                        } else {
                            wgpu::LoadOp::Clear(if shadow {
                                wgpu::Color::BLACK
                            } else {
                                wgpu::Color {
                                    r: 0.38,
                                    g: 0.5,
                                    b: 0.65,
                                    a: 1.,
                                }
                            })
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: self
                    .timing
                    .as_ref()
                    .map(|t| wgpu::RenderPassTimestampWrites {
                        query_set: &t.queries,
                        beginning_of_pass_write_index: Some((p * 2) as u32),
                        end_of_pass_write_index: Some((p * 2 + 1) as u32),
                    }),
                ..Default::default()
            });
            pass.set_bind_group(0, &self.frame_groups[p], &[]);
            pass.set_bind_group(1, &self.objects, &[]);
            if !shadow {
                pass.set_bind_group(2, &self.colors, &[]);
            }
            pass.set_vertex_buffer(1, self.instances.slice(..));
            let mut last_geometry = usize::MAX;
            let mut last_pipeline = usize::MAX;
            for draw in &self.draws {
                let m = &s.meta.meshes[draw.mesh];
                if m.scene != usize::from(p == 4)
                    || !s.active[m.node]
                    || (shadow && !m.cast_shadow)
                    || (m.cull && !math::intersects(&m.sphere, &s.world[m.node], &s.frusta[p]))
                {
                    continue;
                }
                let pipeline = if shadow { draw.side } else { 3 + draw.side };
                if pipeline != last_pipeline {
                    pass.set_pipeline(&self.pipelines[pipeline]);
                    last_pipeline = pipeline;
                }
                if m.geometry != last_geometry {
                    let g = &self.geometry[m.geometry];
                    pass.set_vertex_buffer(0, g.vertex.slice(..));
                    pass.set_index_buffer(g.index.slice(..), wgpu::IndexFormat::Uint32);
                    last_geometry = m.geometry;
                }
                let r = &m.ranges[draw.range];
                pass.draw_indexed(
                    r.start..r.start + r.count,
                    0,
                    draw.first..draw.first + m.count,
                );
                stats.draws[p] += 1;
                stats.triangles[p] += r.count as u64 / 3 * m.count as u64;
            }
        }
        if let Some(t) = &self.timing {
            encoder.resolve_query_set(&t.queries, 0..10, &t.resolve, 0);
            encoder.copy_buffer_to_buffer(&t.resolve, 0, &t.read, 0, 80);
        }
        Ok((q.submit([encoder.finish()]), stats))
    }
    pub fn gpu_times(&self) -> Result<Option<[f64; 5]>> {
        let Some(t) = &self.timing else {
            return Ok(None);
        };
        let (tx, rx) = std::sync::mpsc::channel();
        t.read.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.gpu.wait(None)?;
        rx.recv()??;
        let data = t.read.slice(..).get_mapped_range()?;
        let values: Vec<u64> = data
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| u64::from_le_bytes(*b))
            .collect();
        let times = std::array::from_fn(|p| {
            (values[p * 2 + 1] - values[p * 2]) as f64
                * self.gpu.queue.get_timestamp_period() as f64
                / 1e6
        });
        drop(data);
        t.read.unmap();
        Ok(Some(times))
    }
    pub fn capture(&mut self, pose: usize, path: &Path) -> Result<()> {
        let target = texture(
            &self.gpu.device,
            self.width,
            self.height,
            self.format,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        );
        let (submit, _) = self.render(pose, &target.create_view(&Default::default()))?;
        self.gpu.wait(Some(submit))?;
        let stride = (self.width * 4).div_ceil(256) * 256;
        let read = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: stride as u64 * self.height as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &read,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: None,
                },
            },
            target.size(),
        );
        self.gpu.queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        read.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.gpu.wait(None)?;
        rx.recv()??;
        let data = read.slice(..).get_mapped_range()?;
        let mut pixels = Vec::with_capacity((self.width * self.height * 4) as usize);
        for row in data.chunks_exact(stride as usize) {
            pixels.extend_from_slice(&row[..self.width as usize * 4]);
        }
        drop(data);
        read.unmap();
        if self.format == wgpu::TextureFormat::Bgra8Unorm {
            for p in pixels.as_chunks_mut::<4>().0 {
                p.swap(0, 2);
            }
        }
        ensure!(
            pixels
                .as_chunks::<4>()
                .0
                .iter()
                .any(|p| p[..3] != pixels[..3]),
            "blank capture"
        );
        let file = std::io::BufWriter::new(std::fs::File::create(path)?);
        let mut encoder = png::Encoder::new(file, self.width, self.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header()?.write_image_data(&pixels)?;
        Ok(())
    }
}
