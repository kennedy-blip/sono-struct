import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Download, Package, ShieldCheck, Smartphone, Terminal, X } from 'lucide-react';
import { useApp } from '../state/AppState';
import { apkUrl, formatBytes, loadRelease, shortSha, type ApkRelease } from '../services/apkRelease';
import { spring } from './ui';

const APK_PATH = apkUrl;
const APK_NAME = 'SonoStruct-NDT-v1.0.0.apk';

/**
 * Downloads the compiled APK. If the workflow has not published one yet we do
 * NOT fake an installable file — we throw so the UI can say so plainly.
 */
async function triggerApkDownload(_viaModal: boolean): Promise<'bundle' | 'missing'> {
  const tryFetch = async (): Promise<boolean> => {
    try {
      const head = await fetch(APK_PATH, { method: 'HEAD', cache: 'no-store' });
      return head.ok && Number(head.headers.get('content-length') ?? '0') > 1024;
    } catch { return false; }
  };
  if (await tryFetch()) {
    const a = document.createElement('a');
    a.href = APK_PATH;
    a.download = APK_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'bundle';
  }
  return 'missing';
}

export function ApkCenter() {
  const { apkOpen, setApkOpen, toast } = useApp();
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState<ApkRelease | null>(null);
  const [probed, setProbed] = useState(false);
  const installUrl = typeof window !== 'undefined' ? `${window.location.origin}${APK_PATH}` : APK_PATH;

  useEffect(() => {
    let alive = true;
    void loadRelease().then((r) => { if (alive) { setRelease(r); setProbed(true); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!apkOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setApkOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apkOpen, setApkOpen]);

  const download = async () => {
    setChecking(true);
    const mode = await triggerApkDownload(true);
    setChecking(false);
    toast(
      mode === 'bundle'
        ? `Downloading ${APK_NAME} — verify SHA-256 after transfer.`
        : 'No compiled APK is published yet. Run the "Build & Bundle APK" workflow, which commits a signed release APK here.',
    );
  };

  const sizeLabel = release ? formatBytes(release.sizeBytes) : null;

  return (
    <AnimatePresence>
      {apkOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setApkOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 75, background: 'rgba(2,6,14,0.66)', backdropFilter: 'blur(12px)', display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.94, y: 16, opacity: 0 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="glass"
            style={{ width: 'min(880px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 26 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <span className="chip"><Package size={11} /> APK Distribution</span>
                <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', marginTop: 10 }}>SonoStruct for Android</div>
                <div className="dim" style={{ fontSize: 12.5, marginTop: 6, maxWidth: 480, lineHeight: 1.55 }}>
                  Full native edge-to-edge build of the same engine — wall tapping, pipe listening and spirit levelling with zero network dependency.
                </div>
              </div>
              <button className="btn" onClick={() => setApkOpen(false)} aria-label="Close"><X size={14} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,0.85fr)', gap: 18, marginTop: 20 }} className="apk-grid">
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => void download()}
                  disabled={checking}
                  style={{ width: '100%', padding: '14px 18px', fontSize: 13.5, borderRadius: 14, boxShadow: '0 18px 50px -18px color-mix(in srgb, var(--accent) 85%, transparent)' }}
                >
                  <Download size={16} />
                  {checking
                    ? 'Preparing package…'
                    : probed && !release
                      ? 'APK not built yet — run the build workflow'
                      : `Download Android .APK${sizeLabel ? ` — ${sizeLabel}` : ''}`}
                </button>
                <div className="mono dim" style={{ fontSize: 9.5, marginTop: 8, wordBreak: 'break-all' }}>{APK_PATH} → {APK_NAME}</div>
                {probed && !release && (
                  <div style={{ marginTop: 10, fontSize: 10.5, lineHeight: 1.5, color: 'var(--warn)' }}>
                    No release manifest at <span className="mono">/releases/sonostruct-release.json</span>. The APK is compiled by CI
                    (GitHub → Actions → “Build & Bundle APK”), which commits the signed artifact into <span className="mono">public/releases/</span>.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
                  <Badge icon={<Smartphone size={12} />} label="Version" value={release ? `v${release.version}` : 'v1.0.0 (pending)'} />
                  <Badge icon={<Check size={12} />} label="Offline ready" value="100% · IndexedDB" />
                  <Badge
                    icon={<ShieldCheck size={12} />}
                    label="SHA-256"
                    value={release ? shortSha(release.sha256) : 'not published'}
                    mono
                  />
                  <Badge icon={<Package size={12} />} label={release ? 'Built' : 'Engine'} value={release ? new Date(release.builtAt).toLocaleDateString() : 'WebAudio + IMU'} />
                </div>

                <div style={{ marginTop: 18 }}>
                  <div className="label" style={{ marginBottom: 10 }}>3-step sideload</div>
                  {[
                    'Settings → Apps → Special access → Install unknown apps → allow your browser or file manager.',
                    'Open the downloaded SonoStruct-NDT-v1.0.0.apk and tap Install (Play Protect may ask for confirmation).',
                    'Launch SonoStruct — grant Microphone + Motion for live modes, or stay in simulator mode with zero permissions.',
                  ].map((step, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 9 }}>
                      <div className="mono" style={{ width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800, background: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--accent)', flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>{step}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ padding: 12, borderRadius: 18, background: '#fff', boxShadow: '0 16px 40px -20px rgba(0,0,0,0.9)' }}>
                  <QRCodeSVG value={installUrl} size={168} level="M" bgColor="#ffffff" fgColor="#04121a" includeMargin={false} />
                </div>
                <div className="label" style={{ textAlign: 'center', fontSize: 8.5 }}>Scan with your Android camera</div>
                <div className="glass" style={{ padding: 12, width: '100%', marginTop: 4 }}>
                  <div className="label" style={{ fontSize: 8, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><Terminal size={9} /> CI pipeline</div>
                  <pre className="mono" style={{ margin: 0, fontSize: 8.5, lineHeight: 1.6, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{`npm ci && npm run build
npx cap sync android
./gradlew assembleRelease
cp → public/releases/
  sonostruct-release.apk`}</pre>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { triggerApkDownload };

function Badge({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="glass" style={{ padding: '9px 11px', borderRadius: 12 }}>
      <div className="label" style={{ fontSize: 8, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>{icon} {label}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 11.5, fontWeight: 750, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
