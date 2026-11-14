import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/mcp/tools';

const doc = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../MCP.md'), 'utf8');

describe('MCP.md', () => {
  const names = buildRegistry().map((d) => d.tool.name);

  it('lists every tool in the catalog table', () => {
    for (const n of names) expect(doc, n).toContain(`| \`${n}\` |`);
  });

  it('does not list tools that do not exist', () => {
    const listed = [...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...names].sort());
  });

  it('classifies read-only tools as read', () => {
    for (const d of buildRegistry()) {
      const row = doc.split('\n').find((l) => l.startsWith(`| \`${d.tool.name}\` |`))!;
      const kind = row.split('|')[2].trim();
      if (d.tool.annotations.readOnlyHint) expect(kind, d.tool.name).toBe('read');
      else expect(['write', 'navigate'], d.tool.name).toContain(kind);
    }
  });
});
