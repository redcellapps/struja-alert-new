import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Non-negotiables (BRIEF §8, docs/phase3-plan.md decision 5): the app never asks for the calendar
// (the outage detail opens the system "add event" screen through an intent) and never for the
// location (the person types and picks the address).
const FORBIDDEN = [
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
];

const root = join(__dirname, '..');
interface AppJson {
  expo: { android?: { permissions?: string[] }; plugins: unknown[] };
}
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const read = <T>(file: string): T => JSON.parse(readFileSync(join(root, file), 'utf8')) as T;

// The merged manifests Gradle wrote for the last build (the app's own plus every library's).
function mergedManifests(): string[] {
  const base = join(root, 'android', 'app', 'build', 'intermediates');
  if (!existsSync(base)) return [];
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, depth + 1);
      else if (name === 'AndroidManifest.xml' && /merged_manifest/.test(path)) found.push(path);
    }
  };
  for (const dir of readdirSync(base).filter((d) => d.startsWith('merged_manifest'))) {
    walk(join(base, dir), 0);
  }
  return found;
}

describe('permissions', () => {
  it('the Expo config asks for no calendar or location permission, and installs no calendar module', () => {
    const app = read<AppJson>('app.json').expo;
    const pkg = read<PackageJson>('package.json');
    const declared = app.android?.permissions ?? [];
    for (const p of FORBIDDEN) expect(declared).not.toContain(p);
    const plugins = app.plugins.map((p) => (Array.isArray(p) ? (p[0] as unknown) : p));
    expect(plugins).not.toContain('expo-calendar');
    expect(plugins).not.toContain('expo-location');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['expo-calendar']).toBeUndefined();
    expect(deps['expo-location']).toBeUndefined();
  });

  it('the merged Android manifest of the last build has none of them', () => {
    const files = mergedManifests();
    // Nothing built on this machine yet (a fresh clone or CI without a native build): the config
    // check above still holds the line.
    if (files.length === 0) return;
    for (const file of files) {
      const xml = readFileSync(file, 'utf8');
      for (const p of FORBIDDEN)
        expect({ file, permission: p, found: xml.includes(p) }).toEqual({
          file,
          permission: p,
          found: false,
        });
    }
  });
});
