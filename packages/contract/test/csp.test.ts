// Regression guard: Orbit's desktop webview runs under a strict Content-Security-Policy without 'unsafe-eval'.
// Validation must never generate code at runtime (e.g. Ajv's ajv.compile → new Function).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('validation works without runtime code generation (strict CSP)', () => {
  const RealFunction = globalThis.Function;
  const realEval = globalThis.eval;
  beforeAll(() => {
    const blocked = new Proxy(RealFunction, {
      construct() {
        throw new EvalError('CSP: new Function is blocked');
      },
      apply() {
        throw new EvalError('CSP: Function() is blocked');
      },
    });
    globalThis.Function = blocked as FunctionConstructor;
    globalThis.eval = (() => {
      throw new EvalError('CSP: eval is blocked');
    }) as typeof eval;
  });
  afterAll(() => {
    globalThis.Function = RealFunction;
    globalThis.eval = realEval;
  });

  it('parses and validates the Tasky fixture and the invalid fixture', async () => {
    const { parseContract } = await import('../src/index.js');
    const ok = parseContract(readFileSync(new URL('../../../examples/tasky.orbit.json', import.meta.url), 'utf8'));
    expect(ok.ok).toBe(true);
    const bad = parseContract(readFileSync(new URL('../../../examples/invalid.orbit.json', import.meta.url), 'utf8'));
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.code.startsWith('schema.'))).toBe(true);
  });
});
