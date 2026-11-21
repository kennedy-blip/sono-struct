import React, { Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Chrome, Toast } from './components/Backdrop';
import { Header, MobileHeader } from './components/Header';
import { MetaballDock } from './components/Dock';
import { ApkCenter } from './components/ApkCenter';
import { PrivilegeDrawer } from './components/PrivilegeDrawer';
import { useApp } from './state/AppState';
import { spring } from './components/ui';

const ImpactEcho = lazy(() => import('./components/modules/ImpactEcho'));
const HydroListen = lazy(() => import('./components/modules/HydroListen'));
const RT60Architect = lazy(() => import('./components/modules/RT60Architect'));
const Clinometer = lazy(() => import('./components/modules/Clinometer'));
const InspectionVault = lazy(() => import('./components/modules/InspectionVault'));

const MODULE_TITLES = {
  impact: 'Impact-Echo Scanner',
  hydro: 'Hydro-Listen Lab',
  rt60: 'RT60 Architect',
  level: 'AR Clinometer',
  vault: 'Inspection Vault',
};

function ModuleBody({ id }: { id: keyof typeof MODULE_TITLES }) {
  const fallback = <div className="glass" style={{ padding: 40, textAlign: 'center', fontSize: 12 }}>Loading {MODULE_TITLES[id]} engine…</div>;
  return (
    <Suspense fallback={fallback}>
      {id === 'impact' && <ImpactEcho />}
      {id === 'hydro' && <HydroListen />}
      {id === 'rt60' && <RT60Architect />}
      {id === 'level' && <Clinometer />}
      {id === 'vault' && <InspectionVault />}
    </Suspense>
  );
}

function StatusStrip() {
  const { counts, online, syncNow, syncing, sensors, cloud } = useApp();
  const active = Object.values(sensors).filter((s) => s === 'ACTIVE').length;
  return (
    <div className="glass" style={{ display: 'flex', gap: 14, padding: '9px 14px', borderRadius: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 10 }}>
      <span className="label">System</span>
      <span className="mono" style={{ color: online ? 'var(--accent-2)' : 'var(--warn)' }}>{online ? '● ONLINE' : '● OFFLINE-FIRST'}</span>
      <span className="mono dim">sensors {active}/4 active</span>
      <span className="mono dim">queue {counts.pending}</span>
      <span
        className="mono dim"
        title={
          cloud.phase === 'local' ? 'Local IndexedDB only — add Supabase keys to enable cloud sync'
            : cloud.phase === 'checking' ? 'Probing the Supabase ledger…'
              : cloud.phase === 'ok' ? `Supabase ledger reachable · ${cloud.remoteRows} rows on this device`
                : `Supabase unreachable${cloud.error ? `: ${cloud.error}` : ''} — queue still works locally`
        }
      >
        sync {cloud.phase === 'local' ? 'local' : cloud.phase === 'checking' ? 'cloud …' : cloud.phase === 'ok' ? 'cloud ✓' : 'cloud ✕'}
      </span>
      <span className="mono dim">vault {counts.scans + counts.leaks + counts.rooms} records</span>
      <button className="btn" onClick={() => void syncNow()} disabled={syncing} style={{ marginLeft: 'auto', padding: '4px 9px', fontSize: 10 }}>
        {syncing ? 'Syncing…' : 'Sync queue'}
      </button>
    </div>
  );
}

export default function App() {
  const { module, view, setView, apkOpen, privOpen } = useApp();
  const depthPush = apkOpen || privOpen;
  const setViewDesktop = () => setView('desktop');

  return (
    <>
      <Chrome />
      <div style={{ position: 'relative', zIndex: 2, minHeight: '100%' }}>
        <motion.div
          animate={{
            scale: depthPush ? 0.94 : 1,
            filter: depthPush ? 'blur(6px)' : 'blur(0px)',
            borderRadius: depthPush ? 28 : 0,
          }}
          transition={spring}
          style={{ transformOrigin: '50% 26%', overflow: 'hidden', minHeight: '100vh' }}
        >
          {view === 'desktop' ? (
            <>
              <Header />
              <main style={{ padding: '16px 16px 110px', maxWidth: 1480, margin: '0 auto', display: 'grid', gap: 16 }}>
                <StatusStrip />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={module}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                  >
                    <ModuleBody id={module} />
                  </motion.div>
                </AnimatePresence>
                <footer style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="label" style={{ fontSize: 8.5 }}>SonoStruct v1.0.0 · acoustic NDT · architectural physics</span>
                  <span className="mono dim" style={{ fontSize: 8.5 }}>c = 343 m/s · Sabine 0.161 · Buck dew-point</span>
                  <span className="mono dim" style={{ fontSize: 8.5, marginLeft: 'auto' }}>offline-first IndexedDB vault</span>
                </footer>
              </main>
              <MetaballDock />
            </>
          ) : (
            <div style={{ minHeight: '100vh', padding: '10px 10px 0' }}>
              <PhoneChassis>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'color-mix(in srgb, var(--bg-0) 80%, transparent)' }}>
                  <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--stroke)' }}>
                    <MobileHeader />
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px 8px' }}>
                    <AnimatePresence mode="wait">
                      <motion.div key={module} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
                        <ModuleBody id={module} />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  <div style={{ padding: '0 8px 6px', borderTop: '1px solid var(--stroke)', background: 'color-mix(in srgb, var(--bg-0) 92%, transparent)' }}>
                    <MetaballDock compact />
                  </div>
                </div>
              </PhoneChassis>
              <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
                <button className="btn" onClick={() => setViewDesktop()} style={{ fontSize: 10.5 }}>← Back to Desktop Engineering Station</button>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      <ApkCenter />
      <PrivilegeDrawer />
      <Toast />
      <style>{`
        @media (max-width: 820px) {
          .mobile-forced { display: block !important; }
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .mono { letter-spacing: 0.01em; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>
    </>
  );
}

function PhoneChassis({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 430, margin: '0 auto', height: 'min(880px, calc(100vh - 20px))',
        borderRadius: 38, border: '1px solid var(--stroke)', overflow: 'hidden',
        boxShadow: '0 40px 90px -40px rgba(0,0,0,0.95), inset 0 1px 1px rgba(255,255,255,0.16)',
        background: 'var(--glass-strong)', position: 'relative', backdropFilter: 'blur(20px)',
      }}
    >
      <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 88, height: 20, borderRadius: 99, background: 'rgba(2,6,14,0.85)', zIndex: 5, display: 'grid', placeItems: 'center' }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: 'rgba(148,197,255,0.45)' }} />
      </div>
      <div style={{ height: '100%', paddingTop: 4 }}>{children}</div>
    </div>
  );
}
