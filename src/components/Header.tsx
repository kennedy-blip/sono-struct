import React from 'react';
import { motion } from 'framer-motion';
import { Cloud, CloudOff, Download, HardHat, Layers, Monitor, Shield, Smartphone } from 'lucide-react';
import { useApp } from '../state/AppState';
import type { Role, ThemeId } from '../types';
import { Toggle } from './ui';

const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: 'obsidian', label: 'Obsidian', swatch: ['#0f172a', '#22d3ee', '#34d399'] },
  { id: 'blueprint', label: 'Blueprint', swatch: ['#071326', '#67e8f9', '#3b82f6'] },
  { id: 'daylight', label: 'Daylight', swatch: ['#eef3f9', '#0e7490', '#0b1220'] },
  { id: 'eco', label: 'Eco / Low-GPU', swatch: ['#0d1727', '#2dd4bf', '#1e40af'] },
];

const ROLES: { id: Role; label: string; short: string }[] = [
  { id: 'homeowner', label: 'DIY Homeowner / Renter', short: 'DIY' },
  { id: 'inspector', label: 'Building Inspector Pro', short: 'PRO' },
  { id: 'director', label: 'Structural Forensics Director', short: 'ADMIN' },
];

export function Header() {
  const { theme, setTheme, role, setRole, view, setView, setApkOpen, setPrivOpen, online, locked, counts } = useApp();

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 40, padding: '12px 16px 0' }}>
      <div className="glass" style={{ padding: '10px 14px', borderRadius: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent-2) 80%, #000))',
            boxShadow: '0 6px 20px -8px color-mix(in srgb, var(--accent) 90%, transparent)', flexShrink: 0,
          }}>
            <Layers size={17} color="#04121a" />
          </div>
          <div style={{ lineHeight: 1.1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.03em' }}>SONO<span style={{ color: 'var(--accent)' }}>·</span>STRUCT</div>
            <div className="label" style={{ fontSize: 8, whiteSpace: 'nowrap' }}>Acoustic NDT workstation</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
          <div style={{ display: 'flex', padding: 3, borderRadius: 11, border: '1px solid var(--stroke)', background: 'color-mix(in srgb, var(--text) 5%, transparent)' }}>
            {(['desktop', 'mobile'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="mono"
                style={{
                  position: 'relative', border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '5px 9px', fontSize: 8.5, letterSpacing: '.08em', fontWeight: 800,
                  color: view === v ? '#04121a' : 'var(--text-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {view === v && <motion.span layoutId="viewpill" transition={{ type: 'spring', stiffness: 380, damping: 30 }} style={{ position: 'absolute', inset: 0, borderRadius: 8, background: 'var(--accent)', zIndex: -1 }} />}
                {v === 'desktop' ? <Monitor size={11} /> : <Smartphone size={11} />} {v === 'desktop' ? 'DESKTOP ENGINEERING' : 'MOBILE APK PREVIEW'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 11, border: '1px solid var(--stroke)' }}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                title={t.label}
                aria-label={t.label}
                style={{
                  width: 22, height: 22, borderRadius: 7, cursor: 'pointer', padding: 0,
                  border: theme === t.id ? '1.5px solid var(--text)' : '1px solid var(--stroke)',
                  background: `linear-gradient(135deg, ${t.swatch[0]} 40%, ${t.swatch[1]} 40%, ${t.swatch[1]} 72%, ${t.swatch[2]} 72%)`,
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', padding: 3, borderRadius: 11, border: '1px solid var(--stroke)', gap: 2 }}>
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                className="mono"
                title={r.label}
                style={{
                  border: 'none', cursor: 'pointer', padding: '5px 8px', fontSize: 9, fontWeight: 800, letterSpacing: '.06em',
                  borderRadius: 8, background: role === r.id ? 'color-mix(in srgb, var(--accent) 24%, transparent)' : 'transparent',
                  color: role === r.id ? 'var(--accent)' : 'var(--text-dim)',
                }}
              >{r.short}</button>
            ))}
          </div>

          <button className="btn" onClick={() => setPrivOpen(true)} title="Privileges & sensor permissions" style={{ padding: '7px 9px' }}>
            <Shield size={14} />
            {locked && <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--warn)' }} />}
          </button>

          <span className="chip" style={{ fontSize: 9 }} title={online ? 'Cloud queue online' : 'Offline first'}>
            {online ? <Cloud size={10} /> : <CloudOff size={10} />} {counts.pending}
          </span>

          <button className="btn btn-primary" onClick={() => setApkOpen(true)} style={{ padding: '7px 12px' }}>
            <Download size={13} /> .APK
          </button>
        </div>
      </div>
    </header>
  );
}

export function MobileHeader() {
  const { setApkOpen, setPrivOpen, online, counts } = useApp();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
          <HardHat size={13} color="#04121a" />
        </div>
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '-0.02em' }}>SONO·STRUCT</div>
          <div className="label" style={{ fontSize: 7 }}>NDT JOBSITE</div>
        </div>
      </div>
      <span className="chip mono" style={{ marginLeft: 'auto', fontSize: 8 }}>
        {online ? <Cloud size={9} /> : <CloudOff size={9} />} {counts.pending}
      </span>
      <button className="btn" style={{ padding: 7 }} onClick={() => setPrivOpen(true)}><Shield size={13} /></button>
      <button className="btn btn-primary" style={{ padding: '7px 10px', fontSize: 11 }} onClick={() => setApkOpen(true)}><Download size={12} /></button>
    </div>
  );
}
