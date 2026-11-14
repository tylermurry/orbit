import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyContract, parseContract, schema, serializeContract, validateContract, validateSemantics } from '../src/index.js';
import { beh, contract, ent, rel, tdef } from './fixtures.js';

const codes = (text: string) => parseContract(text).diagnostics.map((d) => d.code);
const json = (v: unknown) => JSON.stringify(v, null, 2);

const valid = () =>
  contract({
    entities: [ent('cap.a', { behaviors: [beh('b.1', ['t.1'])] }), ent('sys.s')],
    relationships: [rel('r.1', 'cap.a', 'sys.s', 'implementedBy')],
    tests: [tdef('t.1')],
    validation: { command: 'npm test', results: 'test-results/junit.xml' },
  });

describe('parseContract', () => {
  it('accepts a valid contract', () => {
    const r = parseContract(json(valid()));
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(false);
    expect(r.diagnostics).toEqual([]);
    expect(r.contract).toEqual(valid());
  });

  it('reports json.syntax with line/column and no contract', () => {
    const r = parseContract('{\n  "schemaVersion": 1,\n  "product": ,\n}');
    expect(r.ok).toBe(false);
    expect(r.contract).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ code: 'json.syntax', severity: 'error' });
    expect(r.diagnostics[0]!.line).toBe(3);
    expect(r.diagnostics.every((d) => d.code === 'json.syntax')).toBe(true);
  });

  it('rejects trailing commas and comments', () => {
    expect(codes('{"a": 1,}')).toContain('json.syntax');
    expect(codes('{"a": 1 /* c */}')).toContain('json.syntax');
  });

  it('reports empty input', () => {
    const r = parseContract('');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.code).toBe('json.syntax');
  });

  it('non-object roots produce schema errors and no contract', () => {
    const r = parseContract('[]');
    expect(r.ok).toBe(false);
    expect(r.contract).toBeUndefined();
    expect(r.diagnostics[0]!.code).toBe('schema.type');
    expect(r.diagnostics[0]!.line).toBe(1);
  });

  it('maps schema errors to line and column', () => {
    const text = '{\n  "schemaVersion": 2,\n  "product": {"id": "p", "name": "P", "summary": "S"},\n  "entities": [], "relationships": [], "tests": []\n}';
    const r = parseContract(text);
    const d = r.diagnostics.find((x) => x.code === 'schema.const')!;
    expect(d).toMatchObject({ path: '/schemaVersion', line: 2, column: 20 });
    expect(r.contract).toBeDefined(); // soft error: still displayable
    expect(r.ok).toBe(false);
  });

  it('reports missing required properties by name', () => {
    const r = parseContract(json({ schemaVersion: 1 }));
    const missing = r.diagnostics.filter((d) => d.code === 'schema.required').map((d) => d.message);
    expect(missing.some((m) => m.includes("'entities'"))).toBe(true);
    expect(missing.some((m) => m.includes("'product'"))).toBe(true);
    expect(r.contract).toBeUndefined();
  });

  it('reports unknown properties pointing at the key', () => {
    const c: Record<string, unknown> = { ...valid(), extra: 1 };
    const text = json(c);
    const r = parseContract(text);
    const d = r.diagnostics.find((x) => x.code === 'schema.additionalProperties')!;
    expect(d.path).toBe('/extra');
    expect(d.message).toContain("'extra'");
    expect(text.split('\n')[d.line! - 1]).toContain('"extra"');
    expect(d.column).toBe(3);
  });

  it('reports blank names once, naming the entity', () => {
    const c = valid();
    c.entities[0]!.name = '   ';
    const r = parseContract(json(c));
    const blank = r.diagnostics.filter((d) => d.path === '/entities/0/name');
    expect(blank).toHaveLength(1);
    expect(blank[0]!.message).toContain("Entity 'cap.a'");
    expect(blank[0]!.message).toContain('blank');
    expect(r.contract?.entities).toHaveLength(2); // blank name is renderable
    expect(r.partial).toBe(false);
  });

  it('reports bad enums with allowed values', () => {
    const c = valid();
    (c.entities[0] as unknown as { kind: string }).kind = 'widget';
    const r = parseContract(json(c));
    const d = r.diagnostics.find((x) => x.code === 'schema.enum')!;
    expect(d.message).toContain("'capability', 'system'");
    expect(d.path).toBe('/entities/0/kind');
    expect(r.partial).toBe(true);
    expect(r.contract?.entities.map((e) => e.id)).toEqual(['sys.s']);
  });

  it('reports schema.type for wrong types', () => {
    const c = valid();
    (c.entities[0] as unknown as { behaviors: unknown }).behaviors = 'none';
    const r = parseContract(json(c));
    expect(r.diagnostics.some((d) => d.code === 'schema.type' && d.path === '/entities/0/behaviors')).toBe(true);
  });

  it('keeps the validation block, and rejects an empty command or unknown keys', () => {
    expect(parseContract(json(valid())).contract!.validation).toEqual({ command: 'npm test', results: 'test-results/junit.xml' });
    const blank = JSON.parse(json(valid()));
    blank.validation.command = ' ';
    const r = parseContract(JSON.stringify(blank));
    expect(r.ok).toBe(false);
    expect(r.contract?.validation).toBeUndefined(); // unusable for display, so dropped
    const extra = JSON.parse(json(valid()));
    extra.validation.timeout = 5;
    expect(parseContract(JSON.stringify(extra)).ok).toBe(false);
  });

  it('rejects the retired evidence array', () => {
    const old = JSON.parse(json(valid()));
    old.evidence = [];
    expect(parseContract(JSON.stringify(old)).diagnostics.some((d) => d.path === '' || d.path.startsWith('/evidence'))).toBe(true);
    expect(parseContract(JSON.stringify(old)).ok).toBe(false);
  });

  it('flags duplicate ids for every namespace, behaviors globally', () => {
    const c = contract({
      entities: [ent('cap.a', { behaviors: [beh('b.1')] }), ent('cap.a'), ent('cap.b', { behaviors: [beh('b.1')] })],
      relationships: [rel('r', 'cap.a', 'cap.b'), rel('r', 'cap.b', 'cap.a')],
      tests: [tdef('t'), tdef('t')],
    });
    const d = parseContract(json(c)).diagnostics.filter((x) => x.code === 'id.duplicate');
    expect(d.map((x) => x.path).sort()).toEqual(
      ['/entities/1/id', '/entities/2/behaviors/0/id', '/relationships/1/id', '/tests/1/id'].sort(),
    );
  });

  it('flags parent problems: missing, cross-kind, cycle (every member, self-parent too)', () => {
    const c = contract({
      entities: [
        ent('cap.missing', { parentId: 'cap.nope' }),
        ent('cap.wrong', { parentId: 'sys.s' }),
        ent('sys.s'),
        ent('cap.x', { parentId: 'cap.y' }),
        ent('cap.y', { parentId: 'cap.z' }),
        ent('cap.z', { parentId: 'cap.x' }),
        ent('cap.self', { parentId: 'cap.self' }),
        ent('cap.child-of-cycle', { parentId: 'cap.x' }),
      ],
    });
    const d = parseContract(json(c)).diagnostics;
    expect(d.filter((x) => x.code === 'ref.parent.missing')).toHaveLength(1);
    expect(d.find((x) => x.code === 'ref.parent.kind')!.message).toContain('capabilities must have capability parents');
    const cyc = d.filter((x) => x.code === 'hierarchy.cycle');
    expect(cyc.map((x) => x.path).sort()).toEqual(['/entities/3/parentId', '/entities/4/parentId', '/entities/5/parentId', '/entities/6/parentId']);
    expect(cyc.find((x) => x.path === '/entities/3/parentId')!.relatedIds).toEqual(['cap.x', 'cap.y', 'cap.z']);
  });

  it('flags system with capability parent with system wording', () => {
    const c = contract({ entities: [ent('cap.a'), ent('sys.b', { parentId: 'cap.a' })] });
    expect(parseContract(json(c)).diagnostics[0]!.message).toContain('systems must have system parents');
  });

  it('flags relationship problems and drops those edges from the display contract', () => {
    const c = contract({
      entities: [ent('cap.a'), ent('cap.b')],
      relationships: [rel('r.ok', 'cap.a', 'cap.b'), rel('r.src', 'x', 'cap.b'), rel('r.tgt', 'cap.a', 'y'), rel('r.self', 'cap.a', 'cap.a')],
    });
    const r = parseContract(json(c));
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual(['ref.relationship.source', 'ref.relationship.target', 'relationship.self']);
    expect(r.contract!.relationships.map((x) => x.id)).toEqual(['r.ok']);
    expect(r.partial).toBe(true);
  });

  it('permits directed relationship cycles', () => {
    const c = contract({ entities: [ent('cap.a'), ent('cap.b')], relationships: [rel('r1', 'cap.a', 'cap.b'), rel('r2', 'cap.b', 'cap.a')] });
    expect(parseContract(json(c)).ok).toBe(true);
  });

  it('treats unknown behavior tests as errors and duplicate testIds as warnings', () => {
    const c = contract({
      entities: [ent('cap.a', { behaviors: [beh('b', ['t', 't', 'missing'])] })],
      tests: [tdef('t')],
    });
    const r = parseContract(json(c));
    const by = (code: string) => r.diagnostics.filter((d) => d.code === code);
    expect(by('ref.behavior.test')[0]).toMatchObject({ severity: 'error', path: '/entities/0/behaviors/0/testIds/2' });
    expect(by('behavior.testIds.duplicate')[0]).toMatchObject({ severity: 'warning', path: '/entities/0/behaviors/0/testIds/1' });
    expect(r.contract!.entities[0]!.behaviors).toHaveLength(1); // kept for display
  });

  it('warnings alone keep ok true', () => {
    const c = contract({ entities: [ent('cap.a', { behaviors: [beh('b', ['t', 't'])] })], tests: [tdef('t')] });
    const r = parseContract(json(c));
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toHaveLength(1);
  });

  it('keeps original indices in paths after dropping unsafe items', () => {
    const c = valid() as unknown as { entities: unknown[]; relationships: unknown[] };
    c.entities.unshift({ kind: 'capability' }); // no id, dropped
    c.relationships.unshift(rel('r.bad', 'cap.a', 'nope'));
    const r = parseContract(json(c));
    const d = r.diagnostics.find((x) => x.code === 'ref.relationship.target')!;
    expect(d.path).toBe('/relationships/0/targetId');
    expect(r.contract!.entities.map((e) => e.id)).toEqual(['cap.a', 'sys.s']);
    expect(r.partial).toBe(true);
  });

  it('sorts diagnostics by position', () => {
    const r = parseContract(readFileSync(new URL('../../../examples/invalid.orbit.json', import.meta.url), 'utf8'));
    const lines = r.diagnostics.map((d) => d.line!);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });
});

