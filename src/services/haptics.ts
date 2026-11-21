import { Haptics, ImpactStyle } from '@capacitor/haptics';

export type HapticKind = 'light' | 'medium' | 'heavy' | 'lock';

const patterns: Record<HapticKind, number | number[]> = {
  light: 12,
  medium: 28,
  heavy: 55,
  lock: [22, 50, 22],
};

/** Native Capacitor haptics with a navigator.vibrate fallback for web. */
export async function applyHaptic(kind: HapticKind = 'medium'): Promise<void> {
  try {
    if (kind === 'heavy' || kind === 'lock') {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } else if (kind === 'medium') {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } else {
      await Haptics.impact({ style: ImpactStyle.Light });
    }
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(patterns[kind]); } catch { /* noop */ }
    }
  }
}

export function vibrate(kind: HapticKind = 'medium'): void {
  void applyHaptic(kind);
}

/** Short confirmation chime used when the clinometer locks to 0.0°. */
export function lockChime(freq = 880): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new AC();
    const now = c.currentTime;
    [0, 0.12].forEach((off, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * (i === 1 ? 1.5 : 1);
      g.gain.setValueAtTime(0.0001, now + off);
      g.gain.exponentialRampToValueAtTime(0.16, now + off + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.16);
      o.connect(g).connect(c.destination);
      o.start(now + off);
      o.stop(now + off + 0.2);
    });
    setTimeout(() => void c.close(), 800);
  } catch { /* noop */ }
}
