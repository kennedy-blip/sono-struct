#!/usr/bin/env node
/**
 * Sync the built web bundle into the Android project — without dragging the
 * published APK along with it.
 *
 * Why this exists: `public/releases/*` is part of the Vite output because the
 * website serves the download from there. Capacitor copies `webDir` verbatim
 * into `android/app/src/main/assets/public/`, so a plain `npx cap sync android`
 * embeds the *previous* release APK inside the *next* one. Each build then
 * shipped a copy of its own predecessor, inflating the artifact (5.7 MB →
 * 8.4 MB → …) and wasting bandwidth on every download.
 *
 * The web deploy is unaffected: Vercel builds from a clean checkout, so
 * `dist/releases/` is always regenerated and served there.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST_RELEASES = 'dist/releases';

function strip() {
  let names;
  try {
    names = readdirSync(DIST_RELEASES);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    // Keep README.md / docs in the bundle if you want; drop binary artifacts.
    if (!/\.(apk|aab|json)$/i.test(name)) continue;
    const p = join(DIST_RELEASES, name);
    try {
      if (!statSync(p).isFile()) continue;
    } catch {
      continue;
    }
    rmSync(p, { force: true });
    removed += 1;
  }
  return removed;
}

const removed = strip();
console.log(`sync-android: excluded ${removed} release artifact(s) from the embedded bundle`);

execFileSync('npx', ['cap', 'sync', 'android'], { stdio: 'inherit' });
