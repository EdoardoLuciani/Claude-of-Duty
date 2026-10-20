use crate::{math::IDENTITY, scene::Scene};
use serde_json::{Value, json};
fn translation(x: f64) -> [f64; 16] {
    let mut m = IDENTITY;
    m[12] = x;
    m
}
fn fixture() -> (tempfile::TempDir, Value, Vec<u8>) {
    let dir = tempfile::tempdir().unwrap();
    let mut binary = vec![0u8; 168];
    let mut append = |bytes: &[u8]| {
        let section = json!({"offset":binary.len(),"bytes":bytes.len()});
        binary.extend_from_slice(bytes);
        section
    };
    let indices = append(bytemuck::cast_slice(&[0u32, 1, 2]));
    let frames = append(bytemuck::cast_slice(
        &[
            translation(1.).map(|x| x as f32),
            translation(2.).map(|x| x as f32),
        ]
        .concat(),
    ));
    let visibility = append(bytemuck::cast_slice(&[1u32, 0]));
    let cameras = append(bytemuck::cast_slice(
        &[IDENTITY.map(|x| x as f32); 8].concat(),
    ));
    let instances = append(bytemuck::cast_slice(
        &[
            IDENTITY.map(|x| x as f32),
            translation(7.).map(|x| x as f32),
        ]
        .concat(),
    ));
    let mesh = json!({"node":2,"geometry":0,"scene":0,"ranges":[{"start":0,"count":3,"material":0}],"castShadow":true,"skinned":true,"skeleton":0,"bind":IDENTITY,"bindInverse":IDENTITY,"detached":false,"storageInstances":true,"instances":instances,"count":2,"sphere":[0.,0.,0.,1.],"cull":true});
    let mut other = mesh.clone();
    other["node"] = json!(0);
    other["skinned"] = json!(false);
    other["instances"] = Value::Null;
    other["count"] = json!(1);
    other["storageInstances"] = json!(false);
    let meta = json!({"version":1,"frameCount":2,"nodes":[{"parent":-1,"bone":false,"matrix":translation(3.),"visible":true},{"parent":0,"bone":true,"matrix":IDENTITY,"visible":true},{"parent":1,"bone":false,"matrix":translation(10.),"visible":true}],"meshes":[mesh,other],"geometries":[{"vertex":{"offset":0,"bytes":168},"index":indices,"vertices":3,"indices":3}],"skeletons":[{"bones":[1],"inverses":[IDENTITY]}],"materials":[{"color":[1.,0.,0.],"side":0}],"dynamic":[1],"frames":frames,"visibility":visibility,"cameras":cameras});
    (dir, meta, binary)
}
fn save(dir: &std::path::Path, meta: &Value, binary: &[u8]) {
    std::fs::write(dir.join("scene-5.json"), serde_json::to_vec(meta).unwrap()).unwrap();
    std::fs::write(dir.join("scene-5.bin"), binary).unwrap();
}
#[test]
fn hierarchy_instances_palettes_and_sparse_publication() {
    let (dir, meta, binary) = fixture();
    save(dir.path(), &meta, &binary);
    let mut s = Scene::load(dir.path(), 5).unwrap();
    assert_eq!(s.hash.len(), 64);
    assert_eq!(s.bases, vec![0, 2]);
    assert_eq!(s.spans, vec![0..128]);
    s.update(0, false);
    assert_eq!(s.world[2][12], 14.);
    assert_eq!(s.models[12], 14.);
    assert_eq!(s.models[64 + 12], 21.);
    assert_eq!(s.models[64 + 48 + 12], -21.);
    assert_eq!(s.models[128 + 12], 3.);
    assert_eq!(s.bones[12], 4.);
    assert!(s.active[2]);
    s.update(1, false);
    assert_eq!(s.models[12], 15.);
    assert_eq!(s.models[64 + 12], 22.);
    assert_eq!(s.bones[12], 5.);
    assert!(!s.active[2]);
    assert!(s.active[0]);
    s.update(2, false);
    assert_eq!(s.bones[12], 4.);
    assert!(s.active[2]);
}
#[test]
fn frozen_pose_changes_only_bone_input_not_visibility() {
    let (dir, meta, binary) = fixture();
    save(dir.path(), &meta, &binary);
    let mut s = Scene::load(dir.path(), 5).unwrap();
    s.update(0, false);
    let bones = s.bones.clone();
    s.update(1, true);
    assert_eq!(s.bones, bones);
    assert!(!s.active[2]);
    s.update(1, false);
    assert_ne!(s.bones, bones);
}
#[test]
fn detached_bind_inverse_is_recorded_not_recomputed() {
    let (dir, mut meta, binary) = fixture();
    meta["meshes"][0]["detached"] = json!(true);
    meta["meshes"][0]["bindInverse"] = json!(translation(123.));
    save(dir.path(), &meta, &binary);
    let mut s = Scene::load(dir.path(), 5).unwrap();
    s.update(1, false);
    assert_eq!(s.models[48 + 12], 123.);
}
#[test]
fn malformed_recordings_are_rejected() {
    let (dir, meta, binary) = fixture();
    for mutate in [
        |m: &mut Value| m["version"] = json!(2),
        |m: &mut Value| m["nodes"][0]["parent"] = json!(1),
        |m: &mut Value| m["frames"]["offset"] = json!(1),
        |m: &mut Value| m["cameras"]["bytes"] = json!(4),
        |m: &mut Value| m["dynamic"][0] = json!(999),
        |m: &mut Value| m["meshes"][0]["ranges"][0]["count"] = json!(6),
        |m: &mut Value| m["meshes"][0]["count"] = json!(3),
        |m: &mut Value| m["meshes"][0]["skeleton"] = json!(-1),
    ] {
        let mut bad = meta.clone();
        mutate(&mut bad);
        save(dir.path(), &bad, &binary);
        assert!(
            Scene::load(dir.path(), 5).is_err(),
            "accepted malformed recording: {bad}"
        );
    }
    let mut bad = binary.clone();
    let offset = meta["geometries"][0]["index"]["offset"].as_u64().unwrap() as usize;
    bad[offset..offset + 4].copy_from_slice(&999u32.to_le_bytes());
    save(dir.path(), &meta, &bad);
    assert!(Scene::load(dir.path(), 5).is_err());
    let mut bad = binary;
    let offset = meta["frames"]["offset"].as_u64().unwrap() as usize;
    bad[offset..offset + 4].copy_from_slice(&f32::NAN.to_le_bytes());
    save(dir.path(), &meta, &bad);
    assert!(Scene::load(dir.path(), 5).is_err());
}
