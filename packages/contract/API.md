# @orbit/contract — public API (v1)

Shared by `apps/orbit` (UI), `scripts/*` (validation CLI, demo), and tests.
Types live in `src/types.ts`. Everything below is exported from `src/index.ts`. Pure TypeScript, no
Node-only APIs in `src/` (must run in a browser/Tauri webview). Node CLIs live in `/scripts`.

The package is consumed as TypeScript source (`main: src/index.ts`) by Vite/Vitest. `npm run build -w @orbit/contract`
also emits `dist/` (ESM JS + .d.ts) so plain Node scripts can `import` from `@orbit/contract/dist`.

## Parsing & validation — `src/validate.ts`

```ts
parseContract(text: string): ParseResult
```
1. JSON parse via `jsonc-parser` (`parseTree` with `disallowComments: true`, `allowTrailingComma: false`).
   Syntax errors → `code: 'json.syntax'` diagnostics with line/column; `contract` undefined.
2. Schema validation with Ajv 2020 + ajv-formats against `schema/orbit.schema.json`
   (`allErrors: true`). Map each Ajv error to a Diagnostic (`schema.*` codes) with JSON-pointer `path`
   and line/column resolved from the jsonc parse tree.
3. Semantic validation (`validateSemantics`) — see below.
4. `contract`: if the root is an object with the six arrays, return a *display* contract. When there are errors,
   drop only the individual items that are unsafe to render (e.g. entity missing id, relationship pointing at
   unknown entity) and set `partial: true`. Never mutate/repair anything else.

```ts
validateContract(value: unknown): Diagnostic[]          // schema + semantic, no line info
validateSemantics(contract: OrbitContract): Diagnostic[] // cross-reference checks only
```
Semantic rules (codes):
- `id.duplicate` — duplicate entity / relationship / test id within its namespace; duplicate behavior id **globally**.
- `ref.parent.missing`, `ref.parent.kind` (parent must have same kind), `hierarchy.cycle` (parent chain cycle; report every entity on the cycle).
- `ref.relationship.source`, `ref.relationship.target` (unknown entity), `relationship.self` (source === target).
- `ref.behavior.test` — behavior testId not in `tests` (**severity: error** — references must resolve).
- `behavior.testIds.duplicate` (warning).
- Timestamps: RFC3339 `executedAt` (`schema.format`), `commit` must match `^[0-9a-f]{40}$`.
Messages must be actionable: name the id, the field, and what to do ("Entity 'cap.x' has parentId 'sys.y' which is a system; capabilities must have capability parents.").

```ts
serializeContract(contract: OrbitContract): string
```
Canonical output: 2-space indent, trailing newline, keys in schema order
(`schemaVersion, product, entities, relationships, tests, validation?`; entity: `id, kind, parentId, name, summary, description, behaviors`;
behavior: `id, name, expected, testIds`; relationship: `id, type, sourceId, targetId, description?`; test: `id, name, location, placeholder?` (`placeholder: true` = planned, not implemented; never counts as coverage);
validation: `command, results`; product: `id, name, summary, description?`).
Array order is preserved as given (never re-sorted — avoids churn).

```ts
createEmptyContract(product: { id: string; name: string; summary: string; description?: string }): OrbitContract
schema: object   // the JSON Schema object (import of schema/orbit.schema.json)
```

## Hierarchy & graph — `src/graph.ts`

```ts
entityById(contract): Map<string, Entity>
behaviorIndex(contract): Map<string, { behavior: Behavior; entity: Entity }>
childrenOf(contract, parentId: string | null, kind?: EntityKind): Entity[]   // sorted by name (display only)
ancestorsOf(contract, id): Entity[]          // nearest first; cycle-safe
descendantIdsOf(contract, id): string[]      // same-kind subtree, excluding id; cycle-safe
wouldCreateCycle(contract, entityId, newParentId: string | null): boolean
focusedRelations(contract, entityId): { incoming: Relationship[]; outgoing: Relationship[] }
potentialImpact(relationships: Relationship[], changedEntityIds: Iterable<string>): ImpactPath[]
```
`potentialImpact`: reverse BFS. From each changed id X, every relationship (any of the 3 types) with
`targetId === X` makes `sourceId` potentially affected; continue transitively. Terminates on cycles; each entity
appears once (shortest path); directly changed ids are excluded from the result; self-edges ignored.
Result sorted by path length then entityId.

