use crate::{
    Options,
    renderer::{Renderer, Stats},
};
use anyhow::Result;
use cpu_time::ProcessTime;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{path::Path, time::Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub pose: usize,
    pub render_ms: f64,
    pub wait_ms: f64,
    #[serde(flatten)]
    pub stats: Stats,
    pub gpu_ms: Option<[f64; 5]>,
}
pub struct Measurement {
    start: Instant,
    cpu: ProcessTime,
    pub samples: Vec<Sample>,
}
impl Measurement {
    pub fn start(capacity: usize) -> Self {
        Self {
            start: Instant::now(),
            cpu: ProcessTime::now(),
            samples: Vec::with_capacity(capacity),
        }
    }
    pub fn finish(
        &self,
        r: &Renderer,
        options: &Options,
        mode: &str,
        present: Option<String>,
    ) -> Result<serde_json::Value> {
        // Boundaries are after GPU drain; exclude JSON/hash/file I/O and captures.
        let elapsed_ms = self.start.elapsed().as_secs_f64() * 1000.;
        let cpu_ms = self.cpu.elapsed().as_secs_f64() * 1000.;
        let n = self.samples.len();
        let source_hash = format!(
            "{:x}",
            Sha256::new()
                .chain_update(include_str!("main.rs"))
                .chain_update(include_str!("math.rs"))
                .chain_update(include_str!("scene.rs"))
                .chain_update(include_str!("renderer.rs"))
                .chain_update(include_str!("measure.rs"))
                .chain_update(include_str!("shader.wgsl"))
                .chain_update(include_str!("../Cargo.lock"))
                .chain_update(include_str!("../Cargo.toml"))
                .finalize()
        );
        let binary_hash = format!(
            "{:x}",
            Sha256::digest(std::fs::read(std::env::current_exe()?)?)
        );
        let info = &r.gpu.info;
        let report = json!({"mode":mode,"frames":n,"warmup":options.warmup,"width":r.width,"height":r.height,"format":format!("{:?}",r.format),"presentMode":present,"inFlight":if options.gpu {1}else{options.in_flight},"gpuDiagnostic":options.gpu,"frozenPose":r.freeze,
            "elapsedMs":elapsed_ms,"msPerFrame":elapsed_ms/n as f64,"processCpuMsPerFrame":cpu_ms/n as f64,"meanRenderMs":self.samples.iter().map(|s|s.render_ms).sum::<f64>()/n as f64,"meanExplicitWaitMs":self.samples.iter().map(|s|s.wait_ms).sum::<f64>()/n as f64,
            "datasetSha256":r.scene.hash,"nativeSourceSha256":source_hash,"wgpu":"30.0.1","build":if cfg!(debug_assertions){"debug"}else{"release"},"apiValidation":true,"vulkanValidationLayersRequested":options.validation,"nativeBinarySha256":binary_hash,
            "adapterInfo":{"name":info.name,"vendor":info.vendor,"device":info.device,"deviceType":format!("{:?}",info.device_type),"driver":info.driver,"driverInfo":info.driver_info,"backend":format!("{:?}",info.backend)},
            "scene":{"nodes":r.scene.meta.nodes.len(),"meshes":r.scene.meta.meshes.len(),"groups":r.scene.meta.meshes.iter().map(|m|m.ranges.len()).sum::<usize>(),"bakedFrames":r.scene.meta.frame_count,"storageInstanceSets":r.scene.meta.meshes.iter().filter(|m|m.storage_instances).count()},
            "publicationPlan":{"writesPerFrame":3+r.scene.spans.len(),"bytesPerFrame":r.scene.bones.len()*4+r.scene.spans.iter().map(|s|s.len()*4).sum::<usize>()+2*68*4,"submitsPerFrame":1,"bindGroupsPerFrame":12},
            "shadowMatrices":r.scene.shadows,"light":r.scene.light,"samples":self.samples,"errors":[],"limitations":["Limited recorded scene renderer, not the full game.","Native Vulkan/WGPU and browser Dawn/compositing differ; not an isolated language benchmark.","Process CPU sums threads, not elapsed time or pure renderer CPU.","GPU timestamp diagnostics are separate from uninstrumented primary runs; no presentation timing."]});
        if let Some(path) = &options.out {
            std::fs::write(path, serde_json::to_vec_pretty(&report)?)?;
        }
        eprintln!(
            "{mode}: {n} frames, {:.4} ms/frame, {:.4} render-call ms, {:.4} process CPU-ms/frame",
            report["msPerFrame"].as_f64().unwrap(),
            report["meanRenderMs"].as_f64().unwrap(),
            report["processCpuMsPerFrame"].as_f64().unwrap()
        );
        Ok(report)
    }
}
pub fn captures(r: &mut Renderer, options: &Options) -> Result<()> {
    if let Some(dir) = &options.capture {
        std::fs::create_dir_all(dir)?;
        for &pose in &options.poses {
            let path = dir.join(format!("native-{}-p{pose}.png", options.agents));
            r.capture(pose, Path::new(&path))?;
            eprintln!("Capture: {}", path.display());
        }
    }
    Ok(())
}
