import type { JsonSchema } from './types';

/**
 * A small validator for the JSON Schema subset the tool schemas use:
 * type (string | string[]), enum, properties, required, additionalProperties: false, items, minItems, maxItems,
 * minLength, maxLength, pattern, minimum, maximum. Returns human-readable problems ("path: message").
 */
export function validateArgs(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  const errors: string[] = [];
  walk(schema, value, path, errors);
  return errors;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(t: string, v: unknown): boolean {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeOf(v) === t;
}

function walk(schema: JsonSchema, value: unknown, path: string, errors: string[]) {
  const type = schema.type as string | string[] | undefined;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((t) => matchesType(t, value))) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return;
    }
  }
  const en = schema.enum as unknown[] | undefined;
  if (en && !en.includes(value)) {
    errors.push(`${path}: must be one of ${en.map((x) => JSON.stringify(x)).join(', ')}`);
    return;
  }
  if (typeof value === 'string') {
    const min = schema.minLength as number | undefined;
    const max = schema.maxLength as number | undefined;
    const pat = schema.pattern as string | undefined;
    if (min !== undefined && value.length < min) errors.push(`${path}: must not be empty`);
    else if (pat && !new RegExp(pat).test(value)) errors.push(`${path}: must not be blank`);
    if (max !== undefined && value.length > max) errors.push(`${path}: must be at most ${max} characters`);
  }
  if (typeof value === 'number') {
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    if (min !== undefined && value < min) errors.push(`${path}: must be >= ${min}`);
    if (max !== undefined && value > max) errors.push(`${path}: must be <= ${max}`);
  }
  if (Array.isArray(value)) {
    const min = schema.minItems as number | undefined;
    const max = schema.maxItems as number | undefined;
    if (min !== undefined && value.length < min) errors.push(`${path}: needs at least ${min} item(s)`);
    if (max !== undefined && value.length > max) errors.push(`${path}: allows at most ${max} item(s)`);
    const items = schema.items as JsonSchema | undefined;
    if (items) value.forEach((v, i) => walk(items, v, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const r of (schema.required as string[] | undefined) ?? []) {
      if (!(r in obj) || obj[r] === undefined) errors.push(`${path}.${r}: required`);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      if (props[k]) walk(props[k], v, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: unknown property (allowed: ${Object.keys(props).join(', ') || 'none'})`);
    }
  }
}

// ── schema construction helpers ──
export const S = {
  str: (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', description, ...extra }),
  nonEmpty: (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', minLength: 1, pattern: '\\S', description, ...extra }),
  nullableStr: (description: string): JsonSchema => ({ type: ['string', 'null'], description }),
  bool: (description: string): JsonSchema => ({ type: 'boolean', description }),
  int: (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'integer', description, ...extra }),
  strList: (description: string): JsonSchema => ({ type: 'array', items: { type: 'string', minLength: 1 }, description }),
  oneOf: (values: string[], description: string): JsonSchema => ({ type: 'string', enum: values, description }),
  obj: (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }),
};
