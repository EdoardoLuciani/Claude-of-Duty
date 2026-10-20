// Double-precision CPU transforms, as in the JS prototype; glam owns the math.
// Publication explicitly rounds to f32. No hand-written matrix implementation.
use glam::{DMat4, DVec3};
pub type Mat = [f64; 16];
pub const IDENTITY: Mat = DMat4::IDENTITY.to_cols_array();
pub fn multiply(a: &Mat, b: &Mat) -> Mat {
    (DMat4::from_cols_array(a) * DMat4::from_cols_array(b)).to_cols_array()
}
pub fn inverse(a: &Mat) -> Mat {
    let m = DMat4::from_cols_array(a);
    // The input sequence can contain zero-scale hidden objects. Match the
    // prototype's defined zero result rather than publishing NaNs to the GPU.
    if m.determinant() == 0. {
        [0.; 16]
    } else {
        m.inverse().to_cols_array()
    }
}
pub fn shadow_matrices(camera: &[f32]) -> ([Mat; 3], [f32; 4]) {
    let light = DVec3::new(0.4, 0.8, 0.45).normalize();
    let target = DVec3::new(
        camera[12] as f64 - camera[8] as f64 * 22.,
        camera[13] as f64 - 1.,
        camera[14] as f64 - camera[10] as f64 * 22.,
    );
    let view = DMat4::look_at_rh(target + light * 130., target, DVec3::Y);
    let matrices = [18., 45., 100.].map(|extent| {
        (DMat4::orthographic_rh(-extent, extent, -extent, extent, 0.1, 300.) * view).to_cols_array()
    });
    (
        matrices,
        [light.x as f32, light.y as f32, light.z as f32, 0.22],
    )
}
pub fn planes(matrix: &Mat) -> [f64; 24] {
    let m = DMat4::from_cols_array(matrix).transpose();
    // WebGPU clip space has z in [0,w], not OpenGL's [-w,w].
    let rows = [
        m.w_axis + m.x_axis,
        m.w_axis - m.x_axis,
        m.w_axis + m.y_axis,
        m.w_axis - m.y_axis,
        m.z_axis,
        m.w_axis - m.z_axis,
    ];
    let mut out = [0.; 24];
    for (p, v) in rows.iter().enumerate() {
        out[p * 4..p * 4 + 4].copy_from_slice(&(*v / v.truncate().length()).to_array());
    }
    out
}
pub fn intersects(s: &[f64; 4], w: &Mat, f: &[f64; 24]) -> bool {
    let m = DMat4::from_cols_array(w);
    let center = m.transform_point3(DVec3::new(s[0], s[1], s[2]));
    let radius = s[3]
        * m.x_axis
            .truncate()
            .length_squared()
            .max(m.y_axis.truncate().length_squared())
            .max(m.z_axis.truncate().length_squared())
            .sqrt();
    f.as_chunks::<4>()
        .0
        .iter()
        .all(|p| DVec3::new(p[0], p[1], p[2]).dot(center) + p[3] >= -radius)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn affine_roundtrip() {
        let mut m = IDENTITY;
        m[0] = 2.;
        m[5] = 3.;
        m[10] = 4.;
        m[12] = 7.;
        m[13] = -3.;
        for (a, b) in multiply(&m, &inverse(&m)).iter().zip(IDENTITY) {
            assert!((a - b).abs() < 1e-12);
        }
    }
    #[test]
    fn singular_is_defined() {
        assert_eq!(inverse(&[0.; 16]), [0.; 16]);
    }
    #[test]
    fn webgpu_near_far() {
        let p = DMat4::orthographic_rh(-1., 1., -1., 1., 0.1, 300.).to_cols_array();
        let f = planes(&p);
        assert!(intersects(&[0., 0., -2., 0.1], &IDENTITY, &f));
        assert!(!intersects(&[0., 0., 1., 0.1], &IDENTITY, &f));
        assert!(!intersects(&[0., 0., -301., 0.1], &IDENTITY, &f));
    }
}
