/**
 * clinometerEngine — 3-axis inclinometry, unit conversion, and camera overlay maths.
 */
export interface TiltReading {
  beta: number; // front-back (-180..180)
  gamma: number; // left-right (-90..90)
  pitchDeg: number;
  rollDeg: number;
  source: 'device' | 'simulator';
}

export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

export interface SlopeUnits {
  degrees: number;
  percentGrade: number;
  pitchRatio: string;
  mmPerM: number;
  inPerFt: number;
}

export function slopeUnits(degrees: number): SlopeUnits {
  const d = Math.abs(degrees);
  const tan = Math.tan(deg2rad(Math.min(89.9, d)));
  return {
    degrees,
    percentGrade: tan * 100,
    pitchRatio: `${(tan * 12).toFixed(2)} : 12`,
    mmPerM: tan * 1000,
    inPerFt: tan * 12,
  };
}

/** Drainage guidance for patios / shower pans. */
export function drainageVerdict(degrees: number): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  const pct = Math.abs(Math.tan(deg2rad(degrees)) * 100);
  if (pct >= 1.5 && pct <= 4) return { label: 'WITHIN DRAINAGE SPEC (1.5–4 % / 1/4"–1/2" per ft)', tone: 'ok' };
  if (pct < 0.5) return { label: 'FLAT — PONDING RISK. Re-slope to 2 %', tone: 'bad' };
  if (pct < 1.5) return { label: 'UNDER-SLOPED — slow drainage, add 1/8" per ft', tone: 'warn' };
  if (pct <= 8) return { label: 'STEEP BUT SERVICEABLE on exterior paving', tone: 'warn' };
  return { label: 'EXCESSIVE SLOPE — trip hazard / settlement indicator', tone: 'bad' };
}

/**
 * Fuse DeviceOrientation β/γ into pitch & roll with a complementary low-pass,
 * so jittery phone sensors still resolve to 0.1°.
 */
export class ClinometerFilter {
  private pitch = 0;
  private roll = 0;
  private readonly alpha = 0.24;

  update(beta: number, gamma: number): { pitch: number; roll: number } {
    const b = Number.isFinite(beta) ? beta : 0;
    const g = Number.isFinite(gamma) ? gamma : 0;
    // canonical phone-on-edge convention: pitch = β, roll = γ, both normalised to ±90
    const targetPitch = normalise(b, -90, 90);
    const targetRoll = Math.max(-90, Math.min(90, -g));
    this.pitch += (targetPitch - this.pitch) * this.alpha;
    this.roll += (targetRoll - this.roll) * this.alpha;
    return { pitch: this.pitch, roll: this.roll };
  }

  reset(): void { this.pitch = 0; this.roll = 0; }
  current(): { pitch: number; roll: number } { return { pitch: this.pitch, roll: this.roll }; }
}

function normalise(v: number, lo: number, hi: number): number {
  let x = v;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return Math.max(lo, Math.min(hi, x));
}

/** Bubble position inside the vial, in % of the vial radius. */
export function bubbleOffset(pitch: number, roll: number, scale = 22): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / scale));
  return { x: clamp(roll) * 100, y: clamp(pitch) * 100 };
}

export function levelState(pitch: number, roll: number): { locked: boolean; near: boolean; total: number } {
  const total = Math.hypot(pitch, roll);
  return { locked: total <= 0.1, near: total <= 1.2, total };
}

/** Derive a levelling rotation for an overlay whose horizon must stay level. */
export function hudRotation(rollDeg: number): number {
  return -Math.max(-45, Math.min(45, rollDeg));
}
