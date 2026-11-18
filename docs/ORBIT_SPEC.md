# Orbit — Product Specification and Agent Implementation Handoff

**Status:** Implementation-ready proposal · **Version:** 1.0 · **Target:** standalone local-first application + `Tasky` reference application in one monorepo

> This document is self-contained. Do not require access to any previous conversation, Quest Forge repository, GitHub issues, or design notes. When an implementation choice is not specified, prefer the simplest portable approach satisfying the acceptance criteria. Do not add services, orchestration, AI, or hosted dependencies.

## 1. Executive summary

**Orbit** is a local-first product modeling, visualization, and comparison application. A product owner opens a single JSON **product contract** describing what a software product does, the behaviors it guarantees, its internal supporting systems, typed dependencies, and the automated-test evidence associated with those behaviors. Orbit provides three coherent perspectives: **Product**, **Engineering**, and **Impact**. It edits the JSON file directly and, when the file is in a local Git repository, semantically compares it across Git commits, branches, and working-tree changes.

**Tasky** is a deliberately small personal task manager included in the Orbit monorepo. It exercises realistic product capabilities and internal systems while serving as the canonical example contract and integration-test target. Its appearance is loosely inspired by `tasky-visual-reference.png`: restrained light UI, left-hand navigation, spacious task lists, subtle borders, and a restrained accent. Do **not** reproduce the screenshot's calendar, shopping modules, ornate backdrop, or external-service integrations.

### Primary users and outcomes

- **Product owner:** navigates a comprehensible capability tree, sees expected behavior and supporting evidence, and understands what's changed without reading application source.
- **Engineering lead:** examines internal systems, typed relationships, potential duplication, and direct or downstream impact.
- **AI coding agent or human developer:** modifies the same documented JSON contract through ordinary files; no Orbit-specific automation or API is required.

### Non-goals (hard boundaries)

No AI integration or code discovery; no source-code analysis; no test execution; no Git writes (commits, branch creation, merging, staging); no GitHub integration; no PR approval workflow; no built-in issue tracker; no auto-repair of invalid models; no cloud accounts, remote syncing, collaboration, plugins, or external database. Orbit is **not** a task manager; Tasky is solely a reference application.

## 2. Required deliverables and repository layout

Deliver a runnable monorepo containing:

```text
/
  README.md                        # setup, product overview, dev/test/demo instructions
  package.json                     # root workspace scripts
  apps/
    orbit/                         # Orbit desktop/local application
    tasky/                         # small task manager reference application
  packages/
    contract/                      # reusable types, JSON Schema, validation, semantic diff, graph analysis
  examples/
    tasky.orbit.json               # full working Tasky product contract
    invalid.orbit.json             # invalid fixture for diagnostics tests
  docs/
    ORBIT_SPEC.md                  # this document
    tasky-visual-reference.png     # provided inspiration image
  tests/                            # cross-app and fixture-based end-to-end tests as useful
```

A JavaScript/TypeScript workspace is recommended for reusing contract logic. **Implementation recommendation, not a user-approved requirement:** Electron or Tauri (with a local UI) is suitable because Orbit must open and write arbitrary local files and inspect local Git. Prefer whichever yields the smallest maintainable, cross-platform desktop implementation. A browser-only app that cannot open a local repository reliably without a companion process is insufficient. Tasky may be a lightweight browser app. Avoid implementing multiple competing runtimes.

The repository should build and test with documented commands on macOS, Windows, and Linux where feasible. No remote account or service may be required for normal use. Prefer accessible, semantic controls and keyboard-friendly UX.

## 3. Conceptual model and terminology

The **product contract** is one authoritative JSON document, portable between projects. Orbit reads, validates, renders, edits, and writes this document. The contract is explicitly maintained by users or external agents. It is **not** reverse-engineered by Orbit.

