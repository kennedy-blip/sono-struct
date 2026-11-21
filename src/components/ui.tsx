import React from 'react';
import { motion } from 'framer-motion';

export const spring = { type: 'spring', stiffness: 320, damping: 26, mass: 0.8 } as const;

export function GlassCard({
  children,
  className = '',
  style,
  hover = false,
  layoutId,
  onClick,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  hover?: boolean;
  layoutId?: string;
  onClick?: () => void;
  padded?: boolean;
}) {
  const Comp = hover || onClick || layoutId ? motion.div : 'div';
  const props: Record<string, unknown> = {
    className: `glass ${className}`,
    style: { padding: padded ? 18 : 0, ...style },
  };
  if (layoutId) props.layoutId = layoutId;
  if (onClick) props.onClick = onClick;
  if (hover || onClick) {
    props.whileHover = { scale: 1.015, y: -2 };
    props.whileTap = { scale: 0.96 };
    props.transition = spring;
    props.role = onClick ? 'button' : undefined;
    props.tabIndex = onClick ? 0 : undefined;
  }
  if (layoutId) props.transition = spring;
  return <Comp {...props}>{children}</Comp>;
}

export function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div>
        {eyebrow && <div className="label" style={{ marginBottom: 5 }}>{eyebrow}</div>}
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

export function Metric({
  label,
  value,
  unit,
  tone = 'default',
  sub,
  mono = true,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'accent';
  sub?: string;
  mono?: boolean;
}) {
  const colors: Record<string, string> = {
    default: 'var(--text)',
    ok: 'var(--accent-2)',
    warn: 'var(--warn)',
    bad: 'var(--danger)',
    accent: 'var(--accent)',
  };
  return (
    <div className="glass" style={{ padding: '12px 14px', borderRadius: 16 }}>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span className={mono ? 'mono' : ''} style={{ fontSize: 23, fontWeight: 800, color: colors[tone], lineHeight: 1 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 700 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 5, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

export function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      style={{
        width: 42, height: 24, borderRadius: 99, cursor: 'pointer', position: 'relative',
        border: `1px solid ${on ? 'color-mix(in srgb, var(--accent) 60%, transparent)' : 'var(--stroke)'}`,
        background: on ? 'color-mix(in srgb, var(--accent) 32%, transparent)' : 'color-mix(in srgb, var(--text) 8%, transparent)',
        transition: 'background .25s, border-color .25s', flexShrink: 0,
      }}
    >
      <motion.span
        layout
        transition={spring}
        style={{
          position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
          background: on ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 55%, transparent)',
          boxShadow: on ? '0 0 12px color-mix(in srgb, var(--accent) 80%, transparent)' : 'none',
        }}
      />
    </button>
  );
}

export function BatteryMeter({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'warn' | 'bad' }) {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--danger)' : 'var(--accent)';
  return (
    <div style={{ height: 6, borderRadius: 99, background: 'color-mix(in srgb, var(--text) 10%, transparent)', overflow: 'hidden' }}>
      <motion.div
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        style={{ height: '100%', background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 45%, #fff))`, borderRadius: 99 }}
      />
    </div>
  );
}

export function Locked({ need, children, role }: { need: string; children: React.ReactNode; role: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ filter: 'blur(2.5px)', opacity: 0.4, pointerEvents: 'none', userSelect: 'none' }} aria-hidden>{children}</div>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 6, textAlign: 'center', padding: 16,
      }}>
        <div className="chip" style={{ background: 'color-mix(in srgb, var(--warn) 16%, transparent)' }}>Tier locked</div>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>Requires {need}</div>
        <div className="dim" style={{ fontSize: 11 }}>You are signed in as {role}.</div>
      </div>
    </div>
  );
}
