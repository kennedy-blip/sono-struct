/**
 * hydroLeakEngine — sub-surface plumbing leak stethoscope.
 * Real biquad chain: HP 350 Hz → LP 2800 Hz → 50/60 Hz notch, with
 * band-limited noise + tonal cavitation so the analyser sees a genuine spectrum.
 */
import { getCtx, getNoiseBuffer } from './audio';

export interface LeakScenario {
  id: string;
  label: string;
  detail: string;
  centerHz: number;
  bandwidth: number;
  levelDb: number;
  /** estimated flow in litres/min implied by the acoustic severeness */
  flowLpm: number;
  toneHz: number;
  toneLevel: number;
  color: string;
}

export const LEAK_SCENARIOS: LeakScenario[] = [
  {
    id: 'pinhole',
    label: 'Pin-Hole Copper Leak',
    detail: '1,420 Hz cavitation hiss behind drywall',
    centerHz: 1420,
    bandwidth: 620,
    levelDb: -13,
    flowLpm: 1.9,
    toneHz: 1420,
    toneLevel: 0.1,
    color: '#f43f5e',
  },
  {
    id: 'slab',
    label: 'Under-Slab Mainline Seepage',
    detail: '440 Hz low rumble through concrete',
    centerHz: 440,
    bandwidth: 260,
    levelDb: -9,
    flowLpm: 4.6,
    toneHz: 440,
    toneLevel: 0.14,
    color: '#f59e0b',
  },
  {
    id: 'toilet',
    label: 'Silent Toilet Flapper Trickle',
    detail: 'Broadband trickle, 900 Hz wash',
    centerHz: 900,
    bandwidth: 900,
    levelDb: -22,
    flowLpm: 0.6,
    toneHz: 980,
    toneLevel: 0.03,
    color: '#22d3ee',
  },
  {
    id: 'dry',
    label: 'Dry Pressurized Pipe (Nominal)',
    detail: 'No cavitation — baseline noise floor only',
    centerHz: 760,
    bandwidth: 1200,
    levelDb: -52,
    flowLpm: 0,
    toneHz: 0,
    toneLevel: 0,
    color: '#34d399',
  },
];

export class LeakStethoscope {
  private src: AudioBufferSourceNode | null = null;
  private live: { stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null;
  private tone: OscillatorNode | null = null;
  private toneGain: GainNode | null = null;
  private hp: BiquadFilterNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private notch: BiquadFilterNode[] = [];
  private shaper: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  private running = false;

  /** Wires HP → LP → notch(50/60) → peaking boost → analyser → destination. */
  start(scenario: LeakScenario, gainScale = 1, opts: { bandLimit?: boolean; notch?: boolean } = {}): AnalyserNode {
    const c = getCtx();
    this.stop();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.7;

    const bandLimit = opts.bandLimit ?? true;
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = bandLimit ? 350 : 20;
    this.hp.Q.value = 0.7;

    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = bandLimit ? 2800 : 16000;
    this.lp.Q.value = 0.7;

    this.notch = [50, 60].map((f) => {
      const n = c.createBiquadFilter();
      n.type = (opts.notch ?? true) ? 'notch' : 'allpass';
      n.frequency.value = f;
      n.Q.value = 26;
      return n;
    });

    this.shaper = c.createBiquadFilter();
    this.shaper.type = 'peaking';
    this.shaper.frequency.value = scenario.centerHz;
    this.shaper.Q.value = Math.max(0.6, scenario.centerHz / Math.max(80, scenario.bandwidth));
    this.shaper.gain.value = 9;

    this.gain = c.createGain();
    this.gain.gain.value = Math.pow(10, scenario.levelDb / 20) * 1.6 * gainScale;

    let node: AudioNode = this.gain;
    this.gain.connect(this.shaper);
    node = this.shaper;
    for (const n of this.notch) { node.connect(n); node = n; }
    node.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.analyser);
    this.analyser.connect(c.destination);

    this.src = c.createBufferSource();
    this.src.buffer = getNoiseBuffer(c);
    this.src.loop = true;
    this.src.connect(this.gain);

    if (scenario.toneLevel > 0) {
      this.tone = c.createOscillator();
      this.tone.type = 'sawtooth';
      this.tone.frequency.value = scenario.toneHz;
      this.toneGain = c.createGain();
      this.toneGain.gain.value = scenario.toneLevel;
      const tLP = c.createBiquadFilter();
      tLP.type = 'lowpass';
      tLP.frequency.value = 3200;
      this.tone.connect(tLP).connect(this.toneGain).connect(this.gain);
      this.tone.start();
    }
    this.src.start();
    this.running = true;
    return this.analyser;
  }

