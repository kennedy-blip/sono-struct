/**
 * impactEchoEngine — Impact-Echo non-destructive test core.
 * Real spectral centroid + impulse decay (τ) analysis drives the same classifier
 * that the simulator feeds with physically-modelled damped-resonance knock tones.
 */
import { applyHaptic } from './haptics';
import type { EchoReading, MaterialKind, Verdict } from '../types';
import { getCtx, getNoiseBuffer } from './audio';

export interface MaterialProfile {
  kind: MaterialKind;
  label: string;
  short: string;
  carrierHz: number;
  centroidHz: number;
  decayMs: number;
  magnetUt: number;
  verdict: Verdict;
  severity: 'safe' | 'caution' | 'danger';
  note: string;
  color: string;
  xRange: [number, number]; // inches along the 24" simulated span
}

export const SPAN_INCHES = 24;

/** Cross-section of the simulated wall span (24 inch). */
export const WALL_MATERIALS: MaterialProfile[] = [
  { kind: 'hollow', label: 'Hollow Drywall Cavity', short: 'HOLLOW', carrierHz: 128, centroidHz: 142, decayMs: 96, magnetUt: 12, verdict: 'HOLLOW', severity: 'safe', note: 'No solid backing — do not anchor heavy loads here.', color: '#38bdf8', xRange: [0, 4.6] },
  { kind: 'stud', label: '1.5" Wood Stud', short: 'STUD', carrierHz: 352, centroidHz: 371, decayMs: 21, magnetUt: 18, verdict: 'STUD', severity: 'safe', note: 'Solid stud center — safe to anchor. Fast damping confirms dense grain.', color: '#34d399', xRange: [5.2, 6.8] },
  { kind: 'hollow', label: 'Hollow Cavity', short: 'HOLLOW', carrierHz: 136, centroidHz: 158, decayMs: 88, magnetUt: 14, verdict: 'HOLLOW', severity: 'safe', note: 'Empty stud bay between members.', color: '#38bdf8', xRange: [6.8, 9.4] },
  { kind: 'pipe', label: 'Pressurized Copper Pipe', short: 'PIPE', carrierHz: 610, centroidHz: 502, decayMs: 34, magnetUt: 96, verdict: 'PIPE', severity: 'danger', note: 'Pressurized copper — drilling risks a burst. Relocate 6"+.', color: '#f43f5e', xRange: [9.4, 11.2] },
  { kind: 'hollow', label: 'Hollow Cavity', short: 'HOLLOW', carrierHz: 124, centroidHz: 133, decayMs: 104, magnetUt: 11, verdict: 'HOLLOW', severity: 'safe', note: 'Deep open cavity, long ring.', color: '#38bdf8', xRange: [11.2, 13.9] },
  { kind: 'conduit', label: 'Live 120V Romex Conduit', short: 'CONDUIT', carrierHz: 780, centroidHz: 566, decayMs: 46, magnetUt: 74, verdict: 'CONDUIT', severity: 'danger', note: '50/60 Hz hum + magnetic flux. NEVER DRILL.', color: '#f59e0b', xRange: [14.6, 16.4] },
  { kind: 'hollow', label: 'Hollow Cavity', short: 'HOLLOW', carrierHz: 118, centroidHz: 126, decayMs: 112, magnetUt: 9, verdict: 'HOLLOW', severity: 'safe', note: 'Open bay.', color: '#38bdf8', xRange: [16.4, 19.1] },
  { kind: 'tile', label: 'Delaminated Ceramic Tile', short: 'TILE', carrierHz: 196, centroidHz: 171, decayMs: 71, magnetUt: 7, verdict: 'TILE', severity: 'caution', note: 'Tile has debonded from thinset — hollow ring. Regrout or replace.', color: '#a78bfa', xRange: [19.1, 24] },
];

export function sampleWall(x: number): MaterialProfile {
  const clamped = Math.min(SPAN_INCHES, Math.max(0, x));
  for (const m of WALL_MATERIALS) {
    if (clamped >= m.xRange[0] && clamped < m.xRange[1]) return m;
  }
  return WALL_MATERIALS[WALL_MATERIALS.length - 1];
}

export function classify(centroidHz: number, decayMs: number, magnetUt: number, hum: number): EchoReading {
  let kind: MaterialKind = 'hollow';
  if (magnetUt > 70 || hum > 0.42) kind = 'conduit';
  else if (magnetUt > 55) kind = 'pipe';
  else if (centroidHz >= 290 && decayMs < 34) kind = 'stud';
  else if (centroidHz >= 160 && centroidHz < 290) kind = 'tile';
  else kind = 'hollow';

  const profile = WALL_MATERIALS.find((m) => m.kind === kind) ?? WALL_MATERIALS[0];
  const spectralFit = 1 - Math.min(1, Math.abs(centroidHz - profile.centroidHz) / 320);
  const decayFit = 1 - Math.min(1, Math.abs(decayMs - profile.decayMs) / 140);
  const magneticBoost = kind === 'conduit' || kind === 'pipe' ? Math.min(0.22, magnetUt / 420) : 0;
  return {
    centroidHz,
    decayMs,
    magnetUt,
    hum60: hum,
    confidence: Math.min(0.99, 0.2 + 0.42 * spectralFit + 0.3 * decayFit + magneticBoost),
    kind,
    verdict: profile.verdict,
    severity: profile.severity,
    note: profile.note,
  };
}