describe('validateContract / validateSemantics', () => {
  it('validates parsed values without line info', () => {
    expect(validateContract(valid())).toEqual([]);
    const d = validateContract({ ...valid(), schemaVersion: 3 });
    expect(d[0]).toMatchObject({ code: 'schema.const' });
    expect(d[0]!.line).toBeUndefined();
  });

  it('validateSemantics runs cross-reference checks only', () => {
    const c = contract({ entities: [ent('cap.a', { parentId: 'cap.zzz' })] });
    expect(validateSemantics(c).map((d) => d.code)).toEqual(['ref.parent.missing']);
  });

  it('handles garbage values', () => {
    expect(validateContract(null).length).toBeGreaterThan(0);
    expect(validateContract({ entities: 5 }).length).toBeGreaterThan(0);
  });
});

describe('serializeContract', () => {
  it('writes canonical key order, 2-space indent, trailing newline', () => {
    const messy = {
      validation: { results: 'r.xml', command: 'npm test' },
      tests: [{ location: 'l', name: 'n', id: 't' }],
      relationships: [{ description: 'x', targetId: 'b', sourceId: 'a', type: 'uses', id: 'r' }],
      entities: [{ behaviors: [{ testIds: ['t'], expected: 'x', name: 'n', id: 'b' }], description: '', summary: 's', name: 'n', parentId: null, kind: 'capability', id: 'a' }],
      product: { description: 'd', summary: 's', name: 'n', id: 'p' },
      schemaVersion: 1,
    };
    const out = serializeContract(messy as never);
    expect(out.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(out))).toEqual(['schemaVersion', 'product', 'entities', 'relationships', 'tests', 'validation']);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed.product)).toEqual(['id', 'name', 'summary', 'description']);
    expect(Object.keys(parsed.entities[0])).toEqual(['id', 'kind', 'parentId', 'name', 'summary', 'description', 'behaviors']);
    expect(Object.keys(parsed.entities[0].behaviors[0])).toEqual(['id', 'name', 'expected', 'testIds']);
    expect(Object.keys(parsed.relationships[0])).toEqual(['id', 'type', 'sourceId', 'targetId', 'description']);
    expect(Object.keys(parsed.tests[0])).toEqual(['id', 'name', 'location']);
    expect(Object.keys(parsed.validation)).toEqual(['command', 'results']);
    expect(out).toContain('\n  "product": {\n    "id"');
  });

  it('omits optional fields that are undefined and preserves array order', () => {
    const c = contract({ entities: [ent('cap.z'), ent('cap.a')], relationships: [{ ...rel('r', 'cap.z', 'cap.a'), description: undefined }] });
    const parsed = JSON.parse(serializeContract(c));
    expect(parsed.entities.map((e: { id: string }) => e.id)).toEqual(['cap.z', 'cap.a']);
    expect('description' in parsed.relationships[0]).toBe(false);
    expect('description' in parsed.product).toBe(false);
  });

  it('round-trips parse -> serialize -> parse and is idempotent', () => {
    const first = serializeContract(valid());
    const r = parseContract(first);
    expect(r.ok).toBe(true);
    expect(r.contract).toEqual(valid());
    expect(serializeContract(r.contract!)).toBe(first);
  });

  it('serialized output of the empty contract validates', () => {
    const c = createEmptyContract({ id: 'p', name: 'P', summary: 'S' });
    expect(parseContract(serializeContract(c)).ok).toBe(true);
    expect(createEmptyContract({ id: 'p', name: 'P', summary: 'S', description: 'D' }).product.description).toBe('D');
  });
});

