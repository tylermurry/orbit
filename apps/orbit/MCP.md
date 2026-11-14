# Orbit AI access (MCP)

Orbit has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server so an AI assistant can take the
same actions a person can in the app: read the contract, edit entities, behaviors, tests and relationships,
run the test suite, review semantic diffs and impact, and save. The human sees everything live (a toast per AI change, the trees update,
`navigate` moves their view).

- **Where it runs:** inside the Orbit desktop app (Tauri). Rust serves HTTP on `127.0.0.1:47821` (next free port if busy)
  and forwards `tools/list` / `tools/call` to the UI runtime in `src/mcp/*`, which executes them against the live
  document store. The browser/E2E build exposes the same runtime as `window.__orbitMcp`.
- **Turn it on:** top bar **AI** button -> *AI access (MCP)* dialog -> switch on. The dialog shows the endpoint,
  copy-paste setup snippets and a log of recent AI requests.

## Connect a client

Replace `<url>` with the value from the dialog (the snippets there are pre-filled with a copy button).

### Claude Code

```sh
claude mcp add --transport http orbit <url>
```

### Cursor / any client with HTTP MCP support

```json
{ "mcpServers": { "orbit": { "type": "http", "url": "<url>" } } }
```

### Claude Desktop (stdio bridge)

Claude Desktop launches stdio servers. `scripts/orbit-mcp-stdio.mjs` is a dependency-free Node 18+ bridge that turns
stdio JSON-RPC lines into HTTP requests (it carries `Mcp-Session-Id`, parses `text/event-stream`
replies, and returns a JSON-RPC error such as "Is Orbit running with AI access enabled?" when Orbit is unreachable).

```json
{
  "mcpServers": {
    "orbit": {
      "command": "node",
      "args": ["/path/to/orbit/scripts/orbit-mcp-stdio.mjs"],
      "env": { "ORBIT_MCP_URL": "<url>" }
    }
  }
}
```

`ORBIT_MCP_URL` defaults to `http://127.0.0.1:47821/mcp`; `ORBIT_MCP_TIMEOUT_MS` (default 120000) bounds one request.

## Security model

- **Local only.** The server binds to `127.0.0.1`, validates the `Origin` header (no browser pages can talk to it). There is **no authentication**: any local process can use it while AI access is enabled.
- **Same safeguards as the UI.** AI edits go through the same undoable `edit` action as manual edits. They live in memory
  (the file shows as modified) until `save_file`; `undo` reverts them (the undo stack is shared with the person).
  Edits that would introduce validation errors are rejected with the would-be diagnostics. A file that failed
  validation is read-only exactly as in the UI (repair via `set_raw_json`).
- **No silent data loss.** `save_file` refuses to overwrite a file changed on disk (conflict -> `review_external_changes`,
  `reload_from_disk`, `save_file_as`), refuses to write validation errors unless `saveDespiteErrors: true`, and never
  applies a person's unapplied Raw JSON draft implicitly. `open_file`/`create_contract`/`reload_from_disk` refuse while
  there are unsaved changes unless `discardUnsavedChanges: true`. `save_file_as` refuses to replace a file unless
  `overwrite: true`.
- **Tests run only with the person's approval.** `run_tests` runs the contract's validation command only after the
  person approved that exact command in Orbit (Validate capabilities asks once per command, and again if it changes).
  Git access is read-only except `mark_proposal`, which only creates or moves the lightweight tag
  `orbit/proposal/<branch>`.
- **Serialized.** Tool calls run one at a time, so concurrent AI requests never interleave edits.
- Turn the switch off at any time; the status dot in the top bar shows Off / Ready / Active / Error.

## Tool catalog

`read` tools never change anything. `write` tools change the in-memory contract (undoable) or files. `navigate` tools move
the person's view or comparison. All write/edit tools accept `dryRun: true` to preview.

