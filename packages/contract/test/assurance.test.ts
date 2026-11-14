import { describe, expect, it } from 'vitest';
import { behaviorAssurance, computeAssurance, entityAssurance, evidenceFreshness, testAssurance } from '../src/index.js';
import type { AssuranceContext } from '../src/index.js';
import { beh, contract, ent, ev, SHA_A, SHA_B, tdef } from './fixtures.js';

const at: AssuranceContext = { inspectedCommit: SHA_A };
const none: AssuranceContext = { inspectedCommit: null };

const c = contract({
  entities: [
    ent('cap.root', { behaviors: [beh('b.root.pass', ['t.pass']), beh('b.root.none')] }),
    ent('cap.child', {
      parentId: 'cap.root',
      behaviors: [beh('b.fail', ['t.fail']), beh('b.stale', ['t.stale']), beh('b.noev', ['t.noev']), beh('b.undef', ['t.ghost']), beh('b.multi', ['t.pass', 't.fail'])],
    }),
    ent('cap.grand', { parentId: 'cap.child', behaviors: [beh('b.skip', ['t.skip'])] }),
    ent('sys.s', { behaviors: [beh('b.sys', ['t.pass'])] }),
  ],
  tests: ['t.pass', 't.fail', 't.stale', 't.noev', 't.skip'].map(tdef),
  evidence: [
    ev('e1', 't.pass', 'passed', '2026-01-01T00:00:00Z', SHA_A),
    ev('e2', 't.fail', 'failed', '2026-01-01T00:00:00Z', SHA_A),
    ev('e3', 't.stale', 'passed', '2026-01-01T00:00:00Z', SHA_B),
    ev('e4', 't.skip', 'skipped', '2026-01-01T00:00:00Z', SHA_A),
  ],
});

describe('evidenceFreshness', () => {
  it('current / stale / unknown', () => {
    expect(evidenceFreshness(ev('e', 't', 'passed', '2026-01-01T00:00:00Z', SHA_A), at)).toBe('current');
    expect(evidenceFreshness(ev('e', 't', 'passed', '2026-01-01T00:00:00Z', SHA_B), at)).toBe('stale');
    expect(evidenceFreshness(ev('e', 't', 'passed', '2026-01-01T00:00:00Z'), at)).toBe('unknown');
    expect(evidenceFreshness(ev('e', 't', 'passed', '2026-01-01T00:00:00Z', SHA_A), none)).toBe('unknown');
  });
});

describe('testAssurance', () => {
  it('picks latest evidence by executedAt within the inspected commit, history newest first', () => {
    const cc = contract({
      tests: [tdef('t')],
      evidence: [
        ev('old', 't', 'failed', '2026-01-01T00:00:00Z', SHA_A),
        ev('new', 't', 'passed', '2026-01-03T00:00:00Z', SHA_A),
        ev('other', 't', 'failed', '2026-01-05T00:00:00Z', SHA_B),
        ev('mid', 't', 'failed', '2026-01-02T00:00:00Z', SHA_A),
      ],
    });
    const a = testAssurance(cc, 't', at);
    expect(a.current!.id).toBe('new');
    expect(a.latestRecorded!.id).toBe('other');
    expect(a.freshness).toBe('stale');
    expect(a.history.map((e) => e.id)).toEqual(['other', 'new', 'mid', 'old']);
    expect(a.defined).toBe(true);
    expect(a.test!.id).toBe('t');
  });
  it('compares timestamps across offsets and tie-breaks by id', () => {
    const cc = contract({
      tests: [tdef('t')],
      evidence: [
        ev('a', 't', 'passed', '2026-01-01T12:00:00+02:00', SHA_A), // 10:00Z
        ev('b', 't', 'failed', '2026-01-01T11:00:00Z', SHA_A), // later
        ev('c', 't', 'passed', '2026-01-01T11:00:00Z', SHA_A), // tie with b, higher id wins
      ],
    });
    expect(testAssurance(cc, 't', at).current!.id).toBe('c');
  });
  it('undefined tests are not defined; no evidence is unknown', () => {
    const a = testAssurance(c, 'nope', at);
    expect(a).toMatchObject({ defined: false, freshness: 'unknown', history: [] });
    expect(a.current).toBeUndefined();
    expect(testAssurance(c, 't.noev', at).latestRecorded).toBeUndefined();
  });
  it('no inspected commit means nothing is current', () => {
    const a = testAssurance(c, 't.pass', none);
    expect(a.current).toBeUndefined();
    expect(a.latestRecorded!.id).toBe('e1');
    expect(a.freshness).toBe('unknown');
  });
});

