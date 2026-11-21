import React from 'react';
import { motion } from 'framer-motion';
import { AudioWaveform, Droplets, Radar, Ruler, Vault, type LucideIcon } from 'lucide-react';
import { useApp } from '../state/AppState';
import type { ModuleId } from '../types';

export const MODULES: { id: ModuleId; label: string; short: string; icon: LucideIcon }[] = [
  { id: 'impact', label: 'Impact-Echo Scanner', short: 'Scan', icon: Radar },
  { id: 'hydro', label: 'Hydro-Listen Lab', short: 'Leaks', icon: Droplets },
  { id: 'rt60', label: 'RT60 Architect', short: 'RT60', icon: AudioWaveform },
  { id: 'level', label: 'AR Clinometer', short: 'Level', icon: Ruler },
  { id: 'vault', label: 'Inspection Vault', short: 'Vault', icon: Vault },
];

export function MetaballDock({ compact = false }: { compact?: boolean }) {
  const { module, setModule } = useApp();

  return (
    <div
      style={{
        position: compact ? 'sticky' : 'fixed',
        bottom: compact ? undefined : 18,
        left: compact ? undefined : '50%',
        transform: compact ? undefined : 'translateX(-50%)',
        zIndex: 45,
        width: compact ? '100%' : 'auto',
        padding: compact ? '6px 4px calc(6px + env(safe-area-inset-bottom))' : 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        className="glass"
        style={{
          display: 'flex', gap: compact ? 2 : 4, padding: compact ? 6 : 7, borderRadius: compact ? 16 : 20,
          filter: 'url(#gooey)', pointerEvents: 'auto', width: compact ? '100%' : undefined,
          justifyContent: compact ? 'space-between' : undefined,
        }}
      >
        {MODULES.map((m) => {
          const active = module === m.id;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => setModule(m.id)}
              aria-current={active ? 'page' : undefined}
              style={{
                position: 'relative', border: 'none', background: 'transparent', cursor: 'pointer',
                padding: compact ? '8px 6px' : '9px 13px', borderRadius: 14, display: 'flex',
                alignItems: 'center', gap: 6, flex: compact ? 1 : undefined, justifyContent: 'center',
                color: active ? '#04121a' : 'var(--text-dim)',
              }}
            >
              {active && (
                <motion.span
                  layoutId="dockblob"
                  transition={{ type: 'spring', stiffness: 320, damping: 26, mass: 0.8 }}
                  style={{
                    position: 'absolute', inset: 0, borderRadius: 14, zIndex: -1,
                    background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent-2) 80%, #000))',
                    boxShadow: '0 8px 24px -10px color-mix(in srgb, var(--accent) 90%, transparent)',
                  }}
                />
              )}
              <Icon size={compact ? 17 : 15} />
              {!compact && <span style={{ fontSize: 11, fontWeight: 750, letterSpacing: '.01em' }}>{m.short}</span>}
              {compact && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em' }}>{m.short}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
