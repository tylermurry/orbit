#!/usr/bin/env node
// Creates a throwaway local Git repository containing Tasky contract revisions so Orbit's Impact view
// can be demonstrated without touching this monorepo's Git history. Test infrastructure, not Orbit.
//
// Usage: node scripts/create-demo-repo.mjs [--dir <path>] [--json]
//   --dir <path>  target directory (default: <tmpdir>/orbit-impact-demo-<timestamp>); must not be a non-empty directory
//   --json        print a machine-readable summary on stdout instead of the human-readable guide
//
// Snapshots live in examples/demo/. 04-implementation contains two placeholder SHAs that are replaced with
// real commits of the temporary repo: 40 x "b" -> the main branch code commit, 40 x "a" -> the implementation
// code commit (which is created BEFORE the contract commit that references it; see the self-reference caveat).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = join(repoRoot, 'examples/demo');
const CONTRACT_FILE = 'tasky.orbit.json';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dir: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--dir') {
      opts.dir = argv[++i];
      if (!opts.dir) fail('--dir needs a path');
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/create-demo-repo.mjs [--dir <path>] [--json]');
      process.exit(0);
    } else fail(`unknown argument "${argv[i]}"`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ---------- target directory ----------
let dir;
if (opts.dir) {
  dir = resolve(opts.dir);
  if (existsSync(dir)) {
    if (readdirSync(dir).length > 0) fail(`${dir} already exists and is not empty; choose another --dir`);
  } else mkdirSync(dir, { recursive: true });
} else {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  dir = mkdtempSync(join(tmpdir(), `orbit-impact-demo-${stamp}-`));
}
dir = realpathSync(dir);

// ---------- git helper: always runs with cwd = the temporary directory ----------
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
function git(...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: gitEnv });
  if (r.error) fail(`could not run git: ${r.error.message}. Install Git and make sure it is on your PATH.`);
  if (r.status !== 0) fail(`git ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const init = spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', env: gitEnv });
if (init.error) fail(`could not run git: ${init.error.message}. Install Git and make sure it is on your PATH.`);
if (init.status !== 0) {
  // Git older than 2.28 has no `-b`.
  git('init');
  git('checkout', '-b', 'main');
}
if (realpathSync(git('rev-parse', '--show-toplevel')) !== dir) fail('refusing to continue: the new repository is not rooted in the target directory');
git('config', 'user.name', 'Orbit Demo');
git('config', 'user.email', 'orbit-demo@example.invalid');
git('config', 'commit.gpgsign', 'false');
git('config', 'core.autocrlf', 'false');

// ---------- helpers ----------
const snapshot = (name) => readFileSync(join(demoDir, name), 'utf8');
const write = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const codeFile = 'src/tasky.js';
const commit = (message) => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};

// ---------- history ----------
// main: base, then a pure reformat (key order, array order, whitespace) of the same content.
write(codeFile, '// Tasky placeholder code, revision 1\nexport const revision = 1;\n');
write(CONTRACT_FILE, snapshot('01-base.orbit.json'));
const baseCommit = commit('Add Tasky contract (base)');

write(codeFile, '// Tasky placeholder code, revision 2\nexport const revision = 2;\n');
write(CONTRACT_FILE, snapshot('02-reformatted.orbit.json'));
const mainCommit = commit('Reformat contract: same meaning, different key order, array order and whitespace');

// proposal: add the "overdue items remain visible" behavior, test mapping and relationship.
git('checkout', '-q', '-b', 'proposal', 'main');
write(codeFile, '// Tasky placeholder code, revision 2\nexport const revision = 2;\n// proposal: plan to keep overdue tasks in Today\n');
write(CONTRACT_FILE, snapshot('03-proposal.orbit.json'));
const proposalCommit = commit('Propose: overdue items remain visible in Today');

// implementation: commit the code first, then the contract that describes it.
git('checkout', '-q', '-b', 'implementation', 'main');
write(codeFile, '// Tasky placeholder code, revision 2\nexport const revision = 2;\n// implementation: notes editing, local date change, assignment folded into lists\n');
const codeCommit = commit('Implement notes editing and local-date change (code only)');
const implText = snapshot('04-implementation.orbit.json');
write(CONTRACT_FILE, implText);
const contractCommit = commit('Update the contract to match the implementation');

// uncommitted edit on the checked-out branch so HEAD -> working tree has a diff.
const contract = JSON.parse(implText);
const discovery = contract.entities.find((e) => e.id === 'cap.task-discovery');
discovery.summary = `${discovery.summary} (wording under review)`;
write(CONTRACT_FILE, `${JSON.stringify(contract, null, 2)}\n`);

const info = {
  dir,
  contractPath: join(dir, CONTRACT_FILE),
  checkedOut: git('rev-parse', '--abbrev-ref', 'HEAD'),
  branches: git('branch', '--format=%(refname:short)').split('\n'),
  commits: { base: baseCommit, main: mainCommit, proposal: proposalCommit, implementationCode: codeCommit, implementationContract: contractCommit },
  workingTreeChange: 'cap.task-discovery summary edited (uncommitted)',
};

// ---------- expected results, computed from the real snapshots with @orbit/contract ----------
async function describeComparisons() {
  let lib;
  try {
    lib = await import('@orbit/contract/dist');
  } catch {
    return ['(Run `npm run build -w @orbit/contract` to print the computed expected results here.)'];
  }
  const show = (ref) => {
    const text = ref === 'WORKING' ? readFileSync(info.contractPath, 'utf8') : git('show', `${ref}:${CONTRACT_FILE}`);
    const parsed = lib.parseContract(text);
    if (!parsed.ok) fail(`demo snapshot at ${ref} is invalid`);
    return parsed.contract;
  };
  const lines = [];
  for (const [label, from, to] of [
    ['main -> proposal', 'main', 'proposal'],
    ['main -> implementation', 'main', 'implementation'],
    ['HEAD -> working tree (on implementation)', 'HEAD', 'WORKING'],
  ]) {
    const a = show(from);
    const b = show(to);
    const diff = lib.diffContracts(a, b);
    const name = (id) => (b.entities.find((e) => e.id === id) ?? a.entities.find((e) => e.id === id))?.name ?? id;
    const totals = Object.entries(diff.totals)
      .map(([cat, t]) => `${cat} +${t.added} ~${t.modified} -${t.removed}`)
      .join(', ');
    lines.push(`${label}`, `  totals: ${totals}`);
    lines.push(`  directly changed: ${diff.directlyChangedEntityIds.map(name).join('; ') || '(none)'}`);
    const ghosts = Object.values(diff.entityStates).filter((s) => s.ghost).map((s) => name(s.entityId));
    if (ghosts.length) lines.push(`  removed (ghost): ${ghosts.join('; ')}`);
    if (diff.potentiallyAffected.length === 0) lines.push('  potentially affected: (none)');
    for (const p of diff.potentiallyAffected) {
      const via = p.path.map((s) => `${name(s.sourceId)} ${s.type} ${name(s.targetId)}`).join(' -> ');
      lines.push(`  potentially affected: ${name(p.entityId)}  [${via}]`);
    }
  }
  return lines;
}

if (opts.json) {
  console.log(JSON.stringify(info, null, 2));
} else {
  const expected = await describeComparisons();
  console.log(`Orbit impact demo repository created.

  Path:        ${dir}
  Contract:    ${info.contractPath}
  Branches:    ${info.branches.join(', ')} (checked out: ${info.checkedOut})
  Commits:     main ${mainCommit.slice(0, 10)}  proposal ${proposalCommit.slice(0, 10)}  implementation code ${codeCommit.slice(0, 10)}  implementation contract ${contractCommit.slice(0, 10)}
  Uncommitted: ${info.workingTreeChange}

Try it in Orbit:
  1. Open ${info.contractPath} in Orbit.
  2. Under Impact, choose Actual: everything that changed on implementation since it left main.
     Other comparisons (main -> proposal, HEAD -> working tree) are available to the AI through the compare tool.
  3. The reformat commit (base commit -> main) shows zero semantic changes.

Expected results (computed from the snapshots):
${expected.map((l) => `  ${l}`).join('\n')}

Nothing in the Orbit monorepo was modified. Delete ${dir} when you are done.`);
}
