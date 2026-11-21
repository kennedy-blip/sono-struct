/**
 * rt60Architect — room acoustics physics.
 * - Schroeder-integrated RT60 from a measured impulse response (analyser-fed)
 * - Axial/oblique standing-wave mode computation
 * - Sabine-based treatment prescription
 */
import { getCtx } from './audio';

export const OCTAVE_BANDS = [125, 250, 500, 1000, 2000, 4000] as const;
export type OctaveBand = (typeof OCTAVE_BANDS)[number];
export const SPEED_OF_SOUND = 343;

export interface RoomTarget {
  id: string;
  label: string;
  rt60: number;
}

export const RT60_TARGETS: RoomTarget[] = [
  { id: 'booth', label: 'Podcast / Voice Booth', rt60: 0.25 },
  { id: 'office', label: 'Home Office / Zoom', rt60: 0.4 },
  { id: 'living', label: 'Hi-Fi Living Room', rt60: 0.55 },
  { id: 'theater', label: 'Home Theater', rt60: 0.35 },
];

/** Sabine RT60 from room volume + total absorption (m² sabins). */
export function sabineRt60(volumeM3: number, sabins: number): number {
  return sabins > 0 ? (0.161 * volumeM3) / sabins : 0;
}

/** Sabine absorption needed to reach a target RT60. */
export function sabinsForTarget(volumeM3: number, target: number): number {
  return target > 0 ? (0.161 * volumeM3) / target : 0;
}

export function roomVolume(l: number, w: number, h: number): number {
  return l * w * h;
}

export function surfaceArea(l: number, w: number, h: number): number {
  return 2 * (l * w + l * h + w * h);
}

export interface RoomMode {
  freq: number;
  nx: number;
  ny: number;
  nz: number;
  type: 'axial' | 'tangential' | 'oblique';
}

/** f = c/2 · sqrt((nx/L)² + (ny/W)² + (nz/H)²) */
export function roomModes(l: number, w: number, h: number, maxHz = 300, maxOrder = 4): RoomMode[] {
  const modes: RoomMode[] = [];
  for (let nx = 0; nx <= maxOrder; nx++) {
    for (let ny = 0; ny <= maxOrder; ny++) {
      for (let nz = 0; nz <= maxOrder; nz++) {
        if (nx === 0 && ny === 0 && nz === 0) continue;
        const f = (SPEED_OF_SOUND / 2) * Math.sqrt((nx / l) ** 2 + (ny / w) ** 2 + (nz / h) ** 2);
        if (f > maxHz) continue;
        const nonZero = [nx, ny, nz].filter((n) => n > 0).length;
        modes.push({ freq: f, nx, ny, nz, type: nonZero === 1 ? 'axial' : nonZero === 2 ? 'tangential' : 'oblique' });
      }
    }
  }
  return modes.sort((a, b) => a.freq - b.freq);
}

/** Mode clustering (ratio to neighbour) — flags boomy rooms. */
export function modeDensityAndClusters(modes: RoomMode[]): { density: number; worstCluster: { freq: number; gapHz: number } | null } {
  const span = (modes[modes.length - 1]?.freq ?? 1) - (modes[0]?.freq ?? 0);
  const density = span > 0 ? modes.length / span : 0;
  let worst: { freq: number; gapHz: number } | null = null;
  for (let i = 1; i < modes.length; i++) {
    const gap = modes[i].freq - modes[i - 1].freq;
    if (!worst || gap < worst.gapHz) worst = { freq: modes[i].freq, gapHz: gap };
  }
  return { density, worstCluster: worst };
}

/** Pressure field for the heatmap: sum of cos terms for the strongest modes. */
export function pressureAt(
  xNorm: number,
  yNorm: number,
  l: number,
  w: number,
  h: number,
  modes: RoomMode[],
  weightCount = 8,
): number {
  let p = 0;
  const strongest = modes.slice(0, weightCount);
  strongest.forEach((m, i) => {
    const amp = 1 / (1 + i * 0.55);
    p += amp * Math.cos((m.nx * Math.PI * xNorm) * (m.nx ? 1 : 0.0001)) * Math.cos(m.ny * Math.PI * yNorm);
  });
  // always add the fundamental axial modes which dominate perceived boom
  p += 1.2 * Math.cos((Math.PI * xNorm * l) / l) * Math.cos((Math.PI * yNorm * w) / w);
  return Math.abs(p) / (strongest.length + 1.2);
}

export interface TreatmentPlan {
  absorbers: number;
  bassTraps: number;
  diffusion: number;
  note: string;
  deficitSabins: number;
}

export function treatmentPlan(l: number, w: number, h: number, currentRt60: number, target: number): TreatmentPlan {
  const vol = roomVolume(l, w, h);
  const area = surfaceArea(l, w, h);
  const currentSabins = currentRt60 > 0 ? (0.161 * vol) / currentRt60 : area * 0.1;
  const neededSabins = sabinsForTarget(vol, target);
  const deficit = Math.max(0, neededSabins - currentSabins);
  // 2" (50 mm) broadband absorber ≈ 1.1 m² sabins @ 500 Hz per 0.6×0.6 m panel (~0.36 m² face, NRC 0.9)
  const perPanel = 0.36 * 0.9;
  const absorbers = Math.ceil(deficit / perPanel / 3); // /3 because foam is usually applied with diminishing returns
  const bassTraps = Math.max(2, Math.ceil((l + w + h) / 3.2));
  const diffusion = Math.max(0, Math.ceil(vol / 90));
  const note =
    deficit <= 0
      ? 'Room already meets target. Add only 2 corner traps to tighten low-end decay.'
      : `Add ${absorbers} × 600 mm 2" absorbers at first-reflection points plus ${bassTraps} corner bass traps to reach ${target.toFixed(2)} s.`;
  return { absorbers, bassTraps, diffusion, note, deficitSabins: deficit };
}

