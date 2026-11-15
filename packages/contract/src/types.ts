// Orbit product contract v1 — canonical TypeScript types.
// This file is the shared interface between packages/contract, apps/orbit, and scripts.
// Do not change exported names/shapes without updating packages/contract/API.md.

export type EntityKind = 'capability' | 'system';
export type RelationshipType = 'dependsOn' | 'uses' | 'implementedBy';

export const ENTITY_KINDS: readonly EntityKind[] = ['capability', 'system'];
export const RELATIONSHIP_TYPES: readonly RelationshipType[] = ['dependsOn', 'uses', 'implementedBy'];

export interface Product {
  id: string;
  name: string;
  summary: string;
  description?: string;
}

export interface Behavior {
  id: string;
  name: string;
  expected: string;
  testIds: string[];
}

export interface Entity {
  id: string;
  kind: EntityKind;
  parentId: string | null;
  name: string;
  summary: string;
  description: string;
  behaviors: Behavior[];
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  description?: string;
}

export interface TestDefinition {
  id: string;
  name: string;
  location: string;
  /** Planned but not implemented yet; never counts as coverage. Omitted (never false) for real tests. */
  placeholder?: true;
}

/** How the product is validated: one command that runs the whole suite and the JUnit XML file it writes. */
export interface ValidationConfig {
  command: string;
  /** Results file path, relative to the repository root (or the contract's folder outside Git). */
  results: string;
}

export interface OrbitContract {
  schemaVersion: 1;
  product: Product;
  entities: Entity[];
  relationships: Relationship[];
  tests: TestDefinition[];
  validation?: ValidationConfig;
}

// ───────────────────────── Validation ─────────────────────────

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine code, e.g. 'json.syntax', 'schema.required', 'ref.parent.missing', 'id.duplicate', 'hierarchy.cycle'. */
  code: string;
  /** Human, actionable message naming the offending id/field. */
  message: string;
  /** JSON Pointer to the offending value, e.g. "/entities/3/parentId" ("" for root). */
  path: string;
  /** 1-based line/column in the source text when known. */
  line?: number;
  column?: number;
  /** Ids involved (entity/behavior/relationship/test). */
  relatedIds?: string[];
}

export interface ParseResult {
  /** true only when there are zero error-severity diagnostics. */
  ok: boolean;
  /** Parsed contract. Present when JSON parsed and the value is safely usable for read-only display
   *  (may be a sanitized/partial view when ok === false — never persist it without explicit user action). */
  contract?: OrbitContract;
  /** true when `contract` is a partial reconstruction (some invalid items dropped for display). */
  partial: boolean;
  diagnostics: Diagnostic[];
}

// ───────────────────────── Assurance ─────────────────────────

/** One test's latest outcome, read from the results file. Results are never stored in the contract. */
export interface TestResult {
  status: 'passed' | 'failed' | 'skipped';
  /** RFC3339 time of the run that produced it. */
  at: string;
  /** Failure message, when the runner reported one. */
  message?: string;
}

export interface AssuranceContext {
  /** Legacy placeholders are ignored when inspecting the actual product. */
  actual?: boolean;
  /** Latest result per test id. */
  results: ReadonlyMap<string, TestResult>;
  /** Results older than this RFC3339 time (the proposal's commit time) are unconfirmed; null = any result counts. */
  since: string | null;
}

/**
 * passing / failing: a result newer than `since`. unconfirmed: no such result (never run, run before the proposal, or
 * skipped). planned: a placeholder test. undefined: the behavior references a test id that does not exist.
 */
export type TestStatus = 'passing' | 'failing' | 'unconfirmed' | 'planned' | 'undefined';

/** One behavior, by precedence. Only real (defined, non-placeholder) tests count. */
export type BehaviorStatus =
  | 'failing' // some real test is failing
  | 'passing' // every real test is passing
  | 'unconfirmed' // has real tests, none failing, at least one not confirmed since the proposal
  | 'planned' // no real tests, but placeholder tests are planned
  | 'untested'; // no tests at all

