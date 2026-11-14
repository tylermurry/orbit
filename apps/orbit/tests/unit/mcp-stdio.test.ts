/* eslint-disable @typescript-eslint/no-explicit-any */
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/orbit-mcp-stdio.mjs');

let server: http.Server;
let url = '';
const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ headers: req.headers, body });
      if (body.method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }));
      } else if (body.method === 'notifications/initialized') {
        res.writeHead(202).end();
      } else if (body.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } })}\n\n`);
      } else {
        res.writeHead(401, { 'Content-Type': 'text/plain' }).end('nope');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(lines: string[], env: Record<string, string>): Promise<{ out: any[]; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', () => resolve({ out: out.split('\n').filter(Boolean).map((l) => JSON.parse(l)), err }));
    p.stdin.end(lines.join('\n') + '\n');
  });
}

describe('orbit-mcp-stdio bridge', () => {
  it('forwards messages with auth, carries the session id, handles 202 and SSE bodies and maps HTTP failures', async () => {
    seen.length = 0;
    // sequential dependency: send initialize first, then the rest after it responded (run in two phases via one process is racy)
    const first = await run([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })], { ORBIT_MCP_URL: url, ORBIT_MCP_TOKEN: 'tok' });
    expect(first.out[0].result.protocolVersion).toBe('2025-06-18');
    expect(seen[0].headers.authorization).toBe('Bearer tok');
    expect(seen[0].headers.accept).toBe('application/json, text/event-stream');

    const r = await run(
      [JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} }), 'not json'],
      { ORBIT_MCP_URL: url, ORBIT_MCP_TOKEN: 'tok' },
    );
    const byId = (id: unknown) => r.out.find((o) => o.id === id);
    expect(byId(2).result).toEqual({ tools: [] });
    expect(byId(3).error.message).toMatch(/HTTP 401.*ORBIT_MCP_TOKEN/);
    expect(r.out.find((o) => o.error?.code === -32700)).toBeTruthy();
    expect(r.out.filter((o) => o.id === undefined)).toHaveLength(0); // the 202 notification produced no output
  });

  it('carries Mcp-Session-Id and protocol version after initialize within one session', async () => {
    seen.length = 0;
    const p = spawn(process.execPath, [script], { env: { ...process.env, ORBIT_MCP_URL: url, ORBIT_MCP_TOKEN: 't' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    await new Promise<void>((r) => {
      const t = setInterval(() => {
        if (out.includes('"id":1')) {
          clearInterval(t);
          r();
        }
      }, 10);
    });
    p.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    await new Promise((r) => p.on('close', r));
    const second = seen.find((s) => s.body.method === 'tools/list')!;
    expect(second.headers['mcp-session-id']).toBe('sess-1');
    expect(second.headers['mcp-protocol-version']).toBe('2025-06-18');
  });

  it('returns a JSON-RPC error when Orbit is unreachable', async () => {
    const r = await run([JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })], { ORBIT_MCP_URL: 'http://127.0.0.1:1/mcp', ORBIT_MCP_TOKEN: 'x' });
    expect(r.out[0].id).toBe(9);
    expect(r.out[0].error.message).toMatch(/Is Orbit running with AI access enabled\?/);
    expect(r.err).toMatch(/Cannot reach Orbit/);
  });
});