- **Entity:** an identified node in a *unified model*, with `kind: "capability"` (creator/user-facing product ability) or `kind: "system"` (internal supporting component). Both have the same common structure.
- **Hierarchy:** each entity has zero or one parent (its `parentId`), forming an acyclic forest. Parent/child grouping is not a typed dependency. A capability and system should normally have same-kind parents; enforce same-kind ancestry to keep the two trees coherent.
- **Behavior:** a first-class identifiable guarantee owned by exactly one entity. A behavior is a statement of expected outcome, not a test script or required Given/When/Then format.
- **Verification reference:** a named automated test mapping to a behavior; a behavior can have zero or many references.
- **Execution evidence:** externally supplied test-result records, each associated with a test ID, status, execution timestamp, and tested Git commit where available. Orbit never runs tests.
- **Relationship:** an identified, directed, typed edge between two entities. Allowed types in v1: `dependsOn`, `uses`, `implementedBy`; semantics below.
- **Product view:** capability hierarchy, behavior contracts, aggregate verification, focused relations.
- **Engineering view:** system hierarchy, behavior contracts, aggregate verification, focused relations.
- **Impact view:** semantic diff between two contract snapshots and derived *potential* downstream impact.

### Flows

A **flow** is a named, ordered walk along relationships that already exist, drawn as a sequence diagram with a stepper. It answers *what happens, in what order* when a user exercises a capability, where the Topology map answers *what depends on what*. A flow belongs to one capability (`capabilityId`), starts with a `trigger` (User → capability), and has `steps`; each step names a `relationshipId` and a plain-language `description`. A forward step runs source → target; a step with `reply: true` runs target → source. Flows never create relationships. Unlike every other array, **step order is meaningful**. Flows are optional (`flows` may be absent) and are not part of impact traversal.

### Relationship semantics and traversal

Use source → target orientation:

| Type | Meaning | Source → target example |
|---|---|---|
| `dependsOn` | source relies on target's promised functionality | Task Scheduling → Task Management |
| `uses` | source utilizes target as a supporting system or shared capability | Task Management → Local Storage |
| `implementedBy` | source capability is supported by target system | Task Management → Task Repository |

**Potential impact flows backward along dependency/usage edges**, from a changed target to sources that rely on it. From the directly changed set, traverse reverse edges transitively, including all applicable types. Directly changed and inferred potentially affected sets must never be conflated. A modified source does not automatically impact its target. Cycles in relationships are permitted and traversal must terminate safely. Multiple edges to the same entity must not double-count it. Hierarchical parents may be visually marked as containing affected descendants, but **parenthood alone is not a dependency edge**. Label impact as *potential*, never as observed runtime breakage.

## 4. Contract file format (v1)

Use canonical UTF-8 JSON and ship a machine-readable `packages/contract/schema/orbit.schema.json` (JSON Schema 2020-12 or equivalent) alongside semantic validation. All IDs are stable, opaque strings; they must not change when an entity is renamed or reordered. Store entities in flat arrays with `parentId` rather than deeply nested JSON. This preserves stable references, simplifies graph operations, and avoids treating reordering as content changes.

Illustrative complete shape:

```json
{
  "schemaVersion": 1,
  "product": {
    "id": "tasky",
    "name": "Tasky",
    "summary": "A small personal task manager"
  },
  "entities": [
    {
      "id": "cap.tasks",
      "kind": "capability",
      "parentId": null,
      "name": "Task Management",
      "summary": "Create and maintain personal tasks",
      "description": "Users can create, edit, complete and delete tasks.",
      "behaviors": [
        {
          "id": "behavior.tasks.create",
          "name": "Create task",
          "expected": "A task with a non-empty title can be created in a selected list.",
          "testIds": ["test.tasky.tasks.create"]
        }
      ]
    },
    {
      "id": "sys.task-repository",
      "kind": "system",
      "parentId": null,
      "name": "Task Repository",
      "summary": "Read and write task records",
      "description": "Local application data access.",
      "behaviors": []
    }
  ],
  "relationships": [
    {
      "id": "rel.tasks.repository",
      "type": "implementedBy",
      "sourceId": "cap.tasks",
      "targetId": "sys.task-repository",
      "description": "Task management relies on local task persistence."
    }
  ],
  "tests": [
    {
      "id": "test.tasky.tasks.create",
      "name": "Create task integration test",
      "location": "apps/tasky/tests/tasks.spec.ts#create-task"
    }
  ],
  "evidence": [
    {
      "id": "run.create.001",
      "testId": "test.tasky.tasks.create",
      "status": "passed",
      "executedAt": "2026-11-13T18:00:00Z",
      "commit": "0123456789abcdef0123456789abcdef01234567"
    }
  ]
}
```