| Tool | Kind | What it does |
|---|---|---|
| `get_status` | read | Snapshot of the app: file, product, dirty/valid, diagnostics counts, read-only state, view and selection, raw editor state, undo/redo, git, comparison, test results, external changes. Call first. |
| `get_contract` | read | Canonical contract JSON; `source: 'working'` (default, with unsaved edits) or `'disk'`. |
| `list_entities` | read | Tree-ordered capabilities/systems with depth, behavior counts, subtree assurance and diff status; filters `kind`, `parentId`, `query`. |
| `get_entity` | read | One entity in full: ancestors, children, behaviors with each test's status and latest result, subtree assurance, relationships (with the other entity's name/kind). |
| `search` | read | Substring search over entities (name/id), behaviors (name/expected) and tests. |
| `get_assurance` | read | Verification assurance for an entity subtree or the whole product against the inspected commit. |
| `list_tests` | read | Test definitions with the behaviors they verify and their status (passing / failing / unconfirmed / planned). |
| `get_diagnostics` | read | Validation errors/warnings (codes, paths, line/column) for what the user sees. |
| `open_file` | write | Open a contract by absolute path (guards unsaved changes). |
| `create_contract` | write | Create and open a new empty contract at a path that does not exist yet. |
| `save_file` | write | Atomic canonical save; conflict- and validation-safe (`saveDespiteErrors`). |
| `save_file_as` | write | Save to a new path and switch to it (`overwrite` required to replace). |
| `reload_from_disk` | write | Re-read the file, dropping in-memory edits (needs `discardUnsavedChanges` when dirty). |
| `review_external_changes` | read | Semantic diff disk -> working, with field-level before/after (`showInApp` opens the review sheet). |
| `list_recent_files` | read | Recently opened files. |
| `update_product` | write | Change the product id, name, summary, description. |
| `create_entity` | write | Create a capability or system (optional same-kind parent; auto id `cap.*` / `sys.*`). |
| `update_entity` | write | Change name/summary/description and/or reparent (same kind, no cycles). |
| `delete_entity` | write | Delete with behaviors and relationships; children reparent (default) or block; returns the implications. |
| `create_behavior` | write | Add a behavior (`name`, `expected`, optional `testIds`) to an entity. |
| `update_behavior` | write | Change name/expected/testIds or move to another owner. |
| `delete_behavior` | write | Delete a behavior. |
| `map_tests` | write | Map existing tests to a behavior. |
| `unmap_tests` | write | Remove test mappings from a behavior. |
| `create_test` | write | Define a test (`name`, `location`); `placeholder: true` for a planned test that does not exist yet. |
| `update_test` | write | Change a test's name/location, or mark a placeholder implemented (`placeholder: false`). |
| `delete_test` | write | Delete a test and unmap it (like the UI). |
| `set_validation` | write | Set the command that runs the whole test suite and the JUnit XML results file it writes. |
| `run_tests` | write | Run the approved test command, wait, and return each test's status. |
| `create_relationship` | write | Add `dependsOn` / `uses` / `implementedBy` source -> target; refuses self-edges, no-ops on duplicates. |
| `update_relationship` | write | Change type, endpoints or description. |
| `delete_relationship` | write | Delete a relationship. |
| `apply_edits` | write | Several edit operations as ONE atomic, single-undo change. |
| `undo` | write | Undo the last edit (shared stack with the person). |
| `redo` | write | Redo the last undone edit. |
| `get_raw_json` | read | The Raw JSON editor's text (draft if unapplied). |
| `set_raw_json` | write | Validate (`apply: false`) or apply (`apply: true`) complete contract text; invalid text is never applied. |
| `navigate` | navigate | Switch view, select entity/behavior, open raw editor, library or diagnostics. |
| `filter_view` | navigate | Narrow the product/engineering trees to chosen entities and behaviors, with a yellow banner describing the filter (the person closes it with X). The AI picks the relevant ids. |
| `clear_filter` | navigate | Remove the view filter. |
| `list_git_refs` | read | Branches, tags and HEAD of the contract's repository. |
| `compare` | navigate | Set the app's comparison and return totals, directly changed and potentially affected entities, and the change list. |
| `get_change` | read | Field-level before/after for one change key of the active comparison. |
| `get_impact` | read | Potential impact for the active comparison or for arbitrary `entityIds` ("what would this affect?"). |
| `clear_comparison` | navigate | Remove the comparison. |
| `mark_proposal` | write | Tag the committed contract at HEAD as this branch's proposal (`orbit/proposal/<branch>`; `replace` to move it). |
| `view_changes` | navigate | Product-owner views: `proposal` (baseline -> proposal), `vs-proposal` (proposal -> latest), `actual` (baseline -> latest). |