## Assurance — `src/assurance.ts`

```ts
resultStatus(result: TestResult | undefined, since: string | null): TestStatus
testAssurance(contract, testId, ctx): TestAssurance
behaviorAssurance(contract, behaviorId, ctx): BehaviorAssurance | undefined
entityAssurance(contract, entityId, ctx): AssuranceSummary          // entity + same-kind descendants, each behavior once
computeAssurance(contract, ctx): Map<string, AssuranceSummary>      // every entity, efficient (memoized subtree)
```
Test results are not part of the contract: the app reads them from the JUnit file named by `validation.results` and
passes them in as `ctx = { results: Map<testId, TestResult>, since }`, where `since` is the proposal's commit time
(null when there is no proposal).
- Test status: `undefined` (unknown id), `planned` (placeholder), `passing` / `failing` (a passed / failed result at or
  after `since`), else `unconfirmed` (no result, a result from before the proposal, or skipped).
- Behavior status, by precedence, over real tests only (defined, not placeholders): `failing` if any fails; `passing`
  if all pass; `unconfirmed` otherwise. With no real tests: `planned` if placeholders are mapped, else `untested`.
- Summary counts `passing + failing + unconfirmed = withTests` and `withTests + planned + untested = total`. `withPlanned` counts behaviors with any planned test, whatever their status, so it overlaps the other counts.

## Semantic diff — `src/diff.ts`

```ts
diffContracts(base: OrbitContract | null, target: OrbitContract | null): SemanticDiff
```
- Compare by id; ignore array order, key order, formatting, `testIds` order (set compare).
- Entities: fields `name, summary, description, kind, parentId`. Behaviors (indexed globally by id): fields
  `name, expected, testIds`, plus `owner` when the owning entity changed (report `ownerBefore/ownerAfter`; not add+remove).
- Relationships: `type, sourceId, targetId, description`. Tests: `name, location, placeholder`. Product: `id, name, summary, description` (one change with id = product id, kind 'modified').
- `group`: entity/behavior(name/expected/owner)/relationship/product → 'guarantee'; test and behavior changes
  where only `testIds` changed → 'verification'.
- `entityIds` / direct changes: entity changes → that entity; behavior add/remove/modify → owning entity (both owners on
  ownership change) **only when group is 'guarantee'**; relationship add/remove/modify → its sourceId (base and target
  source). Test/testIds-only changes never mark an entity as directly changed.
- `potentiallyAffected = potentialImpact(union of base and target relationships (dedupe by id; keep both versions if
  endpoints changed), directlyChangedEntityIds)`.
- `entityStates` for every entity in base ∪ target: added/removed(ghost: true)/modified/affected/unchanged with reasons and
  `changedDescendants` (count of same-kind descendants in the target tree — or base tree for ghosts — not 'unchanged').
- base null → everything 'added', `contractStatus: 'added'`; target null → 'removed'.

## Edit helpers — `src/edit.ts` (immutable; return a new contract)

```ts
generateId(prefix: string, existing: Iterable<string>, name?: string): string  // e.g. ('cap', ids, 'Custom Lists') → 'cap.custom-lists' (+ '-2' if taken)
allIds(contract): { entities: Set<string>; behaviors: Set<string>; relationships: Set<string>; tests: Set<string> }
referencesTo(contract, kind: 'entity' | 'behavior' | 'test', id: string): string[]   // human descriptions of what references it (for delete confirmations)
removeEntity(contract, id, opts: { children: 'reparent-to-grandparent' | 'block' }): OrbitContract  // also removes its relationships; throws if children and 'block'
removeTest(contract, id, opts: { unmap: boolean }): OrbitContract
```
(The UI may do other edits with plain immutable updates.)
