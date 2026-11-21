import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Cpu, Lock, Mic, ShieldCheck, Smartphone, Vibrate, X, type LucideIcon } from 'lucide-react';
import { useApp } from '../state/AppState';
import { Toggle, spring } from './ui';
import { openMic } from '../services/audio';
import { applyHaptic } from '../services/haptics';
import type { Role, SensorKey } from '../types';

const ROLES: { id: Role; name: string; tier: string; perks: string[]; color: string }[] = [
  {
    id: 'homeowner', name: 'DIY Homeowner / Renter', tier: 'STANDARD', color: '#38bdf8',
    perks: ['Impact-Echo stud & tile scanner', 'Plumbing leak listener', '2D bullseye spirit level', 'Pre-lease property checklist'],
  },
  {
    id: 'inspector', name: 'Building Inspector Pro', tier: 'PRO', color: '#34d399',
    perks: ['RT60 octave-band reverb architect', 'Custom 80–450 Hz thump synthesizer', 'Psychrometric mould & water-loss calculator', 'Standing-wave room mapper'],
  },
  {
    id: 'director', name: 'Structural Forensics Director', tier: 'ADMIN', color: '#f59e0b',
    perks: ['Multi-property inspection ledger', 'Raw FFT + clinometer JSON/CSV export', 'PIN-locked forensic vault', 'Offline sync queue controller'],
  },
];

const SENSORS: { key: SensorKey; name: string; desc: string; icon: LucideIcon }[] = [
  { key: 'mic', name: 'NDT Acoustic Mic Array', desc: 'getUserMedia with echoCancellation, noiseSuppression and autoGainControl all disabled for raw impulse capture.', icon: Mic },
  { key: 'motion', name: '3-Axis Clinometer & Magnetometer', desc: 'DeviceOrientation β/γ plus DeviceMotion, filtered to 0.1° for the bubble level and magnetic anomaly detector.', icon: Smartphone },
  { key: 'camera', name: 'Optical Laser-Line Camera', desc: 'getUserMedia video for the gyro-stabilised crosshair overlay projected over the live room view.', icon: Camera },
  { key: 'haptics', name: 'Tactile Stud-Edge Haptics', desc: 'Capacitor Haptics with navigator.vibrate fallback on stud-centre crossing and 0.0° level lock.', icon: Vibrate },
];