describe('schema', () => {
  it('is JSON Schema 2020-12 with $id and descriptions everywhere', () => {
    const s = schema as { $schema: string; $id: string };
    expect(s.$schema).toContain('2020-12');
    expect(s.$id).toBeTruthy();
    const missing: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      const props = o.properties as Record<string, unknown> | undefined;
      if (props) for (const [k, v] of Object.entries(props)) {
        const p = v as Record<string, unknown>;
        if (!p.description && !p.$ref) missing.push(`${path}/${k}`);
        walk(v, `${path}/${k}`);
      }
      if (o.$defs) for (const [k, v] of Object.entries(o.$defs as object)) walk(v, `$defs/${k}`);
      if (o.items) walk(o.items, `${path}[]`);
    };
    walk(schema, '');
    expect(missing).toEqual([]);
  });

  it('rejects additional properties at every level', () => {
    const c = valid() as never as Record<string, Record<string, unknown>[] | Record<string, unknown>>;
    for (const mutate of [
      (x: typeof c) => ((x.product as Record<string, unknown>).zz = 1),
      (x: typeof c) => ((x.entities as Record<string, unknown>[])[0]!.zz = 1),
      (x: typeof c) => (((x.entities as { behaviors: Record<string, unknown>[] }[])[0]!.behaviors[0]!).zz = 1),
      (x: typeof c) => ((x.relationships as Record<string, unknown>[])[0]!.zz = 1),
      (x: typeof c) => ((x.tests as Record<string, unknown>[])[0]!.zz = 1),
      (x: typeof c) => ((x.validation as Record<string, unknown>).zz = 1),
    ]) {
      const copy = JSON.parse(json(c));
      mutate(copy);
      expect(validateContract(copy).map((d) => d.code)).toContain('schema.additionalProperties');
    }
  });
});