### Conventions

- Ids are permanent. Omit `id` on `create_*` to get a generated one (`cap.custom-lists`, `behavior.<entity>.<slug>`,
  `test.<slug>`, `run.<test>`, `rel.<source>-<type>-<target>`); inside `apply_edits` pass explicit ids to reference
  something created earlier in the same batch.
- Unknown ids fail with up to five closest matches by id/name in `suggestions`.
- Failures are normal tool results with `isError: true`, an actionable message and `suggestions`. Protocol problems
  (unknown tool) are JSON-RPC `-32602`.
- Results are JSON in both `content[0].text` and `structuredContent`.
- Test status comes from the latest results file (`validation.results`, JUnit XML). A test is *passing* or *failing*
  only when its latest result is at or after the proposal's commit time; otherwise (no result, an older result, or
  skipped) it is *unconfirmed*. Placeholder tests are *planned*. A behavior is passing only when all its real tests pass.
- Results are matched to tests by a `[<test id>]` tag in the runner's test name when present, else by `location`
  (`<file> › <describe> › <test title>`, as the runner reports it).
- Potential impact is inferred from relationships (changed targets affect their sources); it is never observed breakage.

## Example workflows

**Orient, then add a behavior with its test (one undo step)**

1. `get_status`, `list_entities { query: "overdue" }`, `get_entity { id: "cap.task-discovery.today-overdue" }`
2. `apply_edits`:
   ```json
   { "operations": [
     { "tool": "create_test", "args": { "id": "test.today.overdue-visible", "name": "Overdue tasks stay in Today", "location": "tests/e2e/today.spec.ts › overdue stays" } },
     { "tool": "create_behavior", "args": { "entityId": "cap.task-discovery.today-overdue", "name": "Overdue items remain visible", "expected": "Overdue tasks stay in Today until completed.", "testIds": ["test.today.overdue-visible"] } }
   ] }
   ```
3. `navigate { entityId: "cap.task-discovery.today-overdue" }` so the person sees it, then `save_file` when they agree
   (or `undo` to take it back).

**Set up validation and check the product**

`set_validation { command: "npm test", results: "test-results/junit.xml" }` -> `save_file` -> the person approves the
command once (Validate capabilities) -> `run_tests` (or run the command in a terminal; Orbit reads the results file
whenever it changes) -> `get_assurance` (counts) / `list_tests { status: "failing" }`.

**Propose a feature, then track it against the proposal**

1. On a feature branch, edit the contract to describe the proposed change, including a placeholder test
   (`create_test { placeholder: true }`) mapped to each new or changed behavior so the intended test surface is
   visible. `save_file`, and commit it with git.
2. `mark_proposal { show: true }` - tags HEAD as `orbit/proposal/<branch>` and opens "View proposal".
3. While implementing, keep the contract in sync; when a planned test is written, `update_test { placeholder: false }`.
   Run the tests after each change: results from before the proposal count as *unconfirmed*. `view_changes { view: "vs-proposal" }` shows how the actual work
   differs from the proposal; `view_changes { view: "actual" }` shows everything since the branch left `main`.
   `compare` also accepts `baseline` and `proposal` as revisions.

**Review a proposal before merging**

`list_git_refs` -> `compare { base: "main", target: "proposal", show: true }` -> `get_change { key }` for each guarantee
change -> `get_impact` for the potentially affected capabilities.

**"What would changing this affect?"**

`get_impact { entityIds: ["sys.local-date"] }` before editing, then edit and `compare { base: "HEAD", target: "unsaved" }`.

**Recover from a conflict**

`save_file` -> error "changed on disk" -> `review_external_changes` -> either `reload_from_disk { discardUnsavedChanges: true }`
or `save_file_as { path }` to keep both versions.

**Repair a file that opened read-only**

`get_diagnostics` -> `get_raw_json` -> `set_raw_json { text: <fixed>, apply: true }` -> `save_file`.
