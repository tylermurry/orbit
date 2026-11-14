import { describe, expect, it } from 'vitest';
import { behaviorAssurance, computeAssurance, entityAssurance, resultStatus, testAssurance } from '../src/index.js';
import type { AssuranceContext, TestResult } from '../src/index.js';
import { beh, contract, ent, tdef } from './fixtures.js';

const PROPOSED = '2026-01-10T00:00:00Z';
const after = (status: TestResult['status']): TestResult => ({ status, at: '2026-01-12T00:00:00Z' });
const before = (status: TestResult['status']): TestResult => ({ status, at: '2026-01-05T00:00:00Z' });

const results = new Map<string, TestResult>([
  ['t.pass', after('passed')],
  ['t.fail', after('failed')],
  ['t.old', before('passed')],
  ['t.skip', after('skipped')],
]);
const ctx: AssuranceContext = { results, since: PROPOSED };
const anyTime: AssuranceContext = { results, since: null };

const c = contract({
  entities: [
    ent('cap.root', { behaviors: [beh('b.root.pass', ['t.pass']), beh('b.root.none')] }),
    ent('cap.child', {
      parentId: 'cap.root',
      behaviors: [beh('b.fail', ['t.fail']), beh('b.old', ['t.old']), beh('b.norun', ['t.norun']), beh('b.undef', ['t.ghost']), beh('b.multi', ['t.pass', 't.fail'])],
    }),
    ent('cap.grand', { parentId: 'cap.child', behaviors: [beh('b.skip', ['t.skip']), beh('b.planned', ['t.planned'])] }),
    ent('sys.s', { behaviors: [beh('b.sys', ['t.pass'])] }),
  ],
  tests: [...['t.pass', 't.fail', 't.old', 't.norun', 't.skip'].map(tdef), { ...tdef('t.planned'), placeholder: true as const }],
});

describe('resultStatus', () => {
  it('only passed/failed results at or after the proposal count', () => {
    expect(resultStatus(after('passed'), PROPOSED)).toBe('passing');
    expect(resultStatus(after('failed'), PROPOSED)).toBe('failing');
    expect(resultStatus(before('passed'), PROPOSED)).toBe('unconfirmed');
    expect(resultStatus(after('skipped'), PROPOSED)).toBe('unconfirmed');
    expect(resultStatus(undefined, PROPOSED)).toBe('unconfirmed');
    expect(resultStatus({ status: 'passed', at: PROPOSED }, PROPOSED)).toBe('passing'); // same instant counts
    expect(resultStatus({ status: 'passed', at: 'not a time' }, PROPOSED)).toBe('unconfirmed');
  });
  it('without a proposal any result counts', () => {
    expect(resultStatus(before('passed'), null)).toBe('passing');
    expect(resultStatus(before('failed'), null)).toBe('failing');
  });
  it('compares instants across offsets', () => {
    expect(resultStatus({ status: 'passed', at: '2026-01-10T01:00:00+02:00' }, PROPOSED)).toBe('unconfirmed'); // 2026-01-09T23:00Z
  });
});

describe('testAssurance', () => {
  it('reports status and the latest result', () => {
    expect(testAssurance(c, 't.pass', ctx)).toMatchObject({ defined: true, status: 'passing', result: after('passed') });
    expect(testAssurance(c, 't.old', ctx)).toMatchObject({ status: 'unconfirmed', result: before('passed') });
    expect(testAssurance(c, 't.norun', ctx).result).toBeUndefined();
  });
  it('placeholders are planned and undefined ids are undefined', () => {
    expect(testAssurance(c, 't.planned', ctx).status).toBe('planned');
    expect(testAssurance(c, 'nope', ctx)).toMatchObject({ defined: false, status: 'undefined' });
  });
});

