import { describe, expect, it } from 'vitest';
import { matchResults, parseJUnit, splitLocation } from '../../src/lib/junit';

const AT = '2026-11-14T10:00:00.000Z';

// Shapes written by Playwright (classname = file, name = describe › test) and Vitest (name uses " > ").
const PLAYWRIGHT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="" name="" tests="4" failures="1" skipped="1">
  <testsuite name="today.spec.ts" timestamp="2026-11-14T09:59:00.000Z" tests="3" failures="1">
    <testcase name="Today › overdue stays until resolved" classname="tests/e2e/today.spec.ts" time="1.2"></testcase>
    <testcase name="Today › labels overdue &amp; due today" classname="tests/e2e/today.spec.ts" time="0.4">
      <failure message="expected &quot;Overdue&quot;" type="FAILURE"><![CDATA[Error: expected <b>"Overdue"</b>]]></failure>
    </testcase>
    <testcase name="Today › rolls over at midnight" classname="tests/e2e/today.spec.ts" time="0"><skipped/></testcase>
  </testsuite>
  <testsuite name="lists.spec.ts" tests="1">
    <testcase name="creates a list" classname="tests/e2e/lists.spec.ts" time="0.3"/>
  </testsuite>
</testsuites>`;

const VITEST = `<testsuites name="vitest tests">
  <testsuite name="src/date.test.ts" tests="1">
    <testcase classname="src/date.test.ts" name="localDate &gt; rolls over at midnight" time="0.01"/>
  </testsuite>
</testsuites>`;

const t = (id: string, location: string, extra: object = {}) => ({ id, name: id, location, ...extra });

describe('parseJUnit', () => {
  it('reads cases with status, file and failure message', () => {
    const r = parseJUnit(PLAYWRIGHT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cases.map((c) => c.status)).toEqual(['passed', 'failed', 'skipped', 'passed']);
    expect(r.cases[1]).toMatchObject({ file: 'tests/e2e/today.spec.ts', name: 'Today › labels overdue & due today', message: 'expected "Overdue"' });
  });
  it('rejects files that are not JUnit', () => {
    expect(parseJUnit('{"suites": []}').ok).toBe(false);
  });
  it('takes the file from the suite when cases have none, and handles error elements', () => {
    const r = parseJUnit('<testsuite name="x" file="a/b.test.ts"><testcase name="t1"><error message="boom"/></testcase></testsuite>');
    expect(r.ok && r.cases[0]).toMatchObject({ file: 'a/b.test.ts', status: 'failed', message: 'boom' });
  });
});

describe('splitLocation', () => {
  it('splits file and title on › # ::, ignoring line numbers', () => {
    expect(splitLocation('tests/e2e/today.spec.ts › Today › overdue stays')).toEqual({ file: 'tests/e2e/today.spec.ts', title: 'today › overdue stays' });
    expect(splitLocation('a.test.ts:42 › works')).toEqual({ file: 'a.test.ts', title: 'works' });
    expect(splitLocation('tests/x.py::test_thing')).toEqual({ file: 'tests/x.py', title: 'test_thing' });
    expect(splitLocation('Today › overdue stays')).toEqual({ file: '', title: 'today › overdue stays' });
  });
});

describe('matchResults', () => {
  const pw = (parseJUnit(PLAYWRIGHT) as Extract<ReturnType<typeof parseJUnit>, { ok: true }>).cases;
  it('matches by file and title, including a title without its describe block', () => {
    const r = matchResults(
      [
        t('full', 'tests/e2e/today.spec.ts › Today › overdue stays until resolved'),
        t('short', 'tests/e2e/today.spec.ts › labels overdue & due today'),
        t('skip', 'today.spec.ts › Today › rolls over at midnight'),
        t('other-file', 'tests/e2e/lists.spec.ts › overdue stays until resolved'),
        t('nofile', 'creates a list'),
      ],
      pw,
      AT,
    );
    expect(r.results.get('full')).toEqual({ status: 'passed', at: AT });
    expect(r.results.get('short')).toMatchObject({ status: 'failed', message: 'expected "Overdue"' });
    expect(r.results.get('skip')?.status).toBe('skipped');
    expect(r.results.has('other-file')).toBe(false); // same title in another file does not match
    expect(r.results.get('nofile')?.status).toBe('passed');
    expect(r.unmatchedCases).toBe(0);
  });
  it('normalizes " > " separators (Vitest) and skips placeholders', () => {
    const v = (parseJUnit(VITEST) as Extract<ReturnType<typeof parseJUnit>, { ok: true }>).cases;
    const r = matchResults([t('ok', 'src/date.test.ts › localDate › rolls over at midnight'), t('p', 'src/date.test.ts › localDate › rolls over at midnight', { placeholder: true })], v, AT);
    expect(r.results.get('ok')?.status).toBe('passed');
    expect(r.results.has('p')).toBe(false);
  });
  it('combines repeated cases (e.g. one per browser): any failure fails', () => {
    const cases = [
      { file: 'a.spec.ts', name: 'works', status: 'passed' as const },
      { file: 'a.spec.ts', name: 'works', status: 'failed' as const },
    ];
    expect(matchResults([t('x', 'a.spec.ts › works')], cases, AT).results.get('x')?.status).toBe('failed');
  });
  it('a [test.id] tag in the name is an exact match, and tags never break title matching', () => {
    const cases = [
      { file: 'tests/unit/a.test.ts', name: 'suite > renamed title [test.a]', status: 'passed' as const },
      { file: 'tests/unit/a.test.ts', name: 'suite > plain title [test.other]', status: 'failed' as const },
    ];
    const r = matchResults([t('test.a', 'apps/x/tests/unit/a.test.ts › suite › something else'), t('test.b', 'apps/x/tests/unit/a.test.ts › suite › plain title')], cases, AT);
    expect(r.results.get('test.a')?.status).toBe('passed');
    expect(r.results.has('test.b')).toBe(false); // tagged for another test
    expect(r.unmatchedCases).toBe(1);
  });
  it('counts cases that match no contract test', () => {
    expect(matchResults([t('x', 'tests/e2e/lists.spec.ts › creates a list')], pw, AT).unmatchedCases).toBe(3);
  });
});
