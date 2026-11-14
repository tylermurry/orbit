// Reads a JUnit XML results file (what Playwright, Vitest, Jest, pytest, Go and most CI tools can write) and matches
// its test cases to the contract's tests: by a "[<test id>]" tag in the test name when present, else by `location`
// (file and title).
import type { TestDefinition, TestResult } from '@orbit/contract';

export interface JUnitCase {
  /** Source file (the `file` attribute, else `classname`), forward slashes. */
  file: string;
  /** Test title as the runner reports it, e.g. "Today › overdue stays". */
  name: string;
  status: TestResult['status'];
  message?: string;
}

export type JUnitParse = { ok: true; cases: JUnitCase[] } | { ok: false; message: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? _;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]!] = decode(m[3] ?? m[4] ?? '');
  return out;
}

/** A small, dependency-free JUnit reader: testsuite/testcase elements and failure/error/skipped children. */
export function parseJUnit(xml: string): JUnitParse {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (!/<testsuites?\b/.test(text) && !/<testcase\b/.test(text)) {
    return { ok: false, message: 'This is not a JUnit XML results file (no <testsuite> or <testcase> elements). Configure the test runner to write JUnit XML.' };
  }
  const cases: JUnitCase[] = [];
  const suiteFile: string[] = [];
  const re = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, close, tag, rest, selfClose] = m as unknown as [string, string, string, string, string];
    if (tag === 'testsuite') {
      if (close) suiteFile.pop();
      else if (!selfClose) suiteFile.push(attrs(rest).file ?? suiteFile[suiteFile.length - 1] ?? '');
      continue;
    }
    if (close) continue;
    const a = attrs(rest);
    let body = '';
    if (!selfClose) {
      const end = text.indexOf('</testcase>', re.lastIndex);
      body = end === -1 ? '' : text.slice(re.lastIndex, end);
      if (end !== -1) re.lastIndex = end + '</testcase>'.length;
    }
    const fail = /<(failure|error)\b([^>]*)/.exec(body);
    const status: TestResult['status'] = fail ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
    const message = fail ? attrs(fail[2] ?? '').message : undefined;
    cases.push({ file: (a.file ?? a.classname ?? suiteFile[suiteFile.length - 1] ?? '').replace(/\\/g, '/'), name: a.name ?? '', status, ...(message ? { message } : {}) });
  }
  return { ok: true, cases };
}

/** Normalized title: one separator style, "[tag]"s removed, collapsed whitespace, lower case. */
const norm = (s: string) => s.replace(/\s*\[[^\]\s]+\]/g, '').replace(/\s+(›|>|»)\s+/g, ' › ').replace(/\s+/g, ' ').trim().toLowerCase();
/** "[test.id]" tags in a runner's test name: an exact link to a contract test. */
const tagsOf = (name: string) => [...name.matchAll(/\[([^\]\s]+)\]/g)].map((m) => m[1]!);
const normFile = (s: string) => s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/:\d+(:\d+)?$/, '').trim().toLowerCase();

/** Split a test location like "tests/e2e/today.spec.ts › Today › overdue stays" into file and title. */
export function splitLocation(location: string): { file: string; title: string } {
  const parts = location.split(/\s+›\s+|#|::/);
  const head = parts[0]!.trim();
  const looksLikeFile = /[/\\]|\.\w{1,6}(:\d+)*$/.test(head);
  if (!looksLikeFile) return { file: '', title: norm(location) };
  return { file: normFile(head), title: norm(parts.slice(1).join(' › ')) };
}

const sameFile = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));
const sameTitle = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(` › ${b}`) || b.endsWith(` › ${a}`));

function caseMatches(t: TestDefinition, c: JUnitCase): boolean {
  const tags = tagsOf(c.name);
  if (tags.length) return tags.includes(t.id);
  const loc = splitLocation(t.location);
  const name = norm(c.name);
  if (loc.file) {
    const file = normFile(c.file);
    // The runner may report the file inside the name (e.g. "today.spec.ts › Today › overdue stays").
    if (sameFile(loc.file, file)) return loc.title === '' ? false : sameTitle(loc.title, name);
    return !file && sameTitle(loc.title, name);
  }
  return sameTitle(loc.title, name) || norm(t.name) === name;
}

/** Combine cases for one test (e.g. one per browser): failed beats passed beats skipped. */
function combine(cs: JUnitCase[], at: string): TestResult {
  const failed = cs.find((c) => c.status === 'failed');
  if (failed) return { status: 'failed', at, ...(failed.message ? { message: failed.message } : {}) };
  return { status: cs.some((c) => c.status === 'passed') ? 'passed' : 'skipped', at };
}

export interface MatchedResults {
  /** By contract test id; placeholders are never matched. */
  results: Map<string, TestResult>;
  /** Test cases in the file that match no contract test. */
  unmatchedCases: number;
}

/** Match results to contract tests. `at` is when the run happened (the results file's modification time). */
export function matchResults(tests: TestDefinition[], cases: JUnitCase[], at: string): MatchedResults {
  const results = new Map<string, TestResult>();
  const used = new Set<JUnitCase>();
  for (const t of tests) {
    if (t.placeholder) continue;
    const hits = cases.filter((c) => caseMatches(t, c));
    hits.forEach((c) => used.add(c));
    if (hits.length) results.set(t.id, combine(hits, at));
  }
  return { results, unmatchedCases: cases.filter((c) => !used.has(c)).length };
}
