/**
 * Headless DOM smoke test for the full SONO-STRUCT workflow.
 *
 *   npm run test:smoke
 *
 * Boots the real React tree inside jsdom with a stubbed Web Audio graph and
 * frozen-indexeddb backing, then drives: tier gating → RT60 measurement + save
 * → leak listen + save → wall scan + save → clinometer lock → mobile chassis →
 * ledger → blueprint modal → sync-queue drain.
 */
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import 'fake-indexeddb/auto';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
for (const k of ['HTMLElement', 'Element', 'Node', 'Event', 'SVGElement', 'HTMLDivElement', 'HTMLCanvasElement',
  'HTMLVideoElement', 'HTMLInputElement', 'DOMParser', 'getComputedStyle', 'CSSStyleDeclaration', 'AnimationEvent',
  'PointerEvent', 'MouseEvent', 'KeyboardEvent', 'Text', 'Comment', 'DocumentFragment', 'AbortController',
  'AbortSignal', 'DOMRect', 'ResizeObserver', 'MutationObserver']) {
  if (window[k] !== undefined) globalThis[k] = window[k];
}
globalThis.devicePixelRatio = 1;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 8);
window.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
window.matchMedia = globalThis.matchMedia = () => ({
  matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
});
window.ResizeObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const rect = () => ({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0 });
const ctxStub = () => new Proxy({
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  measureText: () => ({ width: 10 }),
}, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
window.HTMLCanvasElement.prototype.getContext = () => ctxStub();
window.HTMLCanvasElement.prototype.getBoundingClientRect = rect;
window.HTMLElement.prototype.getBoundingClientRect = rect;

const param = () => ({
  value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {},
  setTargetAtTime() {}, cancelScheduledValues() {},
});
class FakeNode {
  constructor() { this.gain = param(); this.frequency = param(); this.Q = param(); }
  connect(n) { return n; } disconnect() {} start() {} stop() {}
}
class FakeCtx {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = new FakeNode(); }
  createGain() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), sampleRate: this.sampleRate }; }
  createAnalyser() {
    const n = new FakeNode();
    n.fftSize = 2048; n.frequencyBinCount = 1024; n.smoothingTimeConstant = 0;
    n.getFloatFrequencyData = (a) => a.fill(-96);
    n.getFloatTimeDomainData = (a) => a.fill(0);
    n.context = this;
    return n;
  }
  createMediaStreamSource() { return new FakeNode(); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
globalThis.AudioContext = window.AudioContext = FakeCtx;
window.webkitAudioContext = FakeCtx;
navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('denied in smoke test')) };
window.navigator.vibrate = () => true;
window.DeviceOrientationEvent = class {};

localStorage.setItem('sonostruct.role', 'director');
localStorage.setItem('sonostruct.theme', 'obsidian');

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  ssr: { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
});
process.on('unhandledRejection', (r) => console.log('UNHANDLED>', String((r && r.stack) || r).slice(0, 240)));

const problems = [];
console.error = (...a0) => {
  const a = [...a0];
  const f = a.shift();
  const msg = typeof f === 'string' ? f.replace(/%[sd]/g, () => String(a.shift())) : String(f);
  if (!/not wrapped in act|scrollTo/.test(msg)) problems.push(msg.slice(0, 200));
};

const App = (await server.ssrLoadModule('/src/App.tsx')).default;
const { AppProvider } = await server.ssrLoadModule('/src/state/AppState.tsx');

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(React.createElement(AppProvider, null, React.createElement(App))); });