  /**
   * Live listen-through-the-wall: routes a real microphone stream through the
   * identical HP → LP → notch chain and out to the speakers, so the operator
   * hears amplified 350–2800 Hz cavitation while watching the analyser.
   */
  startLive(stream: MediaStream, opts: { bandLimit?: boolean; notch?: boolean } = {}, gainScale = 1): AnalyserNode {
    const c = getCtx();
    this.stop();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.7;

    const bandLimit = opts.bandLimit ?? true;
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = bandLimit ? 350 : 20;
    this.hp.Q.value = 0.7;

    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = bandLimit ? 2800 : 16000;
    this.lp.Q.value = 0.7;

    this.notch = [50, 60].map((f) => {
      const n = c.createBiquadFilter();
      n.type = (opts.notch ?? true) ? 'notch' : 'allpass';
      n.frequency.value = f;
      n.Q.value = 26;
      return n;
    });

    this.shaper = c.createBiquadFilter();
    this.shaper.type = 'peaking';
    this.shaper.frequency.value = 1200;
    this.shaper.Q.value = 0.9;
    this.shaper.gain.value = 7;

    this.gain = c.createGain();
    this.gain.gain.value = 1.1 * gainScale;

    const source = c.createMediaStreamSource(stream);
    let node: AudioNode = this.gain;
    source.connect(this.gain);
    this.gain.connect(this.shaper);
    node = this.shaper;
    for (const n of this.notch) { node.connect(n); node = n; }
    node.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.analyser);
    this.analyser.connect(c.destination);

    this.live = { stream, source };
    this.running = true;
    return this.analyser;
  }

  setGain(scale: number): void {
    if (this.gain) this.gain.gain.setTargetAtTime(Math.max(0.0001, scale), getCtx().currentTime, 0.08);
  }

  isRunning(): boolean { return this.running; }

  stop(): void {
    try { this.src?.stop(); } catch { /* noop */ }
    try { this.tone?.stop(); } catch { /* noop */ }
    try { this.analyser?.disconnect(); } catch { /* noop */ }
    if (this.live) {
      try { this.live.source.disconnect(); } catch { /* noop */ }
      this.live.stream.getTracks().forEach((t) => t.stop());
      this.live = null;
    }
    this.src = null; this.tone = null; this.gain = null; this.analyser = null; this.running = false;
  }
}

/* --------------------------- physics calculators --------------------------- */

/** Magnus-Tetens / Buck saturation vapour pressure (hPa). */
export function saturationPressure(tempC: number): number {
  return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
}

/** Dew point in °C from temperature (°C) and relative humidity (%). */
export function dewPoint(tempC: number, rhPct: number): number {
  const rh = Math.min(100, Math.max(1, rhPct)) / 100;
  const gamma = Math.log(rh) + (17.67 * tempC) / (tempC + 243.5);
  return (243.5 * gamma) / (17.67 - gamma);
}

export function absoluteHumidityGm3(tempC: number, rhPct: number): number {
  const e = (Math.min(100, Math.max(1, rhPct)) / 100) * saturationPressure(tempC);
  return (216.7 * e) / (tempC + 273.15);
}

export type MoldRisk = 'LOW' | 'MODERATE' | 'CRITICAL';

export interface WasteResult {
  litresDay: number;
  litresMonth: number;
  gallonsMonth: number;
  costMonth: number;
  costYear: number;
  dewPointC: number;
  absHumidity: number;
  moldRisk: MoldRisk;
  moldNote: string;
}

export interface WasteInput {
  flowLpm: number;
  dripHoursPerDay: number;
  pricePerM3: number;
  currency: string;
  tempC: number;
  rhPct: number;
  wallCavityTempC?: number;
}

export function waterWaste(input: WasteInput): WasteResult {
  const litresDay = Math.max(0, input.flowLpm) * 60 * Math.min(24, Math.max(0, input.dripHoursPerDay));
  const litresMonth = litresDay * 30.4;
  const gallonsMonth = litresMonth / 3.78541;
  const costMonth = (litresMonth / 1000) * input.pricePerM3;
  const dp = dewPoint(input.tempC, input.rhPct);
  const wallTemp = input.wallCavityTempC ?? input.tempC - 3.5;
  const margin = wallTemp - dp; // negative ⇒ condensation forming inside cavity
  const abs = absoluteHumidityGm3(input.tempC, input.rhPct);

  let moldRisk: MoldRisk;
  if (margin < -1.5 || input.rhPct > 82) moldRisk = 'CRITICAL';
  else if (margin < 2.5 || input.rhPct > 68) moldRisk = 'MODERATE';
  else moldRisk = 'LOW';

  const moldNote =
    moldRisk === 'CRITICAL'
      ? `Cavity surface (${wallTemp.toFixed(1)} °C) sits ${Math.abs(margin).toFixed(1)} °C BELOW dew point — active condensation, Stachybotrys risk. Open the wall within 48 h.`
      : moldRisk === 'MODERATE'
        ? `Only ${margin.toFixed(1)} °C of dew-point margin. Sustained leak will wet the gypsum paper and seed mould within ~2 weeks.`
        : `Dry margin of ${margin.toFixed(1)} °C. Maintain ventilation; monitor monthly.`;

  return { litresDay, litresMonth, gallonsMonth, costMonth, costYear: costMonth * 12, dewPointC: dp, absHumidity: abs, moldRisk, moldNote };
}
