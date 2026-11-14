import { parseTree, printParseErrorCode } from 'jsonc-parser';
import type { Node as JsonNode, ParseError } from 'jsonc-parser';
import type { ErrorObject } from 'ajv';
import schemaJson from '../schema/orbit.schema.json' with { type: 'json' };
// Precompiled (Ajv standalone) validator — no runtime `new Function`, so it works under a strict CSP.
// Regenerate with `npm run gen -w @orbit/contract` after editing schema/orbit.schema.json.
import validateSchema from './generated/schemaValidator.js';
import type { Diagnostic, OrbitContract, ParseResult } from './types.js';

/** The JSON Schema object (schema/orbit.schema.json). */
export const schema: object = schemaJson;

interface ValidateFunction {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

function getValidator(): ValidateFunction {
  return validateSchema as unknown as ValidateFunction;
}

// ───────────────────────── JSON pointer helpers ─────────────────────────

function toSegments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function toPointer(segments: (string | number)[]): string {
  return segments.map((s) => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

function valueAt(root: unknown, segments: string[]): unknown {
  let cur: unknown = root;
  for (const s of segments) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

// ───────────────────────── Human labels ─────────────────────────

const COLLECTION_LABEL: Record<string, string> = {
  entities: 'Entity',
  relationships: 'Relationship',
  tests: 'Test',
  evidence: 'Evidence',
};

/** Describe the object that owns the value at `segments` (nearest identifiable ancestor), e.g. "Entity 'cap.x'". */
function labelFor(root: unknown, segments: string[]): string {
  const candidates: { len: number; kind: string }[] = [];
  if (segments[0] === 'product') candidates.push({ len: 1, kind: 'Product' });
  if (segments[0] && COLLECTION_LABEL[segments[0]] && segments.length >= 2) {
    candidates.push({ len: 2, kind: COLLECTION_LABEL[segments[0]] });
  }
  if (segments[0] === 'entities' && segments[2] === 'behaviors' && segments.length >= 4) {
    candidates.push({ len: 4, kind: 'Behavior' });
  }
  const best = candidates[candidates.length - 1];
  if (!best) return 'Contract';
  const prefix = segments.slice(0, best.len);
  const obj = valueAt(root, prefix);
  const id = obj && typeof obj === 'object' ? (obj as { id?: unknown }).id : undefined;
  if (typeof id === 'string' && id !== '') return `${best.kind} '${id}'`;
  if (best.kind === 'Product') return 'Product';
  return `${best.kind} at ${toPointer(prefix)}`;
}

function fieldName(segments: string[]): string {
  const last = segments[segments.length - 1] ?? '';
  if (/^\d+$/.test(last) && segments.length > 1) return `${segments[segments.length - 2]}[${last}]`;
  return last;
}

const snippet = (v: unknown): string => {
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
};

// ───────────────────────── Schema errors → diagnostics ─────────────────────────

const ID_FIELDS = new Set(['id', 'testId', 'sourceId', 'targetId', 'parentId']);

interface SchemaIssue {
  diagnostic: Diagnostic;
  /** true when the offending item cannot be safely rendered. */
  hard: boolean;
  segments: string[];
}

function schemaIssues(value: unknown, errors: ErrorObject[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const blankPaths = new Set(errors.filter((e) => e.keyword === 'minLength').map((e) => e.instancePath));
  for (const e of errors) {
    let segments = toSegments(e.instancePath);
    let message: string;
    let keyword = e.keyword;
    const actual = valueAt(value, segments);
    switch (e.keyword) {
      case 'required': {
        const prop = String((e.params as { missingProperty: string }).missingProperty);
        message = `${labelFor(value, segments.length ? segments : [])} is missing required property '${prop}'.`;
        if (segments.length === 0) message = `Contract is missing required top-level property '${prop}'.`;
        break;
      }
      case 'additionalProperties': {
        const prop = String((e.params as { additionalProperty: string }).additionalProperty);
        message = `${labelFor(value, segments)} has unknown property '${prop}'. Remove it; the v1 schema does not allow extra properties.`;
        segments = [...segments, prop];
        break;
      }
      case 'type': {
        const t = (e.params as { type: string | string[] }).type;
        const expected = Array.isArray(t) ? t.join(' or ') : t;
        message = `${labelFor(value, segments.slice(0, -1))}: '${fieldName(segments) || 'contract'}' must be ${expected} but is ${snippet(actual)}.`;
        break;
      }
      case 'enum': {
        const allowed = (e.params as { allowedValues: unknown[] }).allowedValues.map((v) => `'${String(v)}'`).join(', ');
        message = `${labelFor(value, segments.slice(0, -1))}: '${fieldName(segments)}' must be one of ${allowed} but is ${snippet(actual)}.`;
        break;
      }
      case 'const': {
        message = `'${fieldName(segments)}' must be ${snippet((e.params as { allowedValue: unknown }).allowedValue)} but is ${snippet(actual)}.`;
        break;
      }
      case 'format': {
        message = `${labelFor(value, segments.slice(0, -1))}: '${fieldName(segments)}' must be an RFC 3339 date-time such as 2026-11-13T18:00:00Z but is ${snippet(actual)}.`;
        break;
      }
      case 'minLength':
      case 'pattern': {
        const field = fieldName(segments);
        if (field === 'commit') {
          message = `${labelFor(value, segments.slice(0, -1))}: 'commit' must be a full 40-character lowercase hex git SHA but is ${snippet(actual)}. Omit the property when the commit is unknown.`;
        } else {
          if (e.keyword === 'pattern' && blankPaths.has(e.instancePath)) continue; // reported once as minLength
          message = `${labelFor(value, segments.slice(0, -1))}: '${field}' must not be blank.`;
          keyword = 'minLength';
        }
        break;
      }
      default:
        message = `${labelFor(value, segments.slice(0, -1))}: '${fieldName(segments)}' ${e.message ?? 'is invalid'}.`;
    }
    const last = segments[segments.length - 1] ?? '';
    const soft =
      e.keyword === 'additionalProperties' ||
      e.keyword === 'format' ||
      e.keyword === 'const' ||
      ((e.keyword === 'minLength' || e.keyword === 'pattern') && !ID_FIELDS.has(last));
    issues.push({
      diagnostic: { severity: 'error', code: `schema.${keyword}`, message, path: toPointer(segments) },
      hard: !soft,
      segments,
    });
  }
  return issues;
}

// ───────────────────────── Semantic validation ─────────────────────────

interface SemanticResult {
  diagnostics: Diagnostic[];
  /** JSON pointers (into the checked contract) of items that are unsafe to render. */
  drop: Set<string>;
}

function analyzeSemantics(c: OrbitContract): SemanticResult {
  const diagnostics: Diagnostic[] = [];
  const drop = new Set<string>();
  const err = (code: string, message: string, path: string, relatedIds?: string[]) =>
    diagnostics.push({ severity: 'error', code, message, path, ...(relatedIds ? { relatedIds } : {}) });

  // Duplicate ids ----------------------------------------------------------
  const firstEntity = new Map<string, number>();
  c.entities.forEach((e, i) => {
    if (firstEntity.has(e.id)) {
      err('id.duplicate', `Duplicate entity id '${e.id}' (also used at /entities/${firstEntity.get(e.id)}). Entity ids must be unique; rename one.`, `/entities/${i}/id`, [e.id]);
      drop.add(`/entities/${i}`);
    } else firstEntity.set(e.id, i);
  });
  const dupSimple = (label: string, coll: 'relationships' | 'tests' | 'evidence', items: { id: string }[]) => {
    const seen = new Map<string, number>();
    items.forEach((it, i) => {
      if (seen.has(it.id)) {
        err('id.duplicate', `Duplicate ${label} id '${it.id}' (also used at /${coll}/${seen.get(it.id)}). ${label[0]!.toUpperCase()}${label.slice(1)} ids must be unique; rename one.`, `/${coll}/${i}/id`, [it.id]);
        drop.add(`/${coll}/${i}`);
      } else seen.set(it.id, i);
    });
  };
  dupSimple('relationship', 'relationships', c.relationships);
  dupSimple('test', 'tests', c.tests);
  dupSimple('evidence', 'evidence', c.evidence);

  const firstBehavior = new Map<string, { owner: string; path: string }>();
  c.entities.forEach((e, i) => {
    e.behaviors.forEach((b, j) => {
      const path = `/entities/${i}/behaviors/${j}`;
      const prev = firstBehavior.get(b.id);
      if (prev) {
        err('id.duplicate', `Duplicate behavior id '${b.id}' in entity '${e.id}' (already used in entity '${prev.owner}' at ${prev.path}). Behavior ids must be unique across the whole contract; rename one.`, `${path}/id`, [b.id, e.id]);
        drop.add(path);
      } else firstBehavior.set(b.id, { owner: e.id, path });
    });
  });

  // Hierarchy --------------------------------------------------------------
  const byId = new Map<string, { entity: (typeof c.entities)[number]; index: number }>();
  c.entities.forEach((e, index) => {
    if (!byId.has(e.id)) byId.set(e.id, { entity: e, index });
  });
  c.entities.forEach((e, i) => {
    if (e.parentId === null) return;
    const parent = byId.get(e.parentId);
    if (!parent) {
      err('ref.parent.missing', `Entity '${e.id}' has parentId '${e.parentId}' which does not exist. Use an existing entity id or null for a root.`, `/entities/${i}/parentId`, [e.id, e.parentId]);
    } else if (parent.entity.kind !== e.kind) {
      err('ref.parent.kind', `Entity '${e.id}' has parentId '${e.parentId}' which is a ${parent.entity.kind}; ${e.kind === 'capability' ? 'capabilities must have capability parents' : 'systems must have system parents'}.`, `/entities/${i}/parentId`, [e.id, e.parentId]);
    }
  });

  // Parent cycles: walk each chain once, colouring nodes.
  const state = new Map<string, 'visiting' | 'done'>();
  const onCycle = new Map<string, string[]>();
  for (const start of byId.keys()) {
    if (state.has(start)) continue;
    const stack: string[] = [];
    let cur: string | null = start;
    while (cur !== null && byId.has(cur) && !state.has(cur)) {
      state.set(cur, 'visiting');
      stack.push(cur);
      cur = byId.get(cur)!.entity.parentId;
    }
    if (cur !== null && state.get(cur) === 'visiting') {
      const cycle = stack.slice(stack.indexOf(cur));
      for (const id of cycle) onCycle.set(id, cycle);
    }
    for (const id of stack) state.set(id, 'done');
  }
  for (const [id, cycle] of onCycle) {
    const { index } = byId.get(id)!;
    err('hierarchy.cycle', `Entity '${id}' is part of a parent cycle (${[...cycle, cycle[0]!].join(' -> ')}). Set parentId of one of these entities to null or to a non-descendant.`, `/entities/${index}/parentId`, [...cycle]);
  }

  // Relationships ----------------------------------------------------------
  c.relationships.forEach((r, i) => {
    const base = `/relationships/${i}`;
    let bad = false;
    if (!byId.has(r.sourceId)) {
      err('ref.relationship.source', `Relationship '${r.id}' has sourceId '${r.sourceId}' which is not an entity. Use an existing entity id.`, `${base}/sourceId`, [r.id, r.sourceId]);
      bad = true;
    }
    if (!byId.has(r.targetId)) {
      err('ref.relationship.target', `Relationship '${r.id}' has targetId '${r.targetId}' which is not an entity. Use an existing entity id.`, `${base}/targetId`, [r.id, r.targetId]);
      bad = true;
    }
    if (r.sourceId === r.targetId) {
      err('relationship.self', `Relationship '${r.id}' connects entity '${r.sourceId}' to itself. Self-edges are not allowed.`, `${base}/targetId`, [r.id, r.sourceId]);
      bad = true;
    }
    if (bad) drop.add(base);
  });

  // Tests & evidence -------------------------------------------------------
  const testIds = new Set(c.tests.map((t) => t.id));
  c.entities.forEach((e, i) => {
    e.behaviors.forEach((b, j) => {
      const seen = new Set<string>();
      b.testIds.forEach((t, k) => {
        const path = `/entities/${i}/behaviors/${j}/testIds/${k}`;
        if (!testIds.has(t)) {
          err('ref.behavior.test', `Behavior '${b.id}' references test '${t}' which is not defined in tests. Add the test definition or remove the reference.`, path, [b.id, t]);
        }
        if (seen.has(t)) {
          diagnostics.push({ severity: 'warning', code: 'behavior.testIds.duplicate', message: `Behavior '${b.id}' lists test '${t}' more than once. Remove the duplicate.`, path, relatedIds: [b.id, t] });
        }
        seen.add(t);
      });
    });
  });
  c.evidence.forEach((ev, i) => {
    if (!testIds.has(ev.testId)) {
      err('ref.evidence.test', `Evidence '${ev.id}' references test '${ev.testId}' which is not defined in tests. Add the test definition or remove the evidence.`, `/evidence/${i}/testId`, [ev.id, ev.testId]);
    }
  });

  return { diagnostics, drop };
}

/** Cross-reference checks only (assumes the value already satisfies the schema structurally). */
export function validateSemantics(contract: OrbitContract): Diagnostic[] {
  return analyzeSemantics(contract).diagnostics;
}

// ───────────────────────── Pipeline shared by parseContract / validateContract ─────────────────────────

const ARRAYS = ['entities', 'relationships', 'tests', 'evidence'] as const;

interface Analysis {
  diagnostics: Diagnostic[];
  contract?: OrbitContract;
  partial: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Schema + semantic validation with a display contract that keeps original array indices in diagnostics. */
function analyze(value: unknown): Analysis {
  const validate = getValidator();
  const valid = validate(value);
  const issues = valid ? [] : schemaIssues(value, validate.errors ?? []);
  const diagnostics = issues.map((i) => i.diagnostic);

  // Can we build a display contract at all?
  const p = isObj(value) ? value.product : undefined;
  const rootOk =
    isObj(value) &&
    ARRAYS.every((k) => Array.isArray(value[k])) &&
    isObj(p) &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.summary === 'string';
  if (!rootOk) return { diagnostics, partial: false };
  const root = value as Record<string, unknown>;

  // Stage 1: drop items with hard schema errors, remembering original indices.
  const hardKeys = new Set<string>();
  for (const iss of issues) {
    if (!iss.hard) continue;
    const s = iss.segments;
    if (s[0] === 'entities' && s[2] === 'behaviors' && s.length >= 4) hardKeys.add(toPointer(s.slice(0, 4)));
    else if (ARRAYS.includes(s[0] as (typeof ARRAYS)[number]) && s.length >= 2) hardKeys.add(toPointer(s.slice(0, 2)));
  }
  let dropped = hardKeys.size;
  const entityOrig: number[] = [];
  const behaviorOrig: number[][] = [];
  const orig: Record<'relationships' | 'tests' | 'evidence', number[]> = { relationships: [], tests: [], evidence: [] };
  const keep = <T>(coll: string, items: unknown[], origOut: number[]): T[] => {
    const out: T[] = [];
    items.forEach((it, i) => {
      if (hardKeys.has(`/${coll}/${i}`)) return;
      origOut.push(i);
      out.push(it as T);
    });
    return out;
  };
  const entities = keep<OrbitContract['entities'][number]>('entities', root.entities as unknown[], entityOrig).map((e, k) => {
    const oi = entityOrig[k]!;
    const origs: number[] = [];
    const behaviors = (e.behaviors as unknown[]).filter((_, j) => {
      const ok = !hardKeys.has(`/entities/${oi}/behaviors/${j}`);
      if (ok) origs.push(j);
      return ok;
    });
    behaviorOrig.push(origs);
    return { ...e, behaviors } as OrbitContract['entities'][number];
  });
  const stage1: OrbitContract = {
    schemaVersion: root.schemaVersion as 1,
    product: root.product as OrbitContract['product'],
    entities,
    relationships: keep('relationships', root.relationships as unknown[], orig.relationships),
    tests: keep('tests', root.tests as unknown[], orig.tests),
    evidence: keep('evidence', root.evidence as unknown[], orig.evidence),
  };

  // Stage 2: semantic checks, remapped to original indices.
  const remap = (path: string): string => {
    const s = toSegments(path);
    if (s[0] === 'entities' && s[1] !== undefined) {
      const ei = Number(s[1]);
      s[1] = String(entityOrig[ei]);
      if (s[2] === 'behaviors' && s[3] !== undefined) s[3] = String(behaviorOrig[ei]![Number(s[3])]);
    } else if (s[0] === 'relationships' || s[0] === 'tests' || s[0] === 'evidence') {
      if (s[1] !== undefined) s[1] = String(orig[s[0]][Number(s[1])]);
    }
    return toPointer(s);
  };
  const sem = analyzeSemantics(stage1);
  for (const d of sem.diagnostics) diagnostics.push({ ...d, path: remap(d.path) });

  // Stage 3: drop items that are unsafe to render because of semantic errors.
  const gone = (path: string) => sem.drop.has(path);
  dropped += sem.drop.size;
  const contract: OrbitContract = {
    ...stage1,
    entities: stage1.entities
      .map((e, i) => ({ e, i }))
      .filter(({ i }) => !gone(`/entities/${i}`))
      .map(({ e, i }) => ({ ...e, behaviors: e.behaviors.filter((_, j) => !gone(`/entities/${i}/behaviors/${j}`)) })),
    relationships: stage1.relationships.filter((_, i) => !gone(`/relationships/${i}`)),
    tests: stage1.tests.filter((_, i) => !gone(`/tests/${i}`)),
    evidence: stage1.evidence.filter((_, i) => !gone(`/evidence/${i}`)),
  };
  // Behaviors of a dropped duplicate entity vanish with it; count only what was explicitly dropped above.
  return { diagnostics, contract, partial: dropped > 0 };
}

/** Schema + semantic validation of an already-parsed value (no line/column info). */
export function validateContract(value: unknown): Diagnostic[] {
  return analyze(value).diagnostics;
}

// ───────────────────────── Text parsing with locations ─────────────────────────

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function locate(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

/** Resolve a pointer in the parse tree; falls back to the nearest existing ancestor. For a property, prefers its key. */
function nodeOffset(tree: JsonNode, segments: string[], preferKey: boolean): number {
  let node = tree;
  for (const seg of segments) {
    let next: JsonNode | undefined;
    if (node.type === 'object') {
      next = node.children?.find((p) => p.children?.[0]?.value === seg)?.children?.[1];
    } else if (node.type === 'array') {
      next = node.children?.[Number(seg)];
    }
    if (!next) break;
    node = next;
  }
  if (preferKey && node.parent?.type === 'property') return node.parent.offset;
  return node.offset;
}

export function parseContract(text: string): ParseResult {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  const starts = lineStarts(text);

  if (errors.length > 0 || !tree) {
    const diagnostics: Diagnostic[] = errors.map((e) => {
      const { line, column } = locate(starts, e.offset);
      return { severity: 'error', code: 'json.syntax', message: `Invalid JSON: ${humanSyntax(printParseErrorCode(e.error))} at line ${line}, column ${column}.`, path: '', line, column };
    });
    if (diagnostics.length === 0) diagnostics.push({ severity: 'error', code: 'json.syntax', message: 'Invalid JSON: the file is empty.', path: '', line: 1, column: 1 });
    return { ok: false, partial: false, diagnostics };
  }

  const value = nodeToValue(tree);
  const analysis = analyze(value);
  const diagnostics = analysis.diagnostics.map((d) => {
    const segs = toSegments(d.path);
    const off = nodeOffset(tree, segs, d.code === 'schema.additionalProperties');
    return { ...d, ...locate(starts, off) };
  });
  diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
  const ok = !diagnostics.some((d) => d.severity === 'error');
  return { ok, ...(analysis.contract ? { contract: analysis.contract } : {}), partial: analysis.partial, diagnostics };
}

function humanSyntax(code: string): string {
  const map: Record<string, string> = {
    InvalidSymbol: 'invalid symbol',
    InvalidNumberFormat: 'invalid number format',
    PropertyNameExpected: 'property name expected (is there a trailing comma?)',
    ValueExpected: 'value expected (is there a trailing comma?)',
    ColonExpected: "':' expected",
    CommaExpected: "',' expected",
    CloseBraceExpected: "'}' expected",
    CloseBracketExpected: "']' expected",
    EndOfFileExpected: 'unexpected content after the end of the JSON document',
    InvalidCommentToken: 'comments are not allowed in JSON',
    UnexpectedEndOfComment: 'unexpected end of comment',
    UnexpectedEndOfString: 'unterminated string',
    UnexpectedEndOfNumber: 'unexpected end of number',
    InvalidUnicode: 'invalid unicode sequence in string',
    InvalidEscapeCharacter: 'invalid escape character in string',
    InvalidCharacter: 'invalid character in string',
  };
  return map[code] ?? code;
}

function nodeToValue(node: JsonNode): unknown {
  switch (node.type) {
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const prop of node.children ?? []) {
        const [k, v] = prop.children ?? [];
        if (k && v) Object.defineProperty(o, String(k.value), { value: nodeToValue(v), enumerable: true, writable: true, configurable: true });
      }
      return o;
    }
    case 'array':
      return (node.children ?? []).map(nodeToValue);
    default:
      return node.value;
  }
}

// ───────────────────────── Serialization & factories ─────────────────────────

const omitUndefined = (o: Record<string, unknown>): Record<string, unknown> => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

/** Canonical JSON text: 2-space indent, trailing newline, schema key order, array order preserved. */
export function serializeContract(c: OrbitContract): string {
  const canonical = {
    schemaVersion: c.schemaVersion,
    product: omitUndefined({ id: c.product.id, name: c.product.name, summary: c.product.summary, description: c.product.description }),
    entities: c.entities.map((e) => ({
      id: e.id,
      kind: e.kind,
      parentId: e.parentId,
      name: e.name,
      summary: e.summary,
      description: e.description,
      behaviors: e.behaviors.map((b) => ({ id: b.id, name: b.name, expected: b.expected, testIds: [...b.testIds] })),
    })),
    relationships: c.relationships.map((r) => omitUndefined({ id: r.id, type: r.type, sourceId: r.sourceId, targetId: r.targetId, description: r.description })),
    tests: c.tests.map((t) => ({ id: t.id, name: t.name, location: t.location })),
    evidence: c.evidence.map((ev) => omitUndefined({ id: ev.id, testId: ev.testId, status: ev.status, executedAt: ev.executedAt, commit: ev.commit, details: ev.details })),
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}

export function createEmptyContract(product: { id: string; name: string; summary: string; description?: string }): OrbitContract {
  return {
    schemaVersion: 1,
    product: { ...product },
    entities: [],
    relationships: [],
    tests: [],
    evidence: [],
  };
}