describe('examples/invalid.orbit.json', () => {
  const r = parseContract(readFileSync(new URL('../../../examples/invalid.orbit.json', import.meta.url), 'utf8'));

  it('triggers every expected diagnostic code', () => {
    const got = new Set(r.diagnostics.map((d) => d.code));
    for (const code of [
      'schema.additionalProperties',
      'id.duplicate',
      'ref.parent.missing',
      'ref.parent.kind',
      'hierarchy.cycle',
      'ref.relationship.source',
      'ref.relationship.target',
      'relationship.self',
      'schema.enum',
      'schema.minLength',
      'ref.behavior.test',
    ]) expect(got, code).toContain(code);
  });

  it('flags both the duplicate entity and duplicate behavior ids', () => {
    const dups = r.diagnostics.filter((d) => d.code === 'id.duplicate').map((d) => d.relatedIds![0]);
    expect(dups).toContain('cap.tasks');
    expect(dups).toContain('behavior.shared');
  });

  it('gives every diagnostic a location and an actionable message', () => {
    for (const d of r.diagnostics) {
      expect(d.line, d.code).toBeGreaterThan(0);
      expect(d.column, d.code).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(20);
    }
  });

  it('is not ok but still returns a partial display contract', () => {
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(true);
    const c = r.contract!;
    expect(c.entities.map((e) => e.id)).toEqual(['cap.tasks', 'cap.lists', 'cap.reminders', 'cap.loop-a', 'cap.loop-b', 'sys.storage']);
    expect(c.entities[0]!.behaviors.map((b) => b.id)).toEqual(['behavior.tasks.create', 'behavior.shared']);
    expect(c.relationships).toEqual([]); // every edge in the example is broken
    expect(c.product.id).toBe('broken-tasky');
  });
});
