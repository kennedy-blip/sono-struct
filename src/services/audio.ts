/** Shared Web Audio plumbing: single lazy context, noise buffers, analyser helpers. */

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function getCtx(): AudioContext {
  if (!ctx) {
    const AC: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function getNoiseBuffer(ctxIn?: AudioContext): AudioBuffer {
  const c = ctxIn ?? getCtx();
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    // pink-ish filtering – closer to real cavity/plumbing hiss than flat white noise
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
  }
  noiseBuffer = buf;
  return buf;
}

export interface MicHandle {
  stream: MediaStream;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  stop: () => void;
}

export async function openMic(fftSize = 2048, smoothing = 0.55): Promise<MicHandle> {
  const c = getCtx();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    video: false,
  });
  const source = c.createMediaStreamSource(stream);
  const analyser = c.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothing;
  source.connect(analyser);
  return {
    stream,
    analyser,
    source,
    stop: () => {
      try { source.disconnect(); } catch { /* noop */ }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export function spectralCentroidFromDb(freqDb: Float32Array, sampleRate: number, fftSize: number): number {
  let num = 0, den = 0;
  for (let i = 1; i < freqDb.length; i++) {
    const mag = Math.pow(10, freqDb[i] / 20);
    num += mag * ((i * sampleRate) / fftSize);
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

export function bandEnergyDb(freqDb: Float32Array, loHz: number, hiHz: number, sampleRate: number, fftSize: number): number {
  const b0 = Math.max(1, Math.floor((loHz * fftSize) / sampleRate));
  const b1 = Math.min(freqDb.length - 1, Math.floor((hiHz * fftSize) / sampleRate));
  let peak = -160;
  for (let i = b0; i <= b1; i++) if (freqDb[i] > peak) peak = freqDb[i];
  return peak;
}

/** UI helper: linear amplitude → dBFS. */
export const toDb = (amp: number): number => 20 * Math.log10(Math.max(amp, 1e-6));
