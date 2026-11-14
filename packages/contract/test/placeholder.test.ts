import { describe, expect, it } from 'vitest';
import { behaviorAssurance, diffContracts, parseContract, serializeContract } from '../src/index.js';
import { beh, contract, ent, tdef } from './fixtures.js';

const planned = { ...tdef('t.planned'), placeholder: true as const };
const base = contract({
  entities: [ent('cap.a', { behaviors: [beh('b.planned', ['t.planned']), beh('b.mixed', ['t.planned', 't.real'])] })],
  tests: [planned, tdef('t.real')],
});

describe('placeholder tests', () => {
  it('round-trip through the schema and the canonical serializer', () => {
    const text = serializeContract(base);
    expect(text).toContain('"placeholder": true');
    const p = parseContract(text);
    expect(p.ok).toBe(true);
    expect(p.contract!.tests[0].placeholder).toBe(true);
    expect(serializeContract({ ...base, tests: [tdef('t.real')] })).not.toContain('placeholder');
  });

  it('rejects placeholder: false (omit it instead)', () => {
    const bad = JSON.parse(serializeContract(base));
    bad.tests[0].placeholder = false;
    expect(parseContract(JSON.stringify(bad)).ok).toBe(false);
  });

  it('never count as coverage', () => {
    const ctx = { results: new Map([['t.real', { status: 'passed' as const, at: '2026-01-01T00:00:00Z' }]]), since: null };
    expect(behaviorAssurance(base, 'b.planned', ctx)!.status).toBe('planned');
    expect(behaviorAssurance(base, 'b.mixed', ctx)!.status).toBe('passing');
  });

  it('implementing a placeholder is a verification change on the test', () => {
    const impl = { ...base, tests: [tdef('t.planned'), tdef('t.real')] };
    const d = diffContracts(base, impl);
    const ch = d.changes.find((x) => x.key === 'test:t.planned')!;
    expect(ch.kind).toBe('modified');
    expect(ch.group).toBe('verification');
    expect(ch.fields.map((f) => f.field)).toEqual(['placeholder']);
  });
});
