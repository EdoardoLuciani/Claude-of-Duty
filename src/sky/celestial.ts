import * as THREE from 'three';

/** Solar/lunar altitude and azimuth derive from site latitude, date and local solar hour.
 * Azimuth: north=-Z at 0 degrees, east=+X at 90 degrees; northAngle rotates art direction.
 * The authored 45N solstice site places sunset near 19.71 solar hours.
 */

export const SITE = {
  latitudeDeg: 45.0,
  dayOfYear: 172, // summer solstice
  /** Rotates north in world space. 0 keeps north at -Z. */
  northAngleDeg: 0,
  /** Moon hour-angle offset and declination in degrees. 244 / +28 places the moon
   * at altitude 22 / azimuth 288 in the 01:30 capture, with a visible terminator.
   */
  moonHourOffsetDeg: 244.0,
  moonDeclinationDeg: 28.0,
};

interface CelestialSite {
  latitudeDeg: number;
  dayOfYear: number;
  northAngleDeg: number;
  moonHourOffsetDeg: number;
  moonDeclinationDeg: number;
}
interface AltAzResult {
  alt: number;
  az: number;
}
const DEG = Math.PI / 180;

/** Solar declination, Cooper's approximation. */
export function solarDeclination(dayOfYear: number): number {
  return 23.44 * DEG * Math.sin(((2 * Math.PI) / 365) * (284 + dayOfYear));
}

/**
 * Altitude/azimuth for a body at a given hour angle and declination.
 * `hourAngle` in radians, 0 at local meridian, positive in the afternoon.
 */
export function altAz(
  hourAngle: number,
  declination: number,
  latitudeDeg: number,
  out: AltAzResult = { alt: 0, az: 0 }
): AltAzResult {
  const lat = latitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinD = Math.sin(declination);
  const cosD = Math.cos(declination);
  const sinAlt = sinLat * sinD + cosLat * cosD * Math.cos(hourAngle);
  const alt = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));
  const cosAlt = Math.cos(alt);
  let cosAz = 0;
  if (cosAlt > 1e-6 && cosLat > 1e-6) {
    cosAz = (sinD - sinAlt * sinLat) / (cosAlt * cosLat);
  }
  let az = Math.acos(THREE.MathUtils.clamp(cosAz, -1, 1));
  // Hour angle positive = past the meridian = western half of the sky.
  if (Math.sin(hourAngle) > 0) az = 2 * Math.PI - az;
  out.alt = alt;
  out.az = az;
  return out;
}

/** World-space unit vector from altitude/azimuth. Points *toward* the body. */
export function dirFromAltAz(
  alt: number,
  az: number,
  northAngleRad: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const a = az + northAngleRad;
  const ca = Math.cos(alt);
  return out.set(ca * Math.sin(a), Math.sin(alt), -ca * Math.cos(a)).normalize();
}

/**
 * Full celestial state for an hour of the day.
 * `sun`/`moon` are unit world directions pointing at the body.
 */
export class Celestial {
  site: CelestialSite;
  sun: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  moon: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
  sunAlt: number = 0;
  sunAz: number = 0;
  moonAlt: number = 0;
  moonAz: number = 0;
  /** Illuminated fraction of the lunar disc, 0..1. */
  moonPhase: number = 1;
  /** Angular separation sun-moon; drives the terminator on the disc. */
  moonElongation: number = Math.PI;
  _aa: AltAzResult = { alt: 0, az: 0 };
  _m: THREE.Matrix4 = new THREE.Matrix4();
  _tilt: THREE.Matrix4 = new THREE.Matrix4();

  constructor(site: CelestialSite = SITE) {
    this.site = { ...site };
  }

  setHour(hour: number): this {
    const s = this.site;
    const north = s.northAngleDeg * DEG;
    const decl = solarDeclination(s.dayOfYear);
    const H = (hour - 12) * 15 * DEG;

    altAz(H, decl, s.latitudeDeg, this._aa);
    this.sunAlt = this._aa.alt;
    this.sunAz = this._aa.az;
    dirFromAltAz(this.sunAlt, this.sunAz, north, this.sun);

    const Hm = H + s.moonHourOffsetDeg * DEG;
    altAz(Hm, s.moonDeclinationDeg * DEG, s.latitudeDeg, this._aa);
    this.moonAlt = this._aa.alt;
    this.moonAz = this._aa.az;
    dirFromAltAz(this.moonAlt, this.moonAz, north, this.moon);

    this.moonElongation = Math.acos(THREE.MathUtils.clamp(this.sun.dot(this.moon), -1, 1));
    this.moonPhase = 0.5 * (1 - Math.cos(this.moonElongation));

    // Equatorial -> world rotation for the starfield: the sky turns 15 deg/hour
    // about the polar axis, which is tilted from vertical by (90 - latitude).
    const polarTilt = (90 - s.latitudeDeg) * DEG;
    this._m.makeRotationY(-H + north);
    this._m.premultiply(this._tilt.makeRotationX(polarTilt));
    return this;
  }

  /** THREE.Matrix3 usable as a `mat3` uniform, world dir -> fixed sky. */
  celestialMatrix(out: THREE.Matrix3): THREE.Matrix3 {
    return out.setFromMatrix4(this._m);
  }
}