/**
 * RT60 estimation by Schroeder backward integration of an impulse response.
 * Returns per-band decay times. Bands are computed via naive bandsplitting
 * (cascaded one-pole band limits) which is accurate enough for octave work.
 */
export function rt60FromImpulse(ir: Float32Array, sampleRate: number): Record<string, number> {
  const bandEdges: Record<string, [number, number]> = {
    '125': [88, 177],
    '250': [177, 355],
    '500': [355, 710],
    '1k': [710, 1420],
    '2k': [1420, 2840],
    '4k': [2840, 5680],
  };
  const out: Record<string, number> = {};
  for (const [key, [lo, hi]] of Object.entries(bandEdges)) {
    const filtered = bandpassAprox(ir, sampleRate, lo, hi);
    out[key] = decayTimeFromEnergy(filtered, sampleRate);
  }
  return out;
}

function bandpassAprox(input: Float32Array, sr: number, lo: number, hi: number): Float32Array {
  const out = new Float32Array(input.length);
  const aLo = Math.exp((-2 * Math.PI * lo) / sr);
  const aHi = Math.exp((-2 * Math.PI * Math.min(hi, sr / 2 - 100)) / sr);
  let lp = 0, lp2 = 0, hp = 0, hpPrev = 0;
  for (let i = 0; i < input.length; i++) {
    lp = (1 - aHi) * input[i] + aHi * lp; // lowpass
    lp2 = (1 - aHi) * lp + aHi * lp2;
    hp = aLo * (hpPrev + lp2 - (i > 0 ? input[Math.max(0, i - 1)] : 0));
    hpPrev = hp;
    out[i] = hp;
  }
  return out;
}

function decayTimeFromEnergy(samples: Float32Array, sr: number): number {
  const n = samples.length;
  const energy = new Float64Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last += samples[i] * samples[i]; energy[i] = last; }
  if (last <= 0) return 0;
  // Schroeder backward integration
  const rev = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += samples[i] * samples[i]; rev[i] = acc; }
  const db = new Float64Array(n);
  const total = rev[0] || 1;
  for (let i = 0; i < n; i++) db[i] = 10 * Math.log10(Math.max(rev[i] / total, 1e-12));

  const start = db.findIndex((v) => v <= -5);
  const end = db.findIndex((v) => v <= -35);
  if (start < 0 || end < 0 || end <= start) {
    // fall back to full-range T30 extrapolation
    const e2 = db.findIndex((v) => v <= -25);
    if (start < 0 || e2 <= start) return 0;
    const slope = (-25 + 5) / ((e2 - start) / sr);
    return Math.min(8, Math.abs(60 / slope));
  }
  const slope = (-35 + 5) / ((end - start) / sr); // dB per second
  return Math.min(8, Math.abs(60 / slope));
}

/** Build a synthetic impulse response whose decay matches the supplied band times. */
export function synthesizeImpulse(bandRt60: Record<string, number>, seconds = 2.4, sr = 48000): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const bands: [number, number, number][] = [
    [100, 180, bandRt60['125'] ?? 0.6],
    [180, 355, bandRt60['250'] ?? 0.6],
    [355, 710, bandRt60['500'] ?? 0.5],
    [710, 1420, bandRt60['1k'] ?? 0.45],
    [1420, 2840, bandRt60['2k'] ?? 0.4],
    [2840, 5680, bandRt60['4k'] ?? 0.32],
  ];
  bands.forEach(([lo, hi, t60], bi) => {
    const centre = Math.sqrt(lo * hi);
    const tau = t60 / 6.91;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t / tau);
      const noise = Math.random() * 2 - 1;
      out[i] += 0.11 * env * noise * Math.sin(2 * Math.PI * centre * t + bi);
    }
  });
  // direct impulse
  out[0] += 1;
  return out;
}

export interface SweepHandle { stop: () => void }

/** Dirac-like log sweep emitter, 90 Hz → 5 kHz, for real room excitation. */
export function emitSweep(durationS = 2.4, gain = 0.35): Promise<SweepHandle> {
  return new Promise((resolve) => {
    const c = getCtx();
    const sr = c.sampleRate;
    const n = Math.floor(durationS * sr);
    const buf = c.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const f0 = 90, f1 = 5000;
    const k = Math.log(f1 / f0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const phase = 2 * Math.PI * f0 * (durationS / k) * (Math.exp((k * t) / durationS) - 1);
      const fade = Math.min(1, t / 0.02) * Math.min(1, (durationS - t) / 0.08);
      d[i] = Math.sin(phase) * gain * fade;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
    src.onended = () => resolve({ stop: () => { try { src.stop(); } catch { /* noop */ } } });
    resolve({ stop: () => { try { src.stop(); } catch { /* noop */ } } });
  });
}

/** Simulated measurement: plausible room response driven by volume + surface hardness. */
export function simulateRt60(l: number, w: number, h: number, hardness: number): Record<string, number> {
  const vol = roomVolume(l, w, h);
  const abs = surfaceArea(l, w, h);
  const base = sabineRt60(vol, abs * (0.08 + 0.22 * hardness));
  const shape = [1.5, 1.28, 1.0, 0.92, 0.84, 0.72];
  const keys = ['125', '250', '500', '1k', '2k', '4k'];
  const out: Record<string, number> = {};
  keys.forEach((k, i) => { out[k] = +(base * shape[i]).toFixed(3); });
  return out;
}