describe('behaviorAssurance', () => {
  const status = (id: string, x = ctx) => behaviorAssurance(c, id, x)!.status;
  it('classifies behaviors', () => {
    expect(status('b.root.pass')).toBe('passing');
    expect(status('b.fail')).toBe('failing');
    expect(status('b.old')).toBe('unconfirmed');
    expect(status('b.norun')).toBe('unconfirmed');
    expect(status('b.skip')).toBe('unconfirmed');
    expect(status('b.planned')).toBe('planned');
    expect(status('b.root.none')).toBe('untested');
    expect(status('b.undef')).toBe('untested'); // only undefined test references
    expect(status('b.multi')).toBe('failing'); // failing wins over passing
  });
  it('passing needs every real test passing; placeholders alongside do not block it', () => {
    const cc = contract({
      entities: [ent('cap.a', { behaviors: [beh('two', ['t.pass', 't.old']), beh('mixed', ['t.pass', 't.planned'])] })],
      tests: [tdef('t.pass'), tdef('t.old'), { ...tdef('t.planned'), placeholder: true as const }],
    });
    expect(behaviorAssurance(cc, 'two', ctx)!.status).toBe('unconfirmed');
    expect(behaviorAssurance(cc, 'two', anyTime)!.status).toBe('passing');
    expect(behaviorAssurance(cc, 'mixed', ctx)!.status).toBe('passing');
  });
  it('lists undefined references without counting them', () => {
    const cc = contract({ entities: [ent('cap.a', { behaviors: [beh('b', ['ghost', 't.pass'])] })], tests: [tdef('t.pass')] });
    const b = behaviorAssurance(cc, 'b', ctx)!;
    expect(b.status).toBe('passing');
    expect(b.tests.map((t) => t.defined)).toEqual([false, true]);
    expect(b.entityId).toBe('cap.a');
  });
  it('returns undefined for unknown behaviors', () => {
    expect(behaviorAssurance(c, 'nope', ctx)).toBeUndefined();
  });
});

describe('entityAssurance', () => {
  it('aggregates the subtree without double counting', () => {
    const s = entityAssurance(c, 'cap.root', ctx);
    expect(s.total).toBe(9); // 2 + 5 + 2, not the system behavior
    expect(s).toMatchObject({ passing: 1, failing: 2, unconfirmed: 3, planned: 1, untested: 2, withTests: 6 });
    expect(new Set(s.behaviorIds.all).size).toBe(9);
    expect(s.behaviorIds.passing).toEqual(['b.root.pass']);
    expect(s.behaviorIds.untested).toEqual(['b.root.none', 'b.undef']);
    expect(s.passing + s.failing + s.unconfirmed).toBe(s.withTests);
    expect(s.withTests + s.planned + s.untested).toBe(s.total);
  });
  it('is scoped to the entity subtree and same kind', () => {
    expect(entityAssurance(c, 'cap.child', ctx).total).toBe(7);
    expect(entityAssurance(c, 'cap.grand', ctx).total).toBe(2);
    expect(entityAssurance(c, 'sys.s', ctx).total).toBe(1);
  });
  it('with no results everything with tests is unconfirmed', () => {
    const s = entityAssurance(c, 'cap.root', { results: new Map(), since: null });
    expect(s).toMatchObject({ passing: 0, failing: 0, unconfirmed: 6 });
  });
  it('unknown entity yields an empty summary', () => {
    expect(entityAssurance(c, 'nope', ctx).total).toBe(0);
  });
});

describe('computeAssurance', () => {
  it('matches entityAssurance for every entity', () => {
    for (const x of [ctx, anyTime]) {
      const all = computeAssurance(c, x);
      expect([...all.keys()].sort()).toEqual(c.entities.map((e) => e.id).sort());
      for (const e of c.entities) expect(all.get(e.id)).toEqual(entityAssurance(c, e.id, x));
    }
  });
  it('handles parent cycles and duplicate behavior ids by terminating with exact results', () => {
    const cc = contract({
      entities: [ent('cap.x', { parentId: 'cap.y', behaviors: [beh('dup')] }), ent('cap.y', { parentId: 'cap.x', behaviors: [beh('dup'), beh('y1')] })],
    });
    const all = computeAssurance(cc, ctx);
    expect(all.get('cap.x')!.total).toBe(2);
    expect(all.get('cap.y')!.total).toBe(2);
  });
  it('scales to thousands of entities', () => {
    const entities = [];
    for (let i = 0; i < 5000; i++) {
      entities.push(ent(`cap.${i}`, { parentId: i === 0 ? null : `cap.${Math.floor((i - 1) / 3)}`, behaviors: [beh(`b.${i}`, ['t.pass'])] }));
    }
    const big = contract({ entities, tests: [tdef('t.pass')] });
    const start = performance.now();
    const all = computeAssurance(big, ctx);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(all.get('cap.0')!.total).toBe(5000);
    expect(all.get('cap.0')!.passing).toBe(5000);
  });
  it('handles a deep chain without stack overflow', () => {
    const entities = [];
    for (let i = 0; i < 3000; i++) entities.push(ent(`cap.${i}`, { parentId: i === 0 ? null : `cap.${i - 1}`, behaviors: [beh(`b.${i}`)] }));
    expect(computeAssurance(contract({ entities }), ctx).get('cap.0')!.total).toBe(3000);
  });
});
