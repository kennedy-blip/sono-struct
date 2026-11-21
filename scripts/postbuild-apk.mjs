#!/usr/bin/env node
/**
 * postbuild-apk.mjs — turns a Gradle output APK into the artifact the web app serves.
 *
 * - verifies the APK is a real zip with AndroidManifest.xml + classes.dex
 * - copies it to public/releases/sonostruct-release.apk
 * - writes public/releases/sonostruct-release.json (size, sha256, version, builtAt)
 *
 * Usage: node scripts/postbuild-apk.mjs <path-to-apk>
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/postbuild-apk.mjs <path-to-apk>');
  process.exit(2);
}
if (!existsSync(src)) {
  console.error(`APK not found: ${src}`);
  process.exit(1);
}

const buf = readFileSync(src);

// Minimal zip central-directory scan: prove it is a zip and list entry names.
function zipEntryNames(b) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
    if (b.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record (not a zip)');
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    names.push(b.subarray(off + 46, off + 46 + nameLen).toString('utf8'));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

let names;
try {
  names = zipEntryNames(buf);
} catch (err) {
  console.error(`invalid APK: ${err.message}`);
  process.exit(1);
}

const required = ['AndroidManifest.xml', 'classes.dex'];
const missing = required.filter((r) => !names.includes(r));
if (missing.length) {
  console.error(`APK missing required entries: ${missing.join(', ')}`);
  process.exit(1);
}
if (buf.length < 200_000) {
  console.error(`APK suspiciously small (${buf.length} bytes) — refusing to publish`);
  process.exit(1);
}

const sha256 = createHash('sha256').update(buf).digest('hex');
const outDir = resolve('public/releases');
mkdirSync(outDir, { recursive: true });
const outApk = resolve(outDir, 'sonostruct-release.apk');
copyFileSync(src, outApk);

const meta = {
  app: 'SONO-STRUCT',
  package: 'com.sonostruct.ndt',
  version: '1.0.0',
  abi: 'arm64-v8a + armeabi-v7a (universal)',
  sizeBytes: statSync(outApk).size,
  sha256,
  builtAt: new Date().toISOString(),
  entries: names.length,
};
writeFileSync(resolve(outDir, 'sonostruct-release.json'), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`✓ verified APK (${names.length} entries, ${(meta.sizeBytes / 1048576).toFixed(2)} MB)`);
console.log(`  sha256 ${sha256}`);
console.log(`  → ${outApk}`);
console.log(`  manifest ${dirname(outApk)}/sonostruct-release.json`);
