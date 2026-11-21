import React, { useEffect, useRef } from 'react';
import { useApp } from '../state/AppState';

const PALETTES = {
  safe: ['var(--blob-a)', 'var(--blob-b)', 'var(--blob-c)', 'var(--blob-d)'],
  stud: ['#10b981', '#14b8a6', '#6ee7b7', '#22d3ee'],
  danger: ['#ef4444', '#f59e0b', '#ec4899', '#fb7185'],
  idle: ['var(--blob-a)', 'var(--blob-b)', 'var(--blob-c)', 'var(--blob-d)'],
} as const;

/** GPU mesh-gradient underlay: 4 drifting radial blobs reactive to scan state. */
export function MeshBackdrop() {
  const { pulse, theme } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const palette = PALETTES[pulse];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const t0 = performance.now();
    const animate = (now: number) => {
      const t = (now - t0) / 1000;
      const blobs = el.querySelectorAll<HTMLElement>('.blob');
      blobs.forEach((b, i) => {
        const sp = 0.06 + i * 0.017;
        const x = 50 + Math.sin(t * sp + i * 1.7) * (26 + i * 5);
        const y = 42 + Math.cos(t * sp * 0.83 + i * 2.1) * (22 + i * 4);
        const s = 1 + Math.sin(t * 0.19 + i) * 0.12;
        b.style.transform = `translate3d(${x - 50}%, ${y - 50}%, 0) scale(${s})`;
      });
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const lowGpu = theme === 'eco';

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden',
        background: 'radial-gradient(120% 90% at 50% 0%, var(--bg-1), var(--bg-0) 72%)',
        filter: lowGpu ? 'none' : 'blur(38px) saturate(135%)',
        opacity: 'var(--blob-opacity)',
        transition: 'opacity .6s ease',
        willChange: 'transform',
      }}
    >
      {palette.map((c, i) => (
        <div
          key={i}
          className="blob"
          style={{
            position: 'absolute', left: '50%', top: '50%',
            width: ['62vw', '50vw', '46vw', '38vw'][i],
            height: ['62vw', '50vw', '46vw', '38vw'][i],
            marginLeft: ['-31vw', '-25vw', '-23vw', '-19vw'][i],
            marginTop: ['-31vw', '-25vw', '-23vw', '-19vw'][i],
            borderRadius: '50%',
            background: `radial-gradient(circle at 50% 50%, ${c} 0%, transparent 68%)`,
            opacity: [0.55, 0.45, 0.4, 0.3][i],
            willChange: 'transform',
            transition: 'background 1.2s ease',
          }}
        />
      ))}
    </div>
  );
}

export function Chrome() {
  return (
    <>
      <MeshBackdrop />
      <div className="grid-overlay" />
      <div className="specular" />
      <div className="grain" />
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <filter id="gooey">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>
    </>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 80,
        pointerEvents: 'none', maxWidth: 'min(560px, 92vw)',
        opacity: toastMsg ? 1 : 0, transition: 'opacity .3s, transform .3s',
        translate: toastMsg ? '0 0' : '0 12px',
      }}
    >
      {toastMsg && (
        <div className="glass mono" style={{ padding: '10px 16px', fontSize: 11.5, letterSpacing: '.04em' }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}