export interface TestAssurance {
  testId: string;
  /** false when the behavior references a testId not present in contract.tests. */
  defined: boolean;
  test?: TestDefinition;
  status: TestStatus;
  /** The latest result for this test, even when it is too old to count. */
  result?: TestResult;
}

export interface BehaviorAssurance {
  behaviorId: string;
  entityId: string;
  status: BehaviorStatus;
  tests: TestAssurance[];
}

export type AssuranceBucket = 'all' | 'withTests' | BehaviorStatus;

export interface AssuranceSummary {
  /** distinct behaviors in entity + same-kind descendants */
  total: number;
  /** behaviors with >=1 real test */
  withTests: number;
  passing: number;
  failing: number;
  unconfirmed: number;
  planned: number;
  /** behaviors with >=1 planned (placeholder) test, whatever their status; overlaps the other counts */
  withPlanned: number;
  /** ids of the behaviors counted in withPlanned */
  withPlannedIds: string[];
  untested: number;
  /** behavior ids per bucket, for drill-down */
  behaviorIds: Record<AssuranceBucket, string[]>;
}

// ───────────────────────── Graph / impact ─────────────────────────

export interface ImpactStep {
  relationshipId: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
}

export interface ImpactPath {
  /** The potentially affected entity (never a directly changed entity). */
  entityId: string;
  /** Path of edges from entityId (first step's sourceId) down to a directly changed entity (last step's targetId). Shortest by hops. */
  path: ImpactStep[];
  /** The directly changed entity the path ends at. */
  changedEntityId: string;
}

// ───────────────────────── Semantic diff ─────────────────────────

export type ChangeKind = 'added' | 'removed' | 'modified';
export type ChangeCategory = 'product' | 'entity' | 'behavior' | 'relationship' | 'test';
/** 'guarantee' = product meaning changed; 'verification' = test definitions / test mappings only. */
export type ChangeGroup = 'guarantee' | 'verification';

export interface FieldChange {
  /** field name, e.g. 'name', 'parentId', 'testIds', 'owner' */
  field: string;
  before: unknown;
  after: unknown;
  /** for set-valued fields (testIds) */
  addedItems?: string[];
  removedItems?: string[];
}

export interface Change {
  /** stable key: `${category}:${id}` */
  key: string;
  category: ChangeCategory;
  kind: ChangeKind;
  id: string;
  /** Display label (name from target, else base). */
  label: string;
  group: ChangeGroup;
  /** Empty for added/removed. */
  fields: FieldChange[];
  before?: unknown;
  after?: unknown;
  /** Behaviors only: owning entity id in base / target. */
  ownerBefore?: string;
  ownerAfter?: string;
  /** Entity ids this change directly touches (for highlighting). */
  entityIds: string[];
}

export type EntityChangeStatus = 'added' | 'removed' | 'modified' | 'affected' | 'unchanged';

export interface EntityDiffState {
  entityId: string;
  status: EntityChangeStatus;
  /** Human reasons, e.g. 'name changed', 'behavior added: Overdue items remain visible', 'relationship added: uses Local Date Evaluation'. */
  reasons: string[];
  /** For status === 'affected': provenance path. */
  impact?: ImpactPath;
  /** Number of descendants (same kind) whose status !== 'unchanged'. */
  changedDescendants: number;
  /** true when this entity exists only in base (render as read-only ghost from base data). */
  ghost: boolean;
}

export interface ChangeTotals {
  added: number;
  removed: number;
  modified: number;
}

export interface SemanticDiff {
  /** null when the contract file is absent at that revision. */
  base: OrbitContract | null;
  target: OrbitContract | null;
  /** 'added' / 'removed' when the whole contract file is missing at one side. */
  contractStatus: 'added' | 'removed' | 'present';
  changes: Change[];
  totals: Record<ChangeCategory, ChangeTotals>;
  /** Entities directly changed (added/removed/modified incl. own behaviors & outgoing relationship changes). */
  directlyChangedEntityIds: string[];
  /** Potentially affected (reverse-reachable over union of base+target relationships), excluding direct changes. */
  potentiallyAffected: ImpactPath[];
  /** State for every entity in base ∪ target. */
  entityStates: Record<string, EntityDiffState>;
}
