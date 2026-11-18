import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [version, base] = process.argv.slice(2);
if (!/^[1-9]\d*$/.test(version ?? '') || !base || new URL(base).protocol !== 'https:') {
  process.stderr.write('Usage: node scripts/skills-manifest.mjs <release-number> <immutable-https-skill-directory/>\n');
  process.exit(1);
}
const files = {};
for (const name of ['orbit-plan', 'orbit-sync', 'orbit-implement']) {
  const path = `${name}/SKILL.md`;
  const bytes = await readFile(new URL(`../skills/claude/${path}`, import.meta.url));
  files[name] = { url: new URL(path, base.endsWith('/') ? base : `${base}/`).href, sha256: createHash('sha256').update(bytes).digest('hex') };
}
process.stdout.write(JSON.stringify({ version: Number(version), mcpVersion: 1, files }, null, 2) + '\n');
