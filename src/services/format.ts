export const fmtHz = (hz: number): string => (hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`);
export const fmtSec = (s: number): string => `${s.toFixed(2)} s`;
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Small caption describing the live analysis chain shown in the Hydro module. */
export function micDebugLine(): string {
  return 'chain: bufferSource → gain → peaking(centroid) → notch 50 Hz → notch 60 Hz → HP 350 Hz → LP 2800 Hz → analyser → destination';
}

export function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic pseudo-SHA-256-looking badge for build artifacts (display only). */
export function shortChecksum(seed: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 16777619 >>> 0;
    h2 = (h2 + seed.charCodeAt(i) * (i + 7)) >>> 0;
  }
  return Array.from({ length: 8 }, (_, i) => (((h1 >>> (i * 3)) ^ (h2 >>> (i * 2))) & 0xff).toString(16).padStart(2, '0')).join('');
}