export function PrivilegeDrawer() {
  const { privOpen, setPrivOpen, role, setRole, sensors, setSensor, toast, locked } = useApp();
  const [busy, setBusy] = useState<SensorKey | null>(null);

  useEffect(() => {
    if (!privOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPrivOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [privOpen, setPrivOpen]);

  const activate = async (key: SensorKey) => {
    setBusy(key);
    try {
      if (key === 'mic') {
        const h = await openMic(2048, 0.5);
        h.stop();
        setSensor('mic', 'ACTIVE');
        toast('Microphone granted — live impact-echo mode available.');
      } else if (key === 'motion') {
        const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
        if (D?.requestPermission) {
          const res = await D.requestPermission();
          setSensor('motion', res === 'granted' ? 'ACTIVE' : 'RESTRICTED');
          toast(res === 'granted' ? 'Motion granted — clinometer live.' : 'Motion denied — simulator remains active.');
        } else {
          setSensor('motion', 'ACTIVE');
          toast('Motion API available — tilt the device to level.');
        }
      } else if (key === 'camera') {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach((t) => t.stop());
        setSensor('camera', 'ACTIVE');
        toast('Camera granted — laser overlay ready.');
      } else {
        await applyHaptic('lock');
        setSensor('haptics', 'ACTIVE');
        toast('Haptic engine test fired.');
      }
    } catch {
      setSensor(key, 'RESTRICTED');
      toast(`${SENSORS.find((s) => s.key === key)?.name ?? 'Sensor'} blocked — simulator fallback engaged.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {privOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPrivOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 74, background: 'rgba(2,6,14,0.55)', backdropFilter: 'blur(8px)' }}
          />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={spring}
            className="glass"
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 76, width: 'min(440px, 94vw)',
              borderRadius: '24px 0 0 24px', padding: 22, overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="label">Access control</div>
                <div style={{ fontSize: 18, fontWeight: 850, letterSpacing: '-0.02em' }}>Privileges & Sensors</div>
              </div>
              <button className="btn" onClick={() => setPrivOpen(false)} aria-label="Close drawer"><X size={14} /></button>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="label" style={{ marginBottom: 10 }}>Privilege tier</div>
              <div style={{ display: 'grid', gap: 9 }}>
                {ROLES.map((r) => {
                  const active = role === r.id;
                  return (
                    <motion.button
                      key={r.id}
                      whileTap={{ scale: 0.98 }}
                      transition={spring}
                      onClick={() => { setRole(r.id); toast(`Tier switched to ${r.name}.`); }}
                      style={{
                        textAlign: 'left', cursor: 'pointer', padding: 13, borderRadius: 14,
                        border: `1px solid ${active ? r.color : 'var(--stroke)'}`,
                        background: active ? `color-mix(in srgb, ${r.color} 12%, transparent)` : 'transparent',
                        boxShadow: active ? `0 0 26px -14px ${r.color}` : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: r.color, boxShadow: `0 0 10px ${r.color}` }} />
                        <span style={{ fontSize: 12.5, fontWeight: 800 }}>{r.name}</span>
                        <span className="chip" style={{ marginLeft: 'auto', fontSize: 8 }}>{r.tier}</span>
                      </div>
                      <div style={{ marginTop: 7, display: 'grid', gap: 3 }}>
                        {r.perks.map((p) => (
                          <div key={p} style={{ fontSize: 10.5, color: 'var(--text-dim)', display: 'flex', gap: 6 }}>
                            <span style={{ color: r.color }}>▸</span>{p}
                          </div>
                        ))}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div className="label" style={{ marginBottom: 10 }}>Hardware & OS sensors</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {SENSORS.map((s) => {
                  const Icon = s.icon;
                  const state = sensors[s.key];
                  const tonal = state === 'ACTIVE' ? '#34d399' : state === 'RESTRICTED' ? '#f43f5e' : state === 'SIMULATOR ACTIVE' ? '#f59e0b' : '#94a3b8';
                  return (
                    <div key={s.key} className="glass" style={{ padding: 12, borderRadius: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon size={14} />
                        <span style={{ fontSize: 11.5, fontWeight: 750, flex: 1 }}>{s.name}</span>
                        <Toggle
                          on={state === 'ACTIVE'}
                          onClick={() => (state === 'ACTIVE' ? setSensor(s.key, s.key === 'motion' ? 'SIMULATOR ACTIVE' : 'IDLE') : void activate(s.key))}
                          label={s.name}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                        <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.1em', fontWeight: 800, color: tonal, border: `1px solid ${tonal}55`, padding: '2px 6px', borderRadius: 5 }}>
                          {busy === s.key ? 'REQUESTING…' : state}
                        </span>
                        <span style={{ fontSize: 9.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>{s.desc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="glass" style={{ marginTop: 18, padding: 13, borderRadius: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {locked ? <Lock size={14} color="var(--warn)" /> : <ShieldCheck size={14} color="var(--accent-2)" />}
                <div style={{ fontSize: 10.5, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                  <b style={{ color: 'var(--text)' }}>{locked ? 'Forensic vault locked.' : 'Forensic vault open.'}</b> All scans stay on-device in IndexedDB; the mutation queue only leaves the device when you press Sync. No audio or video is uploaded — analysis happens entirely in the local Web Audio graph.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <span className="chip" style={{ fontSize: 8.5 }}><Cpu size={10} /> 60 FPS target</span>
              <span className="chip" style={{ fontSize: 8.5 }}><ShieldCheck size={10} /> RBAC live</span>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