describe('behaviorAssurance', () => {
  const status = (id: string, ctx = at) => behaviorAssurance(c, id, ctx)!.status;
  it('classifies behaviors', () => {
    expect(status('b.root.pass')).toBe('passing');
    expect(status('b.fail')).toBe('failing');
    expect(status('b.stale')).toBe('no-current-evidence');
    expect(status('b.noev')).toBe('no-current-evidence');
    expect(status('b.skip')).toBe('no-current-evidence');
    expect(status('b.root.none')).toBe('untested');
    expect(status('b.undef')).toBe('untested'); // only undefined test references
    expect(status('b.multi')).toBe('failing'); // failing wins over passing
  });
  it('without an inspected commit everything mapped is no-current-evidence', () => {
    expect(status('b.root.pass', none)).toBe('no-current-evidence');
    expect(status('b.fail', none)).toBe('no-current-evidence');
  });
  it('an undefined reference does not count as a valid mapping but is listed', () => {
    const cc = contract({ entities: [ent('cap.a', { behaviors: [beh('b', ['ghost', 't'])] })], tests: [tdef('t')] });
    const b = behaviorAssurance(cc, 'b', at)!;
    expect(b.status).toBe('no-current-evidence');
    expect(b.tests.map((t) => t.defined)).toEqual([false, true]);
    expect(b.entityId).toBe('cap.a');
  });
  it('returns undefined for unknown behaviors', () => {
    expect(behaviorAssurance(c, 'nope', at)).toBeUndefined();
  });
  it('passing in one test and skipped in another is passing', () => {
    const cc = contract({
      entities: [ent('cap.a', { behaviors: [beh('b', ['t1', 't2'])] })],
      tests: [tdef('t1'), tdef('t2')],
      evidence: [ev('e1', 't1', 'passed', '2026-01-01T00:00:00Z', SHA_A), ev('e2', 't2', 'skipped', '2026-01-01T00:00:00Z', SHA_A)],
    });
    expect(behaviorAssurance(cc, 'b', at)!.status).toBe('passing');
  });
  it('error status counts as failing', () => {
    const cc = contract({
      entities: [ent('cap.a', { behaviors: [beh('b', ['t'])] })],
      tests: [tdef('t')],
      evidence: [ev('e', 't', 'error', '2026-01-01T00:00:00Z', SHA_A)],
    });
    expect(behaviorAssurance(cc, 'b', at)!.status).toBe('failing');
  });
});

describe('entityAssurance', () => {
  it('aggregates the subtree without double counting', () => {
    const s = entityAssurance(c, 'cap.root', at);
    expect(s.total).toBe(8); // 2 + 5 + 1, not the system behavior
    expect(s.withTests).toBe(6); // b.root.none and b.undef are unmapped
    expect(s.passingCurrent).toBe(1);
    expect(s.failingCurrent).toBe(2); // b.fail, b.multi
    expect(s.untested).toBe(2);
    expect(s.noCurrentEvidence).toBe(3); // stale, noev, skip
    expect(s.behaviorIds.all).toHaveLength(8);
    expect(new Set(s.behaviorIds.all).size).toBe(8);
    expect(s.behaviorIds.passingCurrent).toEqual(['b.root.pass']);
    expect(s.behaviorIds.untested).toEqual(['b.root.none', 'b.undef']);
    expect(s.passingCurrent + s.failingCurrent + s.noCurrentEvidence).toBe(s.withTests);
    expect(s.withTests + s.untested).toBe(s.total);
  });
  it('is scoped to the entity subtree and same kind', () => {
    expect(entityAssurance(c, 'cap.child', at).total).toBe(6);
    expect(entityAssurance(c, 'cap.grand', at).total).toBe(1);
    expect(entityAssurance(c, 'sys.s', at).total).toBe(1);
  });
  it('inspectedCommit null: no passing/failing, mapped behaviors are noCurrentEvidence', () => {
    const s = entityAssurance(c, 'cap.root', none);
    expect(s.passingCurrent).toBe(0);
    expect(s.failingCurrent).toBe(0);
    expect(s.noCurrentEvidence).toBe(6);
    expect(s.untested).toBe(2);
  });
  it('unknown entity yields an empty summary', () => {
    expect(entityAssurance(c, 'nope', at).total).toBe(0);
  });
  it('mapped-but-no-evidence is never passing', () => {
    const cc = contract({ entities: [ent('cap.a', { behaviors: [beh('b', ['t'])] })], tests: [tdef('t')] });
    const s = entityAssurance(cc, 'cap.a', at);
    expect(s.passingCurrent).toBe(0);
    expect(s.noCurrentEvidence).toBe(1);
  });
});

describe('computeAssurance', () => {
  it('matches entityAssurance for every entity', () => {
    for (const ctx of [at, none]) {
      const all = computeAssurance(c, ctx);
      expect([...all.keys()].sort()).toEqual(c.entities.map((e) => e.id).sort());
      for (const e of c.entities) expect(all.get(e.id)).toEqual(entityAssurance(c, e.id, ctx));
    }
  });
  it('handles parent cycles and duplicate behavior ids by terminating with exact results', () => {
    const cc = contract({
      entities: [
        ent('cap.x', { parentId: 'cap.y', behaviors: [beh('dup')] }),
        ent('cap.y', { parentId: 'cap.x', behaviors: [beh('dup'), beh('y1')] }),
      ],
    });
    const all = computeAssurance(cc, at);
    expect(all.get('cap.x')!.total).toBe(2);
    expect(all.get('cap.y')!.total).toBe(2);
  });
  it('scales to thousands of entities', () => {
    const entities = [];
    const tests = [tdef('t')];
    for (let i = 0; i < 5000; i++) {
      entities.push(ent(`cap.${i}`, { parentId: i === 0 ? null : `cap.${Math.floor((i - 1) / 3)}`, behaviors: [beh(`b.${i}`, ['t'])] }));
    }
    const big = contract({ entities, tests, evidence: [ev('e', 't', 'passed', '2026-01-01T00:00:00Z', SHA_A)] });
    const start = performance.now();
    const all = computeAssurance(big, at);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(all.get('cap.0')!.total).toBe(5000);
    expect(all.get('cap.0')!.passingCurrent).toBe(5000);
  });
  it('handles a deep chain without stack overflow', () => {
    const entities = [];
    for (let i = 0; i < 3000; i++) entities.push(ent(`cap.${i}`, { parentId: i === 0 ? null : `cap.${i - 1}`, behaviors: [beh(`b.${i}`)] }));
    expect(computeAssurance(contract({ entities }), at).get('cap.0')!.total).toBe(3000);
  });
});
