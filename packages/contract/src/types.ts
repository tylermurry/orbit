// Orbit product contract v1 — canonical TypeScript types.
// This file is the shared interface between packages/contract, apps/orbit, and scripts.
// Do not change exported names/shapes without updating packages/contract/API.md.

export type EntityKind = 'capability' | 'system';
export type RelationshipType = 'dependsOn' | 'uses' | 'implementedBy';
export type EvidenceStatus = 'passed' | 'failed' | 'skipped' | 'error';

export const ENTITY_KINDS: readonly EntityKind[] = ['capability', 'system'];
export const RELATIONSHIP_TYPES: readonly RelationshipType[] = ['dependsOn', 'uses', 'implementedBy'];
export const EVIDENCE_STATUSES: readonly EvidenceStatus[] = ['passed', 'failed', 'skipped', 'error'];

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
}

export interface Evidence {
  id: string;
  testId: string;
  status: EvidenceStatus;
  /** RFC3339 timestamp */
  executedAt: string;
  /** Full 40-hex git SHA; omitted when unknown. */
  commit?: string;
  details?: string;
}

export interface OrbitContract {
  schemaVersion: 1;
  product: Product;
  entities: Entity[];
  relationships: Relationship[];
  tests: TestDefinition[];
  evidence: Evidence[];
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
  /** Ids involved (entity/behavior/relationship/test/evidence). */
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

/** current: evidence.commit === inspected commit; stale: commit recorded but different; unknown: no commit on evidence or no inspected commit. */
export type Freshness = 'current' | 'stale' | 'unknown';

export interface AssuranceContext {
  /** The 40-hex commit of the code revision being inspected, or null when unknown (standalone JSON / no explicit code revision). */
  inspectedCommit: string | null;
}

/** Primary, conservative status for one behavior (ordered by precedence). */
export type BehaviorStatus =
  | 'failing' // some mapped test's latest evidence for the inspected commit is failed/error
  | 'passing' // >=1 mapped test's latest evidence for the inspected commit is passed (and none failing)
  | 'no-current-evidence' // has valid test mappings but no evidence matching the inspected commit (stale/unknown/none)
  | 'untested'; // no valid test mappings

export interface TestAssurance {
  testId: string;
  /** false when the behavior references a testId not present in contract.tests (that mapping is not "valid"). */
  defined: boolean;
  test?: TestDefinition;
  /** Latest evidence (by executedAt) whose commit === inspected commit; undefined if none. */
  current?: Evidence;
  /** Latest evidence recorded for this test regardless of commit (for display/provenance). */
  latestRecorded?: Evidence;
  /** Freshness of latestRecorded. 'unknown' when there is no evidence at all. */
  freshness: Freshness;
  /** All evidence for this test, newest first. */
  history: Evidence[];
}

export interface BehaviorAssurance {
  behaviorId: string;
  entityId: string;
  status: BehaviorStatus;
  tests: TestAssurance[];
}

export interface AssuranceSummary {
  /** 1. total distinct behaviors in entity + same-kind descendants */
  total: number;
  /** 2. behaviors with >=1 valid (defined) test reference */
  withTests: number;
  /** 3. behaviors with >=1 test whose latest current-commit evidence is passed */
  passingCurrent: number;
  /** 4. behaviors with >=1 test whose latest current-commit evidence is failed or error */
  failingCurrent: number;
  /** 5. behaviors with no valid mapped tests */
  untested: number;
  /** 6. behaviors with valid mappings but no current-commit evidence for any test (stale/unknown/none) */
  noCurrentEvidence: number;
  /** behavior ids per bucket, for drill-down */
  behaviorIds: {
    all: string[];
    withTests: string[];
    passingCurrent: string[];
    failingCurrent: string[];
    untested: string[];
    noCurrentEvidence: string[];
  };
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
export type ChangeCategory = 'product' | 'entity' | 'behavior' | 'relationship' | 'test' | 'evidence';
/** 'guarantee' = product meaning changed; 'verification' = test/evidence/test-mapping metadata only. */
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
