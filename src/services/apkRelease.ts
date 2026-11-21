/**
 * apkRelease.ts — reads the published release manifest so the APK Center shows
 * real size / checksum / build time instead of placeholders.
 *
 * The manifest is written by scripts/postbuild-apk.mjs during the
 * build-and-bundle-apk workflow.
 */

export interface ApkRelease {
  version: string;
  sizeBytes: number;
  sha256: string;
  builtAt: string;
  abi: string;
  entries: number;
}

const MANIFEST = '/releases/sonostruct-release.json';
const APK = '/releases/sonostruct-release.apk';

export const apkUrl = APK;

/** Returns the manifest, or null when no APK has been published yet. */
export async function loadRelease(): Promise<ApkRelease | null> {
  try {
    const res = await fetch(MANIFEST, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ApkRelease>;
    if (!data.sha256 || !data.sizeBytes) return null;
    return {
      version: data.version ?? '1.0.0',
      sizeBytes: data.sizeBytes,
      sha256: data.sha256,
      builtAt: data.builtAt ?? '',
      abi: data.abi ?? 'universal',
      entries: data.entries ?? 0,
    };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function shortSha(sha: string, groups = 4): string {
  return (sha.match(/.{1,8}/g) ?? []).slice(0, groups).join(' ');
}