**Normative field rules:**

- Required top level: `schemaVersion`, `product`, `entities`, `relationships`, `tests`, `evidence`. Unknown properties are rejected by the v1 schema (better than silently losing metadata).
- Product: required stable `id`, nonblank `name`, nonblank `summary`; optional `description`.
- Entity: required `id`, `kind`, nullable `parentId`, `name`, `summary`, `description`, `behaviors` (possibly empty). `kind` is one of `capability`, `system`. Empty descriptions allowed; nonblank names/summaries required.
- Behavior: `id`, `name`, `expected`, `testIds` (possibly empty). IDs unique globally across all behaviors. Nonblank expected outcome.
- Flow (optional top-level `flows`): `id` (prefix `flow.`, unique), `name`, `summary`, `capabilityId` (must be a capability), `trigger`, `steps` (ordered). Step: `id` (unique within the flow), `relationshipId` (must exist), optional `reply: true`, optional short `label` (drawn on the arrow; defaults to the relationship verb or "replies"), `description`. Warnings: `flow.empty`, `flow.step.unreached` (the step's sender has not yet taken part). Deleting a relationship removes the steps that use it; deleting an entity removes its flows.
- Relationship: `id`, one of the three types, `sourceId`, `targetId`, optional `description`. IDs unique. Prevent self-edges; permit directed cycles.
- Test definition: `id`, `name`, `location` (a human-readable source path, test identifier, or URL; not required to exist locally). IDs unique. One test may verify multiple behaviors.
- Evidence: `id`, `testId`, `status` (`passed`, `failed`, `skipped`, `error`), RFC3339 `executedAt`, and optional full 40-hex `commit` SHA. IDs unique. Evidence entries may contain an optional `details` string. Unknown commit is represented by omitting the property, not by inventing one.
- All references must point to existing IDs of the correct kind. Parent must exist and have matching entity kind. All hierarchy trees must be acyclic. No duplicate IDs within their respective or behavior namespaces; behavior IDs are globally unique. Relationship IDs identify edges across revisions.
- Do not require every entity to have behaviors, every behavior to have tests, or every test to have execution evidence; these are legitimate, visible assurance gaps.
- Storage order has no semantic meaning. Arrays of IDs (`testIds`) compare as sets. Entity/behavior/relationship/test/evidence additions, changes, and removals compare by ID.
- Validate on load, before any structured save, after raw JSON editing, and before computing a comparison. JSON Schema checks structure; semantic validation checks cross-references/cycles/uniqueness.
- The shipped schema is part of the public format; README explains how external agents can generate/update files and run validation without Orbit's GUI.

> **Superseded (2026-11-14):** the `evidence` array, commit freshness and the inspected-commit setting described in the
> rest of this section were removed. Test results now come from the JUnit XML file named by the contract's optional
> `validation` block (`command`, `results`), produced by **Validate capabilities**; results are never stored in the
> contract. A test is passing/failing only for results at or after the proposal's commit time, otherwise unconfirmed,
> and placeholder tests (`placeholder: true`) are planned. See `README.md` ("Test results") and
> `packages/contract/API.md` ("Assurance").

### Evidence and commit self-reference caveat (important)

A Git commit cannot normally contain its **own** complete SHA inside a tracked JSON file: inserting that SHA changes the commit. Consequently, commit-aware status is best-effort provenance, **not a promise that a committed contract can always contain “current” evidence for itself**. Orbit should mark evidence as current only if its recorded SHA exactly matches the revision of code being inspected, potentially outdated if different, and unknown if absent. For a working tree, compare against `HEAD` only if that is explicitly identified as the inspected code revision; explain this in the UI. External tools may generate evidence into an uncommitted working-tree contract after testing a commit. Do not invent SHA values, infer test results from Git alone, silently change evidence status, or introduce a second persistent store to conceal this tradeoff.

### Assurance summary computation

At entity level, aggregate behaviors belonging to the entity **and all descendants in its same-kind subtree**. Show (at minimum):

1. total distinct behaviors;
2. behaviors with at least one valid test reference;
3. behaviors with at least one `passed` result whose evidence matches inspected commit;
4. behaviors with a latest recorded `failed` or `error` result for the inspected commit;
5. behaviors without any mapped tests;
6. behaviors with test mappings but no matching-commit evidence / unknown or stale evidence.

Avoid double counting a behavior in a subtree. For each test, choose the latest evidence by `executedAt` *within the inspected commit* when determining current status; for displayed history also show older results. A behavior with multiple tests is not automatically “fully verified” because one passed: convey individual test statuses and use conservative summary terminology (`has passing evidence`, not `verified beyond doubt`). A behavior can appear in only one owning entity. A reference to a test with no evidence is **mapped, not passed**. When no commit context exists (standalone JSON), show recorded results and provenance, but classify freshness as **unknown** rather than current.

## 5. Orbit UX: common shell

### Application layout

- Native-feeling, clean, restrained, desktop-first interface with consistent typography and contrast. No elaborate decorative dashboard.
- Top bar: product name and file identity; Product / Engineering / Impact navigation; Open File; Save (with modified indicator); compare-selection control when Git is available; validation diagnostics entry.
- Left sidebar in Product/Engineering: searchable collapsible tree for entities of the selected kind. Show verification count summaries and change indicators when comparison is active. Make large trees navigable without losing context. Selecting an entity updates the right detail pane.
- Right detail pane: name, summary, description; editable behavior list and test mappings; relationships grouped by direction/type; focused dependency graph; verification summary and individual evidence table/history.
- Empty state: when no file is open, explain how to open an existing JSON file; provide a **Create New Contract** action with minimum product metadata, writing a valid contract to a chosen path.
- Use confirmation for destructive entity and behavior deletion and show referencing-entity implications. For changes producing invalid references, require explicit resolution before saving (or show non-destructive validation diagnostics).
- Search entities by name and ID, and behaviors by name/expected text. Clearly distinguish no matches vs empty model.
- Support keyboard navigation of hierarchy; standard Undo/Redo for in-session edits where feasible, at least for text editor operations; do not rely solely on color to communicate meaning.

### Editing workflows

- Structured editor is primary; direct raw JSON editor is optional but **required in v1** and provides validation diagnostics including line/field when possible.
- Add/edit/delete capabilities or systems; assign parent via a searchable selector constrained to same kind; reparent without altering ID; prevent ancestry cycles.
- Add/edit/delete behaviors within entities; map/unmap named test definitions; inspect evidence; create/edit/delete test definitions and evidence records via accessible UI, since **all content must be manageable manually**.
- Add/edit/delete typed directed relationships; pick existing source and target; show clearly what direction means.
- Validation errors must not silently erase unrecognized or malformed content. Keep original raw text available, allow repair, and prevent destructive overwrite if parsing fails. For semantically invalid JSON, load valid portions when safely possible, but never persist a partial reconstruction over the original without explicit user action.
- Saving updates the *selected JSON file only* using an atomic write when feasible; preserve user data. No Git add/commit/checkout, auto-format-churn unrelated to meaningful changes, or other file mutations. If on-disk content changed since load, block unsafe overwrite and offer Reload / review differences / Save As rather than silently overwriting.
- File-watch for external changes or offer explicit Reload; ensure unsaved changes are never silently replaced.

### Product and Engineering views

Both use identical components and shared data logic. Filter `kind` and relevant hierarchies, not separate models. Show own + inherited (subtree) behavior summaries in tree labels and details, with drill-down to the behavior(s) responsible for failures or gaps. Include related entities of the opposite kind in relationship panels.

### Focused dependency graph

Select an entity to display one-hop incoming and outgoing relationships with **labeled directed edges** and type distinction. Clicking a connected node selects it (and changes the view if appropriate). This is not a giant graph of the full product and is not a drag-to-edit graph. Show duplicates only as multiple distinct edges, never by visually cloning a node in the graph. Provide a straightforward textual relationship list as an accessible alternative. The product/engineering hierarchies themselves remain trees.

## 6. Git comparisons and Impact view

### Revision sources

- Standalone JSON (no Git): Product and Engineering views/editing work normally. Impact indicates that version comparison requires a local Git repository; no comparison mode is required for two arbitrary files.
- In Git repo: offer refs (local branches, `HEAD`, commit SHA) and working tree. Comparisons read the **same contract file path** from two selected revisions, with the current on-disk file representing the working tree. Do not check out or alter refs. Make base and target unambiguous (`base → target`), and provide a sensible default of `HEAD → working tree` when there are local changes; otherwise select from local refs.
- If the file is missing at one revision, treat the contract as added/removed and explain; if renamed/moved, explain that v1 uses the same path and let the user relocate/open it explicitly rather than guessing.
- Invalid revision JSON: show diagnostics and block misleading semantic comparisons; never fall back to textual diffs and pretend they are semantic.
- Git access is read-only. Handle unavailable Git executable, detached HEAD, untracked file, shallow repo, and missing refs with actionable messages. No network required.

### Semantic comparison

Compare model by stable IDs, not formatting or array order:

- Entities: added, removed, modified (name, summary, description, kind, parent).
- Behaviors: added, removed, modified (name, expected, test mapping); show ownership changes as changes with relevant before/after owner, not as loss of identity.
- Relationships: added, removed, modified (type/source/target/description).
- Test definitions and evidence: additions/removals/field updates, with differentiation between changes in *product guarantees* and changes in *verification metadata*. Evidence changes must not be interpreted as product behavior changes.
- Product metadata changes.
- Ignored: whitespace, key order, entity array order, testId ordering, benign JSON formatting.

### Presentation

**Integrated highlighting:** Product/Engineering explorers show green added, amber modified, red removed, and a clearly different indicator for potentially affected dependents. Removed nodes must remain visible in comparison context as read-only *ghost* entries based on the base revision. Show an accessible legend and labels/icons; never rely on color alone. A parent with affected descendants may show a summary, but isn't classified as directly modified unless its own fields changed.

**Dedicated Impact workspace:** A compact header for base/target revisions, change totals by entity type, behaviors, relationships, tests/evidence, and a categorized list of all semantic changes. Selecting a change displays field-level before/after values, a side-by-side or inline diff, and potential upstream consumers found by dependency traversal. Distinguish direct change from inferred potential impact; make it easy to jump into Product or Engineering with the same comparison selected.

**Proposed versus actual:** Orbit has no proposals or approvals of its own. A user can compare `main → proposal branch`, `main → implementation branch`, or other local refs. Comparing proposals against implementations requires selecting those two refs. Orbit must not claim an implementation's real-world consequences are known merely because a JSON file changed.

### Impact traversal timing

Use the **union of base and target relationship graphs** when determining potentially affected dependents so removals and changed edges do not hide prior consumers. Show provenance for an inferred impact (e.g., “Task Lists uses Task Repository”) with at least one clear relationship path; allow cycles without infinite loops. If the graph changes in the diff, show the before/after relationship change separately.

## 7. Tasky — intentionally spartan reference app

### Purpose and design boundary

Tasky is a real, working local personal task manager, **not a second flagship product**. Its job is to supply meaningful, testable product capabilities, internal systems, and change examples for Orbit. Time spent polishing Tasky beyond supporting Orbit test scenarios is out of scope.

### Visual direction from reference image

Use `docs/tasky-visual-reference.png` for inspiration, not pixel-perfect copying. Preserve its **quiet white/light gray surfaces, left navigation/sidebar, blue accent, roomy list entries, subtle separators, and restrained typography**. Simplify aggressively: no decorative rays/backdrop, multi-column calendar schedule, shopping feature, tags taxonomy, animations, avatars, marketing UI, or decorative cards. The screenshot depicts a more elaborate personal organizer; Tasky should be a slim, coherent subset.

### Tasky screen and core behaviors

- Single desktop-friendly responsive layout: sidebar with **Inbox**, **Today**, **All Tasks**, and custom lists; main panel shows selected list/filter; top bar has a simple **New Task** affordance.
- **Task** fields: stable ID, nonblank title, optional notes, optional due date (local calendar date `YYYY-MM-DD`), completed boolean, owning list ID, createdAt and updatedAt timestamps. Do not add priorities, subtasks, reminders, recurrence, sharing, attachments, or tags in v1.
- **Custom lists:** user can create, rename, delete lists. Inbox is built-in and cannot be deleted or renamed. Deleting a custom list moves its tasks to Inbox (not deletes tasks); clearly confirm this behavior.
- **Task CRUD:** create, edit title/notes/due date/list, toggle completion, delete with confirmation. Empty titles rejected; other fields optional. Newly created tasks default to Inbox unless created within a custom list.
- **Views:** Inbox shows Inbox tasks; custom list shows its tasks; Today shows *incomplete tasks due today or earlier* (overdue included) across lists; All Tasks shows all tasks, including completed. By default, other views show incomplete tasks with a simple “Show completed” toggle. Show useful empty states.
- **Ordering:** incomplete tasks first, then by due date (earliest first, missing dates last), then createdAt; stable deterministic tie-breaking. All Tasks can show completed tasks separately or after incomplete tasks. No drag ordering necessary.
- **Persistence:** all user data stored locally and survives reload/restart; a simple localStorage-backed repository is adequate for Tasky; no user accounts, server, or external dependencies. Define schema and handle invalid/corrupt local data gracefully (don't crash or silently destroy it).
- **Due-date semantics:** Today/overdue are computed from the user's local calendar date; timezone changes and day rollover should update views when revisited/refreshed. Don't introduce notification scheduling.
- **Accessibility:** meaningful labels for create/edit/complete/delete, keyboard-operable task controls, focus management on dialogs, visible focus, sufficient contrast.
- **Scope:** do not implement the calendar panel visible in the screenshot. It is only an inspiration image.

### Tasky contract coverage

Ship `examples/tasky.orbit.json` with at least the following **product capability hierarchy** (names can be refined for readability but IDs should remain stable):

```text
Task Management
  Create and Edit Tasks
  Complete and Delete Tasks
Task Organization
  Custom Lists
  Task Assignment
Task Discovery
  Inbox and All Tasks
  Today and Overdue
```

And these **internal systems**:

```text
Local Data
  Task Repository
  List Repository
Presentation Logic
  Task Filtering and Sorting
  Local Date Evaluation
```

All eight leaf capabilities/systems should have meaningful behavioral guarantees, not placeholder phrases. Define at least **18 distinct named behaviors** total across both kinds. Map at least **12 behaviors** to real, executable automated tests. Include relationships: capabilities `implementedBy` systems; capability `dependsOn` capability (e.g., Today and Overdue → Create and Edit Tasks); capabilities `uses` systems as appropriate; internal system `uses` another internal system if genuine. Every relationship should be defensible from Tasky's actual implementation. Avoid spurious links added merely to increase graph density.

Seed **at least three named lists** and **ten representative tasks** in a demo-only seed path or sample dataset, including incomplete/completed, due today, overdue, future and no due date. Normal user data should not be silently reset/reseeded. Provide an explicit reset-demo action or documented development command.

### Automated tests and evidence feed

Create a real Tasky test suite, exercising important behaviors, preferably through user-visible workflows plus focused domain tests. Run in deterministic conditions: use a controllable clock for Today behavior and isolated storage per test. Test references in `tasky.orbit.json` must correspond to **actual test identifiers or paths**, not invented names. Provide a documented small utility/script to generate or update Orbit `evidence` records from machine-readable test results, including test IDs, status, timestamps, and inspected commit where available. This script is an **external example producer**, not Orbit functionality. It must not create fake passes. Keep test results out of user-facing Tasky functionality.

### Contract evolution demonstration

Include a repeatable demonstration that produces a meaningful semantic diff **without altering the main fixture as a side effect**:

- Base contract: Tasky capabilities, behaviors, systems, and test references.
- Proposed change example: add a behavior to Today and Overdue (“Overdue items remain visible in Today”), update test mapping, and add a valid relationship if justified.
- Actual change example: exercise a different legitimate modification (e.g., notes editing behavior and test reference); document which is directly changed vs potentially affected.
- Prefer deterministic fixture snapshots and a script to create a **temporary, local Git repository** containing contract revisions so Orbit's Impact view can be tested without creating or switching branches in the main monorepo. The script may use Git because it is test infrastructure **outside Orbit**, not Orbit Git functionality.
- Verify change counts, ID-based field-level deltas, ignored reorder changes, removed-entity ghosts, reverse-edge impact, and evidence freshness states.

## 8. Acceptance criteria and end-to-end scenarios

**AC-01: No file.** Starting Orbit without a contract presents Open/Create actions. Creating a contract writes schema-valid JSON with empty arrays.

**AC-02: Open and navigate.** Open Tasky fixture, see capability tree in Product and system tree in Engineering; select entity and see correct details, behaviors, mapped tests, and focused relationships.

**AC-03: Complete manual editing.** Through UI alone, create/edit/reparent/delete entities, behaviors, tests, evidence, and typed relationships; save and reopen file; all valid edits persist. No need to hand-edit JSON to access any entity type.

**AC-04: Raw JSON.** Edit a valid field in raw JSON, validate, save; structured view reflects it. Malformed JSON shows diagnostics and does not overwrite prior valid data.

**AC-05: Structural safeguards.** Duplicate IDs, broken refs, parent cycles, invalid enums, bad timestamps, and cross-kind parent relationships show actionable diagnostics. Valid parts are visible where safely possible. No automatic destructive fix.

**AC-06: Concurrent change safeguard.** Externally modify the same file with unsaved Orbit edits; Orbit detects conflict and requires an explicit choice; it never silently overwrites either version.

**AC-07: Verification summary.** Hierarchical rollups count behaviors exactly once and distinguish no tests, mapped/no evidence, passed/current, failed/current, and unknown/stale evidence. Changing child evidence updates ancestor summaries.

**AC-08: Directed graph.** Focused graph shows labeled incoming/outgoing typed edges, navigation to connected nodes, and a textual alternative; cycles do not crash it.

**AC-09: Semantic diff.** Compare two local Git revisions: show entity/behavior/relationship/test/evidence additions, modifications, removals, and field-level before/after. JSON reformatting/reordering yields no semantic changes.

**AC-10: Embedded change context.** With comparison active, both Product and Engineering trees highlight added, modified, removed, and potentially affected entries; removed entities remain inspectable.

**AC-11: Impact.** When a shared target system changes, all reverse-reachable consumers across multiple hops are marked *potentially affected* with paths; changing a source does not automatically mark unrelated dependencies. Base-only relationships are considered on removals.

**AC-12: Git independence.** Any JSON file outside Git is fully viewable/editable, and Git-specific UI degrades gracefully without blocking work.

**AC-13: Git read-only.** Orbit's comparison features do not modify worktree, index, refs, or repository configuration; test this mechanically. Exception (added later): the MCP tool `mark_proposal` creates or moves the lightweight tag `orbit/proposal/<branch>` and nothing else.

**AC-14: Tasky user flows.** Users can create/edit/complete/delete tasks; create/rename/delete custom lists; filter Inbox/Today/All Tasks; see overdue items Today; retain changes on reload; and delete a list without losing its tasks.

**AC-15: Tasky traceability.** At least 18 nontrivial modeled behaviors exist, at least 12 map to real tests, and actual test results can be converted to valid evidence by the example script; failed/unknown results aren't fabricated as passed.

**AC-16: Demo impacts.** An agent can run a documented command to create/inspect a temporary comparison repository and reproduce a known semantic diff and dependency impact in Orbit.

**AC-17: Visual polish.** Orbit is navigable and readable at a typical laptop desktop viewport (e.g. 1280×800) with keyboard access; Tasky is substantially simpler than the attached inspiration and maintains its restrained layout on smaller widths.

**AC-18: Reproducible handoff.** Fresh checkout with documented prerequisites can install, start Orbit, start Tasky, validate contract, run tests, and execute comparison demo without access to private services or previous chat context.

## 9. Recommended implementation sequence (vertical slices)

1. **Workspace + contract core.** Monorepo, schema, TypeScript types, fixture, validation diagnostics, semantic diff, directed graph traversal, focused unit tests.
2. **Orbit file explorer + editing.** Open/create/save JSON, safe writes and external-change handling, Product and Engineering trees, structured editing, raw JSON, full entity/behavior/test/evidence/relationship CRUD.
3. **Assurance + relationships.** Accurate hierarchical summaries, freshness provenance, focused dependency graph and related details.
4. **Local Git and Impact.** Read-only snapshot loading, base/target selection, semantic comparisons, integrated highlights, removed ghosts, transitive impact and provenance paths.
5. **Tasky reference app.** Minimal task manager with tests, seeded demo, a genuine contract aligned to implementation, evidence ingestion script, Git comparison demo fixtures.
6. **Hardening.** E2E of both apps, OS/path edge cases, accessibility, fixture consistency, README, clean-install verification.

Sequence is suggested; a coding agent may implement Tasky before Orbit's UI to ground the fixture, provided the final capabilities are cohesive and tested. Do **not** turn each underlying technical layer into a separately user-facing feature.

## 10. Quality bar and definition of done

The feature is done only when the primary flows work **end to end**, not when code scaffolding exists. Type-check, lint, unit tests, and end-to-end tests must pass; documentation must match executable commands; no placeholder mocks posing as live verification; no hard-coded demo counts displayed as real Orbit assurance; no forced coupling between Tasky and Orbit beyond fixture/schema reuse; and no undocumented setup requiring a remote account.

Record any compromises or platform limitations in the README. In particular, disclose that Orbit is an evidence **viewer**, not an authoritative test runner, and that exact commit freshness is constrained by the Git self-reference problem above. Prefer readable, robust implementation over new abstraction layers.

## 11. Scope decisions and resolved assumptions

This spec incorporates 24 product decisions: product understanding is primary; explicit/manual modeling; one JSON contract; strict hierarchies; first-class behavior IDs; automated test refs + externally supplied evidence; unified capability/system entity model; typed relationships; transitive potential impact; direct editing, no native proposal workflow; local Git reads only; hierarchical primary explorer; combined integrated and dedicated comparison; field-level semantic diffs; counts and hierarchical verification rollups; commit-aware freshness; structured editor + raw JSON; safe diagnostics; one-hop relationship visualization; open by JSON file; and no orchestration/integrations.

**Reasoned implementation choices introduced here to close specification gaps** (not separately user-approved): flat entity arrays, same-kind hierarchy, v1 relationship type meanings, conservative assurance-count semantics, read-only Git ref selection, three minimal Tasky lists/filters, Tasky local storage, fixture/test counts, and temporary Git demo strategy. These can be revisited if tests reveal a concrete issue, but should not prompt an agent to invent wider functionality.