/* ------------------------------------------------------------------ */
/* Simulated physical knock: damped multi-partial impact response       */
/* ------------------------------------------------------------------ */

export function playKnock(p: MaterialProfile, gain = 0.5): void {
  const c = getCtx();
  const now = c.currentTime;
  const master = c.createGain();
  master.gain.value = gain;
  master.connect(c.destination);

  // Body resonance: 3 detuned partials in the material's band, driven by a noise burst.
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const burst = c.createGain();
  const tau = p.decayMs / 1000;
  burst.gain.setValueAtTime(0.0001, now);
  burst.gain.exponentialRampToValueAtTime(1, now + 0.002);
  burst.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, tau * 1.6));
  noise.connect(burst);

  const partials = [1, 1.47, 2.31];
  partials.forEach((ratio, i) => {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(7200, p.carrierHz * ratio);
    bp.Q.value = p.kind === 'stud' ? 7 : 3.4;
    const g = c.createGain();
    g.gain.value = 0.85 / (i + 1.15);
    burst.connect(bp).connect(g).connect(master);
  });

  // Transient "tap" edge
  const click = c.createOscillator();
  click.type = 'triangle';
  click.frequency.setValueAtTime(p.carrierHz * 1.6, now);
  const clickGain = c.createGain();
  clickGain.gain.setValueAtTime(0.16, now);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  click.connect(clickGain).connect(master);
  click.start(now);
  click.stop(now + 0.07);

  noise.start(now);
  noise.stop(now + 0.55);
  if (p.severity === 'danger') applyHaptic('heavy');
}

/* ------------------------------------------------------------------ */
/* Active thump emitter: 80–450 Hz sine sweeps for real wall excitation */
/* ------------------------------------------------------------------ */

export class ThumpEmitter {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;

  burst(freqHz: number, durationMs = 140, amplitude = 0.7): void {
    const c = getCtx();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freqHz * 0.72), now + durationMs / 1000);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amplitude, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain).connect(lp).connect(c.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.03);
  }

  start(freqHz: number, amplitude = 0.28): void {
    this.stop();
    const c = getCtx();
    const now = c.currentTime;
    this.osc = c.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.value = freqHz;
    this.gain = c.createGain();
    this.gain.gain.setValueAtTime(0.0001, now);
    this.gain.gain.exponentialRampToValueAtTime(amplitude, now + 0.08);
    this.lfo = c.createOscillator();
    this.lfo.frequency.value = 4.2;
    const lfoGain = c.createGain();
    lfoGain.gain.value = amplitude * 0.45;
    this.lfo.connect(lfoGain).connect(this.gain.gain);
    this.osc.connect(this.gain).connect(c.destination);
    this.osc.start(now);
    this.lfo.start(now);
  }

  setFreq(freqHz: number): void {
    if (this.osc) this.osc.frequency.setTargetAtTime(freqHz, getCtx().currentTime, 0.03);
  }

  stop(): void {
    const c = getCtx();
    const now = c.currentTime;
    if (this.gain) {
      try {
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), now);
        this.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      } catch { /* noop */ }
    }
    try { this.osc?.stop(now + 0.12); } catch { /* noop */ }
    try { this.lfo?.stop(now + 0.12); } catch { /* noop */ }
    this.osc = null;
    this.lfo = null;
    this.gain = null;
  }
}

/* ------------------------------------------------------------------ */
/* Simulator sweep state (deterministic sampling every 0.5")          */
/* ------------------------------------------------------------------ */

export function simulatedSweep(step = 0.5): { x: number; profile: MaterialProfile }[] {
  const out: { x: number; profile: MaterialProfile }[] = [];
  for (let x = 0; x <= SPAN_INCHES; x += step) out.push({ x, profile: sampleWall(x) });
  return out;
}

export function studCenters(): number[] {
  const centers: number[] = [];
  let runStart: number | null = null;
  for (let x = 0; x <= SPAN_INCHES; x += 0.05) {
    const isStud = sampleWall(x).kind === 'stud';
    if (isStud && runStart === null) runStart = x;
    if (!isStud && runStart !== null) {
      centers.push(+((runStart + x - 0.05) / 2).toFixed(2));
      runStart = null;
    }
  }
  return centers;
}
