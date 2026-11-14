# Orbit

**Orbit** is a local-first desktop app for modeling, visualizing, and comparing what a software product does.
You open one JSON **product contract** that describes the product's user-facing **capabilities**, its internal
**systems**, the **behaviors** each one guarantees, typed **relationships** between them, and the automated **tests**
and test **evidence** behind each behavior. Orbit gives you three perspectives on that file:

| View | For | What you see |
|---|---|---|
| **Product** | product owners | capability tree, behaviors, assurance rollups, focused relationship graph |
| **Engineering** | engineering leads | the same for internal systems |
| **Impact** | everyone | a semantic diff between two Git revisions of the contract, and the *potential* downstream impact |

Orbit edits the JSON file directly (atomic, conflict-safe saves). When the file lives in a local Git repository,
Orbit compares it across branches, commits, and the working tree, **read-only**. It never commits, checks out, or
stages anything.

**Tasky** (`apps/tasky`) is a small, real personal task manager in the same repo. It's the reference product: its
contract is [`examples/tasky.orbit.json`](examples/tasky.orbit.json), and its tests produce real evidence for that
contract.

Orbit also has a built-in **MCP server**, so AI agents can do everything a user can in the running app. See
[AI access (MCP)](#ai-access-mcp).

![Orbit Product view](docs/screenshots/orbit-product.png)

## Repository layout

```text
apps/orbit/            Orbit desktop app: Tauri 2 (Rust backend in src-tauri/) + React + Radix UI
apps/tasky/            Tasky reference app (Vite + React, localStorage)
packages/contract/     @orbit/contract: types, JSON Schema, validation, semantic diff, graph/impact, assurance
examples/              tasky.orbit.json (main fixture), invalid.orbit.json (diagnostics demo), demo/ snapshots
scripts/               validate-contract, generate-evidence, create-demo-repo, orbit-mcp-stdio
tests/                 cross-package integration tests (fixture, evidence script, impact demo)
docs/                  ORBIT_SPEC.md, visual reference, screenshots
```

## Prerequisites

- **Node.js 20+** (developed on Node 24) and npm
- **Rust** (stable, 1.77+) with Cargo, plus your OS's [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  (Xcode Command Line Tools on macOS; WebView2 + MSVC build tools on Windows; webkit2gtk etc. on Linux)
- **Git** (optional: needed only for comparisons and the impact demo)

No accounts, services, or network access are needed at runtime.

```bash
npm install
npx playwright install chromium   # only for the end-to-end tests
```

## Run

```bash
npm run orbit                                   # Orbit desktop app (tauri dev; first run compiles Rust)
ORBIT_FILE="$PWD/examples/tasky.orbit.json" npm run orbit   # open a file directly at launch
npm run orbit:build                             # release build + installer bundle (apps/orbit/src-tauri/target/release)
npm run tasky                                   # Tasky at http://localhost:5174
```

In Orbit: **Open contract…** → `examples/tasky.orbit.json`. Try the Product and Engineering trees, select an entity,
edit behaviors, open **Tests & evidence**, toggle **Raw JSON**, and open **Impact**.

## Test and verify

```bash
npm run typecheck        # TypeScript across all workspaces
npm run lint             # ESLint
npm test                 # unit tests: contract, Orbit (Vitest + cargo test), Tasky, integration
npm run test:e2e         # Playwright: Orbit UI (in-memory host) and Tasky
npm run validate         # validate examples/tasky.orbit.json (or: npm run validate -- path/to/file.json)
npm run test:mcp         # live: launches the real Orbit app and drives it over MCP (build first, see below)
```

`npm run test:mcp` needs a debug build: `cd apps/orbit && npx tauri build --debug --no-bundle`. It creates a
throwaway demo repo, launches the native app on it, and uses the official MCP SDK client (over HTTP and the stdio
bridge) to open, compare, edit, save, hit a save conflict, reload, and navigate. It then checks that `.git` is
byte-identical.

`cargo test` (run by `npm test`) includes a mechanical **read-only Git** test (AC-13). It hashes every file under
`.git` and the worktree before and after running every Git operation Orbit uses, and asserts they're byte-identical.

## Impact demo (repeatable)

```bash
npm run demo:impact                 # creates a throwaway Git repo in your temp dir and prints its path
npm run demo:impact -- --dir /tmp/orbit-demo
```

The script never touches this repository. It builds a temp repo from `examples/demo/*.orbit.json`:

- `main`: the base contract, plus a reformat-only commit (**0 semantic changes**).
- `proposal`: adds "Overdue items remain visible in Today" plus a test mapping and a relationship.
- `implementation`:
  - adds a notes-editing behavior and test, and changes *Local Date Evaluation*;
  - removes *Complete and Delete Tasks* (shown as a ghost);
  - adds evidence that cites a real code commit.
- an uncommitted edit, so `HEAD → Working tree` has a diff.

Open `<printed path>/tasky.orbit.json` in Orbit → **Impact** → choose `main → implementation`. You should see:

- **Directly changed:** Complete and Delete Tasks, Create and Edit Tasks, Local Date Evaluation
- **Potentially affected:**
  - Today and Overdue (*dependsOn* Create and Edit Tasks)
  - Task Filtering and Sorting (*uses* Local Date Evaluation)
  - Inbox and All Tasks, two hops away (*uses* Task Filtering and Sorting → *uses* Local Date Evaluation)

Set **Evidence** to the implementation code commit the script prints. You'll then see **current**, **potentially
outdated** (stale), and **unknown** freshness side by side. `tests/demo.test.ts` asserts all of this.

## The contract format

- Schema: [`packages/contract/schema/orbit.schema.json`](packages/contract/schema/orbit.schema.json) (JSON Schema 2020-12).
- Rules: [`docs/ORBIT_SPEC.md` §4](docs/ORBIT_SPEC.md).

In short:

- The top level has `schemaVersion: 1` plus `product`, `entities`, `relationships`, `tests`, and `evidence`.
- Entities are flat, with `parentId`. Each has `kind` `capability` or `system`, and parents must be the same kind.
- Behaviors live inside their owning entity and have globally unique ids.
- Relationships are `dependsOn`, `uses`, or `implementedBy`, read source → target.
- IDs are stable and opaque. Array order carries no meaning.

**For external tools and AI agents editing files directly:** edit the JSON with any tool, then validate:

```bash
npm run validate -- path/to/product.orbit.json        # human-readable, exit code 1 on errors
npm run validate -- path/to/product.orbit.json --json # machine-readable diagnostics
```

Or validate from code:

```js
import { parseContract } from '@orbit/contract/dist'; // after: npm run build -w @orbit/contract
```

`parseContract(text)` returns diagnostics with JSON pointers and line/column.

### Producing evidence

Orbit **displays** evidence; it never runs tests. `scripts/generate-evidence.mjs` is an example *external* producer:
it converts Vitest and Playwright JSON reports into evidence records, keyed by `[test.id]` tags in test titles.

```bash
npm run evidence -- --contract examples/tasky.orbit.json --run --write
```

Failed tests are recorded as failed, and tests with no results produce nothing. The `commit` is set only when the
code tree is clean at a real `HEAD`; otherwise it's omitted and `details` says why.

## AI access (MCP)

When the desktop app is running, it serves a **Model Context Protocol** server at `http://127.0.0.1:47821/mcp`
(Streamable HTTP, localhost only, no auth). Tools act on the document open in the window, with the
same safeguards as manual editing:

- edits are in-memory and undoable until saved;
- edits that would introduce invalid references are rejected;
- external changes are never overwritten;
- Git stays read-only.

You see AI actions live: toasts, selection, and an activity log.

Open **AI** in the top bar for the endpoint, enable/disable switch, and copy-paste setup. For example:

```bash
claude mcp add --transport http orbit http://127.0.0.1:47821/mcp
```

For stdio-only clients, use `node scripts/orbit-mcp-stdio.mjs` (optionally with `ORBIT_MCP_URL` set).

- Full tool catalog and setup: [`apps/orbit/MCP.md`](apps/orbit/MCP.md).
- Server internals: [`apps/orbit/src-tauri/README.md`](apps/orbit/src-tauri/README.md).
- Environment overrides: `ORBIT_MCP_PORT`, `ORBIT_MCP_DISABLED=1`.

## Architecture notes

- **`@orbit/contract`** is pure TypeScript (browser-safe) and holds all domain logic: parsing with line/column
  diagnostics, schema + semantic validation, canonical serialization, assurance rollups, reverse-edge impact, and
  ID-based semantic diff. The UI, scripts, and tests all reuse it.
- **Orbit UI** (`apps/orbit/src`) is React + Radix Themes, built on a single store/controller. All file and Git
  access goes through the `OrbitHost` interface (`src/host/types.ts`):
  - The Tauri host calls Rust commands.
  - An in-memory host backs the Playwright end-to-end tests in a normal browser. The macOS WebView has no WebDriver,
    so `tauri-driver` can't run the real shell there.
- **Strict CSP:** the desktop webview runs under a CSP without `unsafe-eval`. The JSON Schema validator is therefore
  precompiled to static code (`packages/contract/src/generated/`, regenerate with `npm run gen -w @orbit/contract`),
  and a test guards against runtime code generation.
- **Rust backend** (`apps/orbit/src-tauri`):
  - **Saves:** atomic (temp file + fsync + rename), checked against the SHA-256 of the file as loaded. A changed
    file is a conflict, and nothing is written.
  - **Git:** shells out to `git` with read-only plumbing only. It sets `GIT_OPTIONAL_LOCKS=0`, never runs
    `git status`, and compares working-tree bytes with `git show HEAD:path`.

## Compromises and limitations

- **Orbit is an evidence viewer, not a test runner.** It shows evidence that external tools recorded in the contract.
- **Commit freshness is best-effort.** A commit can't contain its own SHA, so a committed contract can't hold "current"
  evidence for itself (see spec §4).
  - Freshness is **current** only when evidence's `commit` exactly matches the revision you choose under **Evidence**.
  - With no revision chosen (the default), freshness is **unknown**.
  - The demo shows the recommended flow: commit the code, then record evidence that cites that commit.
- **Comparisons use the same file path at both revisions.** A renamed or moved contract shows as added/removed;
  open the other path explicitly.
- **The E2E tests don't run the native shell.** Playwright drives the real UI against an in-memory host. The Rust host
  is covered by `cargo test`, including real temp Git repos. `npm run test:mcp` exercises the real native app end
  to end.
- **Windows and Linux** code paths (path separators, replace-on-rename) are written but have only been run on macOS.
- **Scope beyond the spec:** the spec listed "no AI integration" as a non-goal. The product owner later explicitly
  requested the built-in MCP server. It adds no AI inside Orbit; it only lets external agents drive the app, under
  the same rules as a user.