let passed = 0;
let failed = 0;
const check = (label, ok) => {
  if (ok) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.log(`  ✘ ${label}`); }
};
const settle = async (ms = 200) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const waitFor = async (fn, label, tries = 25) => {
  for (let i = 0; i < tries; i++) { if (fn()) return true; await settle(150); }
  console.log(`    (timed out waiting for ${label})`);
  return false;
};
const clickables = () => [...document.querySelectorAll('button, [role="button"]')];
const click = async (pred, waitMs = 180) => {
  const b = clickables().find(pred);
  if (!b) { console.log(`    (no button matched: ${pred.toString().slice(0, 70)})`); return false; }
  await act(async () => { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await settle(waitMs);
  return true;
};
const nav = (label) => click((x) => x.textContent.trim() === label);
const text = () => document.body.textContent.replace(/\s+/g, ' ');

await settle(600);
check('desktop workstation boots with impact-echo module', text().includes('Wall / Stud / Conduit Scanner'));

await nav('Leaks');
check('hydro module loads', await waitFor(() => text().includes('Sub-Surface Leak Stethoscope'), 'hydro'));
check('idle stethoscope prompts for a signature', text().includes('Tap a plumbing signature to begin listening'));
await click((x) => x.textContent.includes('Pin-Hole Copper Leak'), 300);
check('plumbing signature drives the analyser',
  await waitFor(() => !text().includes('Tap a plumbing signature to begin listening'), 'live spectrum'));
await click((x) => x.textContent.includes('Commit leak report'));
check('leak report saves + queues', await waitFor(() => text().includes('plumbing ledger'), 'leak save'));

await nav('RT60');
check('pro tier unlocks RT60 architect', await waitFor(() => text().includes('Emit Dirac Sweep'), 'rt60'));
await click((x) => x.textContent.includes('Simulate Measurement'));
check('RT60 bands measured', await waitFor(() => /Avg RT60/.test(text()), 'rt60 measure'));
await click((x) => x.textContent.trim() === 'Save');
check('room blueprint saves', await waitFor(() => text().includes('Room acoustic blueprint committed'), 'room save'));

await nav('Scan');
await waitFor(() => text().includes('Save wall scan'), 'scan');
// Assert against the real IndexedDB contents, not a self-hiding toast.
const { db } = await server.ssrLoadModule('/src/services/db.ts');
await click((x) => x.textContent.includes('Save wall scan'), 400);
await waitFor(() => true, 'noop', 1);
const savedScan = await db.scans.orderBy('createdAt').reverse().first();
check('wall scan persists to the IndexedDB vault',
  (await db.scans.count()) >= 1 && (savedScan?.verdicts.length ?? 0) > 0 && (savedScan?.studCenters.length ?? 0) > 0);

await nav('Level');
check('clinometer exposes all engineering units',
  await waitFor(() => /Roof pitch/.test(text()) && /mm\/m/.test(text()), 'clinometer'));
await click((x) => x.textContent.trim() === 'Snap level');
check('0.0° lock fires', await waitFor(() => text().includes('LOCKED 0.0°'), 'lock'));

await click((x) => x.textContent.includes('MOBILE APK PREVIEW'));
check('mobile APK chassis renders', await waitFor(() => text().includes('NDT JOBSITE'), 'mobile'));
await click((x) => x.textContent.includes('Back to Desktop Engineering Station'));

await nav('Vault');
await waitFor(() => /Audit score/.test(text()), 'vault');
await click((x) => x.textContent.startsWith('Ledger'));
check('ledger lists the saved records', await waitFor(() => text().includes('Wall scan'), 'ledger'));
await click((x) => x.textContent.startsWith('Queue'));
check('sync queue controller lists mutations', await waitFor(() => text().includes('Mutation Sync Queue'), 'queue'));
await click((x) => x.textContent.includes('Drain'), 0);
check('queue drains to synced', await waitFor(() => /SYNCED/.test(text()), 'drain', 40));

await click((x) => x.textContent.startsWith('Ledger'));
await settle(300);
const card = [...document.querySelectorAll('div.glass')].find((d) => d.textContent.startsWith('Wall scan') && !d.textContent.includes('IndexedDB'));
if (card) await act(async () => { card.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
check('record morphs into blueprint modal', await waitFor(() => text().includes('Structural & acoustic engineering blueprint'), 'modal'));

check('no React runtime warnings', problems.length === 0);
if (problems.length) problems.slice(0, 6).forEach((p) => console.log('    >', p));

console.log(`\n${passed} passed, ${failed} failed`);
await server.close();
process.exit(failed === 0 ? 0 : 1);
