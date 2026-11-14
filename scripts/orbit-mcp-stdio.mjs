#!/usr/bin/env node
// Orbit MCP stdio <-> HTTP bridge. Dependency-free (Node 18+).
//
// For MCP clients that only speak stdio (e.g. Claude Desktop). Reads newline-delimited JSON-RPC from stdin, POSTs each
// message to Orbit's local MCP endpoint, and writes the responses to stdout (one JSON document per line).
//
//   ORBIT_MCP_URL    endpoint (default http://127.0.0.1:47821/mcp)
//   ORBIT_MCP_TOKEN  bearer token shown in Orbit's "AI access (MCP)" dialog
//
// Logs go to stderr only (stdout is reserved for the protocol).
import readline from 'node:readline';

const URL_ = process.env.ORBIT_MCP_URL || 'http://127.0.0.1:47821/mcp';
const TOKEN = process.env.ORBIT_MCP_TOKEN || '';
const TIMEOUT_MS = Number(process.env.ORBIT_MCP_TIMEOUT_MS) || 120_000;

let sessionId = null;
let protocolVersion = null;
let pending = 0;
let closed = false;

const log = (...a) => process.stderr.write(`[orbit-mcp-stdio] ${a.join(' ')}\n`);
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);


function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Parse a text/event-stream body into the JSON payloads of its `data:` events. */
function parseSse(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data.trim()) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      log('ignoring unparsable SSE event');
    }
  }
  return out;
}

async function forward(message) {
  const hasId = message && typeof message === 'object' && !Array.isArray(message) && 'id' in message && message.id !== null && message.id !== undefined;
  const id = hasId ? message.id : null;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
  };
  let res;
  try {
    res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const reason = e && e.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (e && e.cause && e.cause.code) || (e && e.message) || String(e);
    const msg = `Cannot reach Orbit at ${URL_} (${reason}). Is Orbit running with AI access enabled?`;
    log(msg);
    if (hasId) send(rpcError(id, -32000, msg));
    return;
  }
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  if (res.status === 202 || res.status === 204) {
    await res.arrayBuffer().catch(() => undefined);
    return;
  }
  const body = await res.text();
  const type = (res.headers.get('content-type') || '').toLowerCase();
  let docs = [];
  if (type.includes('text/event-stream')) docs = parseSse(body);
  else if (body.trim()) {
    try {
      const parsed = JSON.parse(body);
      docs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      /* not JSON */
    }
  }
  if (!res.ok && !docs.some((d) => d && d.jsonrpc)) {
    const hint = res.status === 401 || res.status === 403 ? ' Check ORBIT_MCP_TOKEN against the token in Orbit (AI access dialog).' : '';
    const msg = `Orbit returned HTTP ${res.status}${body ? `: ${body.trim().slice(0, 300)}` : ''}.${hint}`;
    log(msg);
    if (hasId) send(rpcError(id, -32000, msg));
    return;
  }
  for (const d of docs) {
    if (d && d.result && typeof d.result.protocolVersion === 'string') protocolVersion = d.result.protocolVersion;
    send(d);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    send(rpcError(null, -32700, 'Parse error: each stdin line must be one JSON-RPC message.'));
    return;
  }
  pending++;
  forward(message)
    .catch((e) => {
      log('unexpected error:', e && e.message ? e.message : String(e));
      if (message && message.id !== undefined && message.id !== null) send(rpcError(message.id, -32603, `Bridge error: ${e && e.message ? e.message : e}`));
    })
    .finally(() => {
      pending--;
      if (closed && pending === 0) process.exit(0);
    });
});
rl.on('close', () => {
  closed = true;
  if (pending === 0) process.exit(0);
});
