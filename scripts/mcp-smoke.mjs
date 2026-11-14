#!/usr/bin/env node
// Live end-to-end smoke test of Orbit's built-in MCP server, using the official MCP client SDK.
// It launches the REAL Orbit desktop app (Tauri debug build) on a throwaway demo Git repo, then drives it the way
// an AI agent would: over Streamable HTTP, and again through the stdio bridge.
//
// Prereqs: `cd apps/orbit && npx tauri build --debug --no-bundle` (or set ORBIT_BIN to a built binary).
// Usage:   node scripts/mcp-smoke.mjs [--keep]
// Exits non-zero on the first failed assertion. Never touches this repository's own Git state.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? 'orbit.exe' : 'orbit';
const bin = process.env.ORBIT_BIN ?? join(root, 'apps/orbit/src-tauri/target/debug', exe);
const keep = process.argv.includes('--keep');
const port = Number(process.env.ORBIT_MCP_PORT ?? 47911);
const url = `http://127.0.0.1:${port}/mcp`;

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hashTree(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

if (!existsSync(bin)) {
  console.error(`Orbit binary not found at ${bin}. Build it: cd apps/orbit && npx tauri build --debug --no-bundle`);
  process.exit(2);
}

// 1. Throwaway demo repository.
const work = mkdtempSync(join(tmpdir(), 'orbit-mcp-smoke-'));
const repo = join(work, 'repo');
execFileSync('node', [join(root, 'scripts/create-demo-repo.mjs'), '--dir', repo], { stdio: 'ignore' });
const file = join(repo, 'tasky.orbit.json');
const gitHashBefore = hashTree(join(repo, '.git'));
console.log(`Demo repo: ${repo}`);

// 2. Launch the real app.
const app = spawn(bin, [], {
  env: { ...process.env, ORBIT_FILE: file, ORBIT_MCP_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (d) => (appLog += d));
app.stderr.on('data', (d) => (appLog += d));

const cleanup = () => {
  try {
    app.kill();
  } catch {
    /* already gone */
  }
  if (!keep) rmSync(work, { recursive: true, force: true });
};
process.on('exit', cleanup);

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const payload = res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? 'null');
  return { isError: !!res.isError, payload, text: res.content?.[0]?.text ?? '' };
}

try {
  // Wait for the HTTP server and for the UI to have loaded the document.
  const client = new Client({ name: 'orbit-smoke', version: '1.0.0' });
  let connected = false;
  for (let i = 0; i < 120 && !connected; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport);
      connected = true;
    } catch {
      await sleep(500);
    }
  }
  if (!connected) throw new Error(`Could not connect to ${url}\n${appLog}`);
  console.log('\nHTTP transport (official SDK client)');
  ok(client.getServerVersion()?.name === 'orbit', `initialize → serverInfo.name = orbit (${client.getServerVersion()?.version})`);
  ok(!!client.getInstructions(), 'server provides instructions');

  // No auth is required, but foreign browser origins are refused.
  const foreign = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  ok(foreign.status === 403, `foreign origin → ${foreign.status}`);

  const { tools } = await client.listTools();
  ok(tools.length >= 40, `tools/list → ${tools.length} tools`);

  let status;
  for (let i = 0; i < 60; i++) {
    status = (await call(client, 'get_status')).payload;
    if (status?.file?.path || status?.filePath) break;
    await sleep(500);
  }
  const statusText = JSON.stringify(status);
  ok(statusText.includes('tasky.orbit.json'), 'get_status → the launched file is open');
  ok(/"available":\s*true/.test(statusText), 'get_status → git context available');

  // Read model.
  const ents = await call(client, 'list_entities', { kind: 'capability' });
  ok(!ents.isError && JSON.stringify(ents.payload).includes('Today and Overdue'), 'list_entities(capability) includes Today and Overdue');

  // Semantic comparison through real git (read-only).
  const cmp = await call(client, 'compare', { base: 'main', target: 'implementation', show: true });
  const cmpText = JSON.stringify(cmp.payload);
  ok(!cmp.isError, 'compare main → implementation succeeds');
  for (const name of ['Complete and Delete Tasks', 'Create and Edit Tasks', 'Local Date Evaluation']) ok(cmpText.includes(name), `  directly changed includes ${name}`);
  for (const name of ['Today and Overdue', 'Task Filtering and Sorting', 'Inbox and All Tasks']) ok(cmpText.includes(name), `  potentially affected includes ${name}`);
  const reformat = await call(client, 'compare', { base: 'main~1', target: 'main' });
  ok(!reformat.isError && reformat.payload?.totalChanges === 0, 'compare main~1 → main (reformat-only commit) → 0 semantic changes');
  await call(client, 'clear_comparison');

  // Edits: create, reject invalid, save, conflict safety.
  const created = await call(client, 'create_behavior', {
    entityId: 'cap.task-discovery.today-overdue',
    name: 'Smoke test behavior',
    expected: 'An MCP client can add a behavior to the open contract.',
  });
  ok(!created.isError, 'create_behavior on Today and Overdue');
  const bad = await call(client, 'create_relationship', { type: 'uses', sourceId: 'cap.task-discovery.today-overdue', targetId: 'cap.task-discovery.today-overdue' });
  ok(bad.isError, 'self-edge relationship is rejected');
  const dirty = JSON.stringify((await call(client, 'get_status')).payload);
  ok(/"dirty":\s*true/.test(dirty), 'document is dirty (unsaved) after the AI edit');
  ok(!readFileSync(file, 'utf8').includes('Smoke test behavior'), 'nothing written to disk before save_file');

  const saved = await call(client, 'save_file');
  ok(!saved.isError, 'save_file succeeds');
  ok(readFileSync(file, 'utf8').includes('Smoke test behavior'), 'saved file on disk contains the new behavior');

  // External modification → save must refuse instead of overwriting.
  await call(client, 'update_product', { summary: 'Changed by the AI' });
  const onDisk = readFileSync(file, 'utf8');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, onDisk + '\n'); // external tool touches the file
  await sleep(2500); // let the app's file watcher notice
  const conflicted = await call(client, 'save_file');
  ok(conflicted.isError, 'save_file refuses after an external change (no silent overwrite)');
  ok(readFileSync(file, 'utf8') === onDisk + '\n', 'external version preserved on disk');
  const reload = await call(client, 'reload_from_disk', { discardUnsavedChanges: true });
  ok(!reload.isError, 'reload_from_disk with explicit discard');

  // Navigation is reflected in status.
  await call(client, 'navigate', { view: 'engineering', entityId: 'sys.local-date' });
  const nav = JSON.stringify((await call(client, 'get_status')).payload);
  ok(nav.includes('engineering') && nav.includes('sys.local-date'), 'navigate → app switched to Engineering / Local Date Evaluation');

  await client.close();

  // 3. stdio bridge.
  console.log('\nstdio bridge (scripts/orbit-mcp-stdio.mjs)');
  const stdioClient = new Client({ name: 'orbit-smoke-stdio', version: '1.0.0' });
  await stdioClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'scripts/orbit-mcp-stdio.mjs')],
      env: { ...process.env, ORBIT_MCP_URL: url },
    }),
  );
  const stdioTools = await stdioClient.listTools();
  ok(stdioTools.tools.length === tools.length, `tools/list over stdio → ${stdioTools.tools.length} tools`);
  const s2 = await call(stdioClient, 'get_status');
  ok(!s2.isError && JSON.stringify(s2.payload).includes('tasky.orbit.json'), 'get_status over stdio');
  await stdioClient.close();

  // 4. Git stayed read-only.
  console.log('\nGit safety');
  ok(hashTree(join(repo, '.git')) === gitHashBefore, '.git directory byte-identical after all MCP operations');
} catch (e) {
  failures++;
  console.error('\nSmoke test crashed:', e);
  console.error(appLog.slice(-3000));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll MCP smoke checks passed');
cleanup();
process.exit(failures ? 1 : 0);
