# Tasky

A deliberately small, real personal task manager. It is the reference application for Orbit: its behaviors,
internal systems and tests are modeled in [`examples/tasky.orbit.json`](../../examples/tasky.orbit.json).
Everything is stored in your browser (`localStorage`); there are no accounts or servers.

## Run

```sh
npm run tasky                 # from the repo root, http://localhost:5174
# or: npm run dev -w @orbit/tasky
```

First run shows an empty state with **Load demo data** (3 lists, 14 tasks with overdue, due-today, future,
undated and completed items). **Reset demo data** in the sidebar footer replaces all data after confirmation.
Existing data is never reseeded automatically.

If stored data cannot be read, Tasky shows a banner and writes nothing until you choose **Download raw data**
or **Start fresh** (which keeps a backup copy under a `tasky:v1:backup:<timestamp>` key).

## Test

```sh
npm run test -w @orbit/tasky       # Vitest domain tests (tests/unit)
npm run test:e2e -w @orbit/tasky   # Playwright, Chromium only, starts vite on :5174 (tests/e2e)
npx tsc --noEmit -p apps/tasky     # type check
```

Tests are deterministic: storage is isolated per test (fresh browser context / in-memory `Storage`) and time is
controlled (`page.clock` in Playwright, an injected `now` in unit tests; the browser time zone is fixed to
`America/New_York`).

### Test id convention

A test that verifies a modeled behavior carries its Orbit test id in its title, in square brackets:

```ts
test('creates a task in the selected list [test.tasky.tasks.create]', ...)
```

The contract's `tests[].location` is `<file path> › <title without the bracket tag>`. The integration test
`tests/fixture.test.ts` checks that every contract test id exists in a real test file here.

### Evidence

`node scripts/generate-evidence.mjs --contract examples/tasky.orbit.json --run --write` runs these suites and appends
real results to the contract's `evidence` (see the script header). It is an example external producer, not part of Orbit.

## Architecture to contract mapping

| Orbit system (`sys.*`) | Code | Capabilities that rely on it |
|---|---|---|
| `sys.local-data` | `src/data/storage.ts` (`LocalStore`: one versioned document `tasky:v1`, corrupt-data handling, backup), `src/data/demoSeed.ts` | all |
| `sys.task-repository` | `src/data/taskRepository.ts`, validation in `src/domain/validation.ts` | Create and Edit Tasks, Complete and Delete Tasks, Task Assignment |
| `sys.list-repository` | `src/data/listRepository.ts` (deleting a list moves its tasks to Inbox in one write) | Custom Lists |
| `sys.filtering-sorting` | `src/logic/filtering.ts` (view filters, ordering, counts) | Today and Overdue, Inbox and All Tasks |
| `sys.local-date` | `src/logic/localDate.ts`, `src/ui/useToday.ts` (focus, visibility and midnight re-evaluation) | Today and Overdue (directly and through filtering) |

| Orbit capability (`cap.*`) | UI |
|---|---|
| Create and Edit Tasks | `TaskDialog.tsx`, `Modal.tsx` |
| Complete and Delete Tasks | `TaskRow.tsx`, `ConfirmDialog.tsx` |
| Custom Lists | `Sidebar.tsx`, `ListDialog.tsx` |
| Task Assignment | list select in `TaskDialog.tsx`; default list in `App.tsx` |
| Inbox and All Tasks / Today and Overdue | `App.tsx` views over `filterTasks` |

Layering: `domain/` (types, validation) <- `data/` (repositories) and `logic/` (pure functions) <- `ui/` (React).
Deliberate assurance gaps (modeled behaviors without tests): responsive navigation, time zone change, failed saves.
