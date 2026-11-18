// Writes skills/manifest.json: the release Install / Update Skills reads from the main branch.
// Usage: node scripts/skills-manifest.mjs [--check]
//   (no flag)  regenerate; the release number goes up by one only when a skill's text changed
//   --check    exit 1 when the committed manifest does not match the skills (used in CI)
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/tylermurry/orbit/main/skills/claude/';
const NAMES = ['orbit-plan', 'orbit-sync', 'orbit-implement'];
const MANIFEST = new URL('../skills/manifest.json', import.meta.url);
const check = process.argv.includes('--check');

const files = {};
for (const name of NAMES) {
  const path = `${name}/SKILL.md`;
  const bytes = await readFile(new URL(`../skills/claude/${path}`, import.meta.url));
  files[name] = { url: new URL(path, BASE).href, sha256: createHash('sha256').update(bytes).digest('hex') };
}

let previous = null;
try {
  previous = JSON.parse(await readFile(MANIFEST, 'utf8'));
} catch {
  /* first run */
}
const unchanged = previous && NAMES.every((n) => previous.files?.[n]?.sha256 === files[n].sha256 && previous.files?.[n]?.url === files[n].url);
if (check) {
  if (!unchanged) {
    process.stderr.write('skills/manifest.json is out of date. Run: node scripts/skills-manifest.mjs\n');
    process.exit(1);
  }
  process.exit(0);
}
const version = unchanged ? previous.version : (previous?.version ?? 1) + 1;
await writeFile(MANIFEST, JSON.stringify({ version, mcpVersion: 1, files }, null, 2) + '\n');
process.stdout.write(`skills/manifest.json: release ${version}\n`);
