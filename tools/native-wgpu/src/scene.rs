use crate::math::{self, IDENTITY, Mat};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

#[derive(Deserialize)]
pub struct Section {
    pub offset: usize,
    pub bytes: usize,
}
#[derive(Deserialize)]
pub struct Node {
    pub parent: i32,
    pub bone: bool,
    pub matrix: Mat,
    pub visible: bool,
}
#[derive(Deserialize)]
pub struct Range {
    pub start: u32,
    pub count: u32,
    pub material: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesh {
    pub node: usize,
    pub geometry: usize,
    pub scene: usize,
    pub ranges: Vec<Range>,
    pub cast_shadow: bool,
    pub skinned: bool,
    pub skeleton: i32,
    pub bind: Option<Mat>,
    pub bind_inverse: Option<Mat>,
    pub detached: bool,
    pub storage_instances: bool,
    pub instances: Option<Section>,
    pub count: u32,
    pub sphere: [f64; 4],
    pub cull: bool,
}
#[derive(Deserialize)]
pub struct Geometry {
    pub vertex: Section,
    pub index: Section,
    pub vertices: usize,
    pub indices: usize,
}
#[derive(Deserialize)]
pub struct Skeleton {
    pub bones: Vec<usize>,
    pub inverses: Vec<Mat>,
}
#[derive(Deserialize)]
pub struct Material {
    pub color: [f32; 3],
    pub side: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub version: u32,
    pub frame_count: usize,
    pub nodes: Vec<Node>,
    pub meshes: Vec<Mesh>,
    pub geometries: Vec<Geometry>,
    pub skeletons: Vec<Skeleton>,
    pub materials: Vec<Material>,
    pub dynamic: Vec<usize>,
    pub frames: Section,
    pub visibility: Section,
    pub cameras: Section,
}
pub struct Scene {
    pub meta: Meta,
    pub binary: Vec<u8>,
    pub hash: String,
    pub frames: Vec<f32>,
    pub visibility: Vec<u32>,
    pub cameras: Vec<f32>,
    pub instances: Vec<Option<Vec<f32>>>,
    pub locals: Vec<Mat>,
    pub world: Vec<Mat>,
    pub visible: Vec<bool>,
    pub active: Vec<bool>,
    pub dirty: Vec<bool>,
    pub bone_offsets: Vec<usize>,
    pub bones: Vec<f32>,
    pub bases: Vec<usize>,
    pub models: Vec<f32>,
    pub spans: Vec<std::ops::Range<usize>>,
    pub shadows: [Mat; 3],
    pub light: [f32; 4],
    pub frusta: [[f64; 24]; 5],
    pub uniforms: [[f32; 68]; 5],
}
fn section<'a>(binary: &'a [u8], s: &Section) -> Result<&'a [u8]> {
    let end = s.offset.checked_add(s.bytes).context("section overflow")?;
    ensure!(
        s.offset.is_multiple_of(4) && s.bytes.is_multiple_of(4) && end <= binary.len(),
        "invalid binary section"
    );
    Ok(&binary[s.offset..end])
}
fn floats(binary: &[u8], s: &Section) -> Result<Vec<f32>> {
    let v: Vec<_> = section(binary, s)?
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    ensure!(v.iter().all(|x| x.is_finite()), "nonfinite scene input");
    Ok(v)
}
impl Scene {
    pub fn load(path: &Path, agents: u32) -> Result<Self> {
        let json = fs::read(path.join(format!("scene-{agents}.json")))
            .context("read scene JSON; export dataset from direct-WebGPU prototype first")?;
        let binary = fs::read(path.join(format!("scene-{agents}.bin")))?;
        let hash = format!(
            "{:x}",
            Sha256::new()
                .chain_update(&json)
                .chain_update(&binary)
                .finalize()
        );
        let meta: Meta = serde_json::from_slice(&json)?;
        ensure!(
            meta.version == 1 && meta.frame_count > 0 && !meta.nodes.is_empty(),
            "unsupported/empty scene"
        );
        for (i, n) in meta.nodes.iter().enumerate() {
            ensure!(
                n.parent >= -1 && n.parent < (i as i32) && n.matrix.iter().all(|x| x.is_finite()),
                "invalid node {i}"
            );
        }
        for &n in &meta.dynamic {
            ensure!(n < meta.nodes.len(), "invalid dynamic node");
        }
        for g in &meta.geometries {
            ensure!(
                g.vertex.bytes == g.vertices * 56 && g.index.bytes == g.indices * 4,
                "geometry layout"
            );
            section(&binary, &g.vertex)?;
            for b in section(&binary, &g.index)?.as_chunks::<4>().0 {
                ensure!(
                    (u32::from_le_bytes(*b) as usize) < g.vertices,
                    "invalid index"
                );
            }
        }
        for s in &meta.skeletons {
            ensure!(
                !s.bones.is_empty()
                    && s.bones.len() == s.inverses.len()
                    && s.bones.iter().all(|&n| n < meta.nodes.len()),
                "invalid skeleton"
            );
        }
        ensure!(
            meta.materials
                .iter()
                .all(|m| m.side <= 2 && m.color.iter().all(|x| x.is_finite())),
            "invalid material"
        );
        let mut instances = Vec::new();
        let mut model_count = 0usize;
        for m in &meta.meshes {
            ensure!(
                m.node < meta.nodes.len()
                    && m.geometry < meta.geometries.len()
                    && m.scene < 2
                    && m.count > 0,
                "invalid mesh"
            );
            ensure!(
                m.sphere.iter().all(|x| x.is_finite()) && m.sphere[3] >= 0.,
                "invalid sphere"
            );
            for r in &m.ranges {
                ensure!(
                    r.material < meta.materials.len()
                        && r.count % 3 == 0
                        && (r.start as u64 + r.count as u64)
                            <= meta.geometries[m.geometry].indices as u64,
                    "invalid draw range"
                );
            }
            if m.skinned {
                ensure!(
                    m.skeleton >= 0
                        && (m.skeleton as usize) < meta.skeletons.len()
                        && m.bind.is_some()
                        && m.bind_inverse.is_some(),
                    "invalid skinned mesh"
                );
            }
            let v = m
                .instances
                .as_ref()
                .map(|s| floats(&binary, s))
                .transpose()?;
            ensure!(
                v.as_ref()
                    .map_or(m.count == 1, |v| v.len() == m.count as usize * 16),
                "instance layout"
            );
            model_count = model_count
                .checked_add(m.count as usize)
                .context("model count overflow")?;
            instances.push(v);
        }
        ensure!(
            model_count > 0 && model_count * 256 <= 128 * 1024 * 1024,
            "object storage exceeds baseline WebGPU limit"
        );
        let frames = floats(&binary, &meta.frames)?;
        let cameras = floats(&binary, &meta.cameras)?;
        let visibility: Vec<_> = section(&binary, &meta.visibility)?
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b))
            .collect();
        ensure!(
            frames.len() == meta.frame_count * meta.dynamic.len() * 16
                && visibility.len() == meta.frame_count * meta.dynamic.len()
                && cameras.len() == meta.frame_count * 64,
            "frame section lengths"
        );
        let mut dirty = vec![false; meta.nodes.len()];
        for &n in &meta.dynamic {
            dirty[n] = true;
        }
        for (i, n) in meta.nodes.iter().enumerate() {
            if n.parent >= 0 {
                dirty[i] |= dirty[n.parent as usize];
            }
        }
        let mut bone_offsets = Vec::new();
        let mut bone_count = 0;
        for s in &meta.skeletons {
            bone_offsets.push(bone_count);
            bone_count += s.bones.len();
        }
        ensure!(bone_count > 0, "bone table must be nonempty");
        let mut bases = Vec::new();
        let mut base = 0;
        let mut spans: Vec<std::ops::Range<usize>> = Vec::new();
        for m in &meta.meshes {
            bases.push(base);
            if dirty[m.node] {
                let start = base * 64;
                let end = (base + m.count as usize) * 64;
                if let Some(last) = spans.last_mut().filter(|r| r.end == start) {
                    last.end = end
                } else {
                    spans.push(start..end);
                }
            }
            base += m.count as usize;
        }
        let (shadows, light) = math::shadow_matrices(&cameras[..16]);
        let mut uniforms = [[0.; 68]; 5];
        let mut frusta = [[0.; 24]; 5];
        for p in 0..5 {
            for (s, vp) in shadows.iter().enumerate() {
                for (j, x) in vp.iter().enumerate() {
                    uniforms[p][16 + s * 16 + j] = *x as f32;
                }
            }
            uniforms[p][64..].copy_from_slice(&light);
            if p < 3 {
                for (j, x) in shadows[p].iter().enumerate() {
                    uniforms[p][j] = *x as f32;
                }
                frusta[p] = math::planes(&shadows[p]);
            }
        }
        let locals = meta.nodes.iter().map(|n| n.matrix).collect();
        let visible = meta.nodes.iter().map(|n| n.visible).collect();
        let len = meta.nodes.len();
        let mut scene = Self {
            meta,
            binary,
            hash,
            frames,
            visibility,
            cameras,
            instances,
            locals,
            world: vec![IDENTITY; len],
            visible,
            active: vec![false; len],
            dirty,
            bone_offsets,
            bones: vec![0.; bone_count * 16],
            bases,
            models: vec![0.; model_count * 64],
            spans,
            shadows,
            light,
            frusta,
            uniforms,
        };
        scene.update_world(true);
        for i in 0..scene.meta.meshes.len() {
            scene.publish_models(i);
        }
        Ok(scene)
    }
    fn update_world(&mut self, all: bool) {
        for i in 0..self.world.len() {
            let p = self.meta.nodes[i].parent;
            if all || self.dirty[i] {
                self.world[i] = if p < 0 {
                    self.locals[i]
                } else {
                    math::multiply(&self.world[p as usize], &self.locals[i])
                };
            }
            self.active[i] = self.visible[i] && (p < 0 || self.active[p as usize]);
        }
    }
    fn publish_models(&mut self, index: usize) {
        let m = &self.meta.meshes[index];
        for instance in 0..m.count as usize {
            let w = if let Some(instances) = &self.instances[index] {
                let local = std::array::from_fn(|j| instances[instance * 16 + j] as f64);
                math::multiply(&self.world[m.node], &local)
            } else {
                self.world[m.node]
            };
            let inverse = math::inverse(&w);
            let at = (self.bases[index] + instance) * 64;
            for j in 0..16 {
                self.models[at + j] = w[j] as f32;
                self.models[at + 16 + j] = inverse[(j % 4) * 4 + j / 4] as f32;
                self.models[at + 32 + j] = m.bind.as_ref().unwrap_or(&IDENTITY)[j] as f32;
                self.models[at + 48 + j] = if m.detached {
                    m.bind_inverse.as_ref().unwrap_or(&IDENTITY)[j]
                } else {
                    inverse[j]
                } as f32;
            }
        }
    }
    pub fn update(&mut self, index: usize, freeze: bool) {
        let frame = index % self.meta.frame_count;
        for (i, &n) in self.meta.dynamic.iter().enumerate() {
            let at = (frame * self.meta.dynamic.len() + i) * 16;
            if !freeze || !self.meta.nodes[n].bone {
                for j in 0..16 {
                    self.locals[n][j] = self.frames[at + j] as f64;
                }
            }
            self.visible[n] = self.visibility[frame * self.meta.dynamic.len() + i] != 0;
        }
        self.update_world(false);
        for (i, s) in self.meta.skeletons.iter().enumerate() {
            for (b, &n) in s.bones.iter().enumerate() {
                let m = math::multiply(&self.world[n], &s.inverses[b]);
                for (j, x) in m.iter().enumerate() {
                    self.bones[(self.bone_offsets[i] + b) * 16 + j] = *x as f32;
                }
            }
        }
        for i in 0..self.meta.meshes.len() {
            if self.dirty[self.meta.meshes[i].node] {
                self.publish_models(i);
            }
        }
        for scene in 0..2 {
            let at = frame * 64 + scene * 32;
            let camera = std::array::from_fn(|j| self.cameras[at + j] as f64);
            let projection = std::array::from_fn(|j| self.cameras[at + 16 + j] as f64);
            let vp = math::multiply(&projection, &math::inverse(&camera));
            for (j, x) in vp.iter().enumerate() {
                self.uniforms[scene + 3][j] = *x as f32;
            }
            self.frusta[scene + 3] = math::planes(&vp);
        }
    }
}
