// Pure edit operations on a contract. Each operation takes the current contract and validated arguments and returns
// a new (immutable) contract plus a human summary. Operations throw ToolError for reference/rule violations.
// They are used both by the individual write tools and by apply_edits (one accumulator, one undo step).
import { allIds, behaviorIndex, generateId, referencesTo, removeEntity, removeTest, wouldCreateCycle } from '@orbit/contract';
import type { Behavior, Entity, EntityKind, OrbitContract, Relationship, RelationshipType, TestDefinition } from '@orbit/contract';
import { RELATIONSHIP_TYPES } from '@orbit/contract';
import { REL_INFO } from '../../lib/model';
import { behaviorCandidates, clip, closest, entityCandidates, notFound, relationshipCandidates, testCandidates } from './helpers';
import { S } from './schema';
import { ToolError } from './types';
import type { JsonSchema } from './types';

export interface OpEnv {
  headCommit?: string;
  now: () => Date;
}

export interface OpResult {
  contract: OrbitContract;
  summary: string;
  /** Operation-specific payload merged into the tool result. */
  result?: Record<string, unknown>;
  warnings?: string[];
  /** Entities whose ancestors should be expanded in the tree so the change is visible. */
  reveal?: string[];
}

export interface OpDef {
  name: string;
  title: string;
  description: string;
  schema: JsonSchema;
  destructive: boolean;
  idempotent: boolean;
  run(c: OrbitContract, args: Record<string, unknown>, env: OpEnv): OpResult;
}

function op<A>(def: Omit<OpDef, 'run'> & { run: (c: OrbitContract, a: A, env: OpEnv) => OpResult }): OpDef {
  return def as unknown as OpDef;
}

const ID_PREFIX: Record<EntityKind, string> = { capability: 'cap', system: 'sys' };
const trim = (s: string) => s.trim();
const has = (a: object, k: string) => Object.prototype.hasOwnProperty.call(a, k) && (a as Record<string, unknown>)[k] !== undefined;
const q = (s: string) => `'${clip(s, 70)}'`;

function needAny(a: object, fields: string[], what: string) {
  if (!fields.some((f) => has(a, f))) throw new ToolError(`Nothing to update: provide at least one of ${fields.join(', ')} for ${what}.`);
}

function getEntity(c: OrbitContract, id: string): Entity {
  const e = c.entities.find((x) => x.id === id);
  if (!e) throw notFound('Entity', id, entityCandidates(c));
  return e;
}

function getBehavior(c: OrbitContract, id: string) {
  const hit = behaviorIndex(c).get(id);
  if (!hit) throw notFound('Behavior', id, behaviorCandidates(c));
  return hit;
}

function checkTestIds(c: OrbitContract, ids: string[]): string[] {
  const known = new Set(c.tests.map((t) => t.id));
  const unknown = ids.filter((t) => !known.has(t));
  if (unknown.length) {
    const near = closest(unknown[0], testCandidates(c));
    throw new ToolError(
      `Unknown test id${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `'${u}'`).join(', ')}. Behaviors may only reference tests defined in the contract.${near.length ? ` Closest existing: ${near.map((t) => `'${t.id}'`).join(', ')}.` : ''}`,
      {
        suggestions: ['Create the test first with create_test (or earlier in the same apply_edits batch), then map it.', ...near.slice(0, 3).map((t) => t.id)],
        data: { unknownTestIds: unknown },
      },
    );
  }
  return [...new Set(ids)];
}

function checkParent(c: OrbitContract, kind: EntityKind, parentId: string, selfId?: string): Entity {
  const p = getEntity(c, parentId);
  if (p.kind !== kind) {
    throw new ToolError(`'${parentId}' is a ${p.kind}; a ${kind} can only be nested under a ${kind}.`, {
      suggestions: [`Choose a ${kind} as parent (list_entities with kind: '${kind}'), or use parentId: null for a top-level ${kind}.`],
    });
  }
  if (selfId && (parentId === selfId || wouldCreateCycle(c, selfId, parentId))) {
    throw new ToolError(`Moving '${selfId}' under '${parentId}' would create a cycle in the hierarchy (an entity cannot be inside itself or its own descendants).`, {
      suggestions: ['Pick a parent that is not a descendant of the entity (get_entity shows its children).'],
    });
  }
  return p;
}

const idProp = (what: string) => S.nonEmpty(`Optional stable id for the new ${what}. Omit to auto-generate from the name. Ids can never change afterwards.`);

// ───────────────────────────── product ─────────────────────────────

interface UpdateProductArgs { id?: string; name?: string; summary?: string; description?: string | null }

export const OPS: OpDef[] = [
  op<UpdateProductArgs>({
    name: 'update_product',
    title: 'Update product',
    description:
      "Change the product's own metadata (id, name, summary, description). Only the fields you pass change. Pass description: null (or empty) to remove the description. Changing the product id does not affect entity ids.",
    schema: S.obj({ id: S.nonEmpty('New product id.'), name: S.nonEmpty('Product name.'), summary: S.nonEmpty('One-line summary.'), description: S.nullableStr('Longer description; null or empty removes it.') }),
    destructive: false,
    idempotent: true,
    run(c, a) {
      needAny(a, ['id', 'name', 'summary', 'description'], 'the product');
      const p = { ...c.product };
      if (a.id !== undefined) p.id = trim(a.id);
      if (a.name !== undefined) p.name = trim(a.name);
      if (a.summary !== undefined) p.summary = trim(a.summary);
      if (a.description !== undefined) {
        const d = a.description === null ? '' : trim(a.description);
        if (d) p.description = d;
        else delete p.description;
      }
      return { contract: { ...c, product: p }, summary: `Updated product ${q(p.name)}`, result: { product: p } };
    },
  }),

  // ───────────────────────────── entities ─────────────────────────────

  op<{ kind: EntityKind; name: string; summary: string; description?: string; parentId?: string | null; id?: string }>({
    name: 'create_entity',
    title: 'Create capability or system',
    description:
      "Create a capability (something a user can do) or a system (an internal component that supports capabilities). parentId nests it under an existing entity of the SAME kind (omit/null for top level). Ids are auto-generated as 'cap.<slug>' / 'sys.<slug>' from the name unless you pass id; ids are permanent. Behaviors are added afterwards with create_behavior.",
    schema: S.obj(
      {
        kind: S.oneOf(['capability', 'system'], 'capability = user-facing ability; system = internal component.'),
        name: S.nonEmpty('Display name, e.g. "Custom Lists".'),
        summary: S.nonEmpty('One line describing it.'),
        description: S.str('Optional longer description (markdown-free prose).'),
        parentId: S.nullableStr('Id of an existing entity of the same kind to nest under; null/omitted = top level.'),
        id: idProp('entity'),
      },
      ['kind', 'name', 'summary'],
    ),
    destructive: false,
    idempotent: false,
    run(c, a) {
      const ids = allIds(c);
      const name = trim(a.name);
      const id = a.id ? trim(a.id) : generateId(ID_PREFIX[a.kind], ids.entities, name);
      if (ids.entities.has(id)) throw new ToolError(`An entity with id '${id}' already exists.`, { suggestions: ['Omit id to auto-generate a unique one, or use update_entity to change the existing entity.'] });
      if (a.parentId) checkParent(c, a.kind, a.parentId);
      const entity: Entity = { id, kind: a.kind, parentId: a.parentId ?? null, name, summary: trim(a.summary), description: a.description ? trim(a.description) : '', behaviors: [] };
      return { contract: { ...c, entities: [...c.entities, entity] }, summary: `Created ${a.kind} ${q(name)}`, result: { entity: { id, kind: a.kind, name, parentId: entity.parentId } }, reveal: entity.parentId ? [entity.parentId] : [] };
    },
  }),

  op<{ id: string; name?: string; summary?: string; description?: string; parentId?: string | null }>({
    name: 'update_entity',
    title: 'Update capability or system',
    description:
      'Change name, summary, description and/or parent of an existing entity (ids never change). Reparenting (parentId) must keep the same kind and must not create a cycle; parentId: null moves it to the top level. Behaviors and relationships stay attached.',
    schema: S.obj(
      { id: S.nonEmpty('Entity id to update.'), name: S.nonEmpty('New name.'), summary: S.nonEmpty('New summary.'), description: S.str('New description (empty string clears it).'), parentId: S.nullableStr('New parent id (same kind) or null for top level.') },
      ['id'],
    ),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const e = getEntity(c, a.id);
      needAny(a, ['name', 'summary', 'description', 'parentId'], `entity '${a.id}'`);
      if (a.parentId) checkParent(c, e.kind, a.parentId, e.id);
      const next: Entity = {
        ...e,
        ...(a.name !== undefined ? { name: trim(a.name) } : {}),
        ...(a.summary !== undefined ? { summary: trim(a.summary) } : {}),
        ...(a.description !== undefined ? { description: trim(a.description) } : {}),
        ...(a.parentId !== undefined ? { parentId: a.parentId } : {}),
      };
      const moved = a.parentId !== undefined && a.parentId !== e.parentId;
      return {
        contract: { ...c, entities: c.entities.map((x) => (x.id === e.id ? next : x)) },
        summary: moved && a.name === undefined ? `Moved ${e.kind} ${q(next.name)}` : `Updated ${e.kind} ${q(next.name)}`,
        result: { entity: { id: next.id, kind: next.kind, name: next.name, summary: next.summary, parentId: next.parentId } },
        reveal: moved && next.parentId ? [next.parentId] : [],
      };
    },
  }),

  op<{ id: string; children?: 'reparent' | 'block' }>({
    name: 'delete_entity',
    title: 'Delete capability or system',
    description:
      "Delete an entity together with its behaviors and every relationship that points to or from it. Child entities are moved up to the entity's parent (children: 'reparent', default) or the delete is refused when it has children (children: 'block'). Tests are never deleted. The result lists the implications (what else was removed) - the same list the UI's confirmation dialog shows. Undoable; use dryRun: true to preview.",
    schema: S.obj({ id: S.nonEmpty('Entity id to delete.'), children: S.oneOf(['reparent', 'block'], "'reparent' (default) moves children to the grandparent; 'block' refuses if there are children.") }, ['id']),
    destructive: true,
    idempotent: true,
    run(c, a) {
      const e = getEntity(c, a.id);
      const implications = referencesTo(c, 'entity', e.id);
      const kids = c.entities.filter((x) => x.parentId === e.id).map((x) => x.id);
      const rels = c.relationships.filter((r) => r.sourceId === e.id || r.targetId === e.id).map((r) => r.id);
      let next: OrbitContract;
      try {
        next = removeEntity(c, e.id, { children: a.children === 'block' ? 'block' : 'reparent-to-grandparent' });
      } catch (err) {
        throw new ToolError((err as Error).message, { suggestions: ["Delete or move the children first, or use children: 'reparent' to move them up to the parent."], data: { children: kids } });
      }
      return {
        contract: next,
        summary: `Deleted ${e.kind} ${q(e.name)}`,
        result: { deleted: { id: e.id, name: e.name, kind: e.kind }, implications, deletedBehaviors: e.behaviors.map((b) => b.id), removedRelationships: rels, reparentedChildren: kids.map((id) => ({ id, newParentId: e.parentId })) },
      };
    },
  }),

  // ───────────────────────────── behaviors ─────────────────────────────

  op<{ entityId: string; name: string; expected: string; testIds?: string[]; id?: string }>({
    name: 'create_behavior',
    title: 'Create behavior',
    description:
      "Add a behavior (a verifiable guarantee, 'expected' = what must be true) to a capability or system. testIds optionally maps existing tests (must exist; create them with create_test first). Id defaults to 'behavior.<entity-slug>.<name-slug>' and is globally unique and permanent.",
    schema: S.obj(
      { entityId: S.nonEmpty('Owning entity id.'), name: S.nonEmpty('Short behavior name, e.g. "Overdue items remain visible".'), expected: S.nonEmpty('Precise statement of the expected outcome.'), testIds: S.strList('Ids of existing tests that verify it.'), id: idProp('behavior') },
      ['entityId', 'name', 'expected'],
    ),
    destructive: false,
    idempotent: false,
    run(c, a) {
      const owner = getEntity(c, a.entityId);
      const ids = allIds(c);
      const slug = owner.id.replace(/^(cap|sys)\./, '');
      const name = trim(a.name);
      const id = a.id ? trim(a.id) : generateId(`behavior.${slug}`, ids.behaviors, name);
      if (ids.behaviors.has(id)) throw new ToolError(`A behavior with id '${id}' already exists (behavior ids are unique across the whole contract).`, { suggestions: ['Omit id to auto-generate one, or use update_behavior.'] });
      const b: Behavior = { id, name, expected: trim(a.expected), testIds: checkTestIds(c, a.testIds ?? []) };
      return {
        contract: { ...c, entities: c.entities.map((e) => (e.id === owner.id ? { ...e, behaviors: [...e.behaviors, b] } : e)) },
        summary: `Created behavior ${q(name)}`,
        result: { behavior: { ...b, entityId: owner.id } },
        reveal: [owner.id],
      };
    },
  }),

  op<{ id: string; name?: string; expected?: string; testIds?: string[]; entityId?: string }>({
    name: 'update_behavior',
    title: 'Update behavior',
    description:
      'Change a behavior: name, expected outcome, the full list of mapped tests (testIds REPLACES the list; use map_tests/unmap_tests to add/remove), and/or move it to another owning entity (entityId). Only passed fields change; the id is permanent.',
    schema: S.obj(
      { id: S.nonEmpty('Behavior id.'), name: S.nonEmpty('New name.'), expected: S.nonEmpty('New expected outcome.'), testIds: S.strList('Replacement list of mapped test ids.'), entityId: S.nonEmpty('Move the behavior to this entity.') },
      ['id'],
    ),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const { behavior, entity } = getBehavior(c, a.id);
      needAny(a, ['name', 'expected', 'testIds', 'entityId'], `behavior '${a.id}'`);
      const nb: Behavior = {
        ...behavior,
        ...(a.name !== undefined ? { name: trim(a.name) } : {}),
        ...(a.expected !== undefined ? { expected: trim(a.expected) } : {}),
        ...(a.testIds !== undefined ? { testIds: checkTestIds(c, a.testIds) } : {}),
      };
      const target = a.entityId !== undefined ? getEntity(c, a.entityId) : entity;
      const moved = target.id !== entity.id;
      const entities = c.entities.map((e) => {
        if (moved && e.id === entity.id) return { ...e, behaviors: e.behaviors.filter((b) => b.id !== behavior.id) };
        if (moved && e.id === target.id) return { ...e, behaviors: [...e.behaviors, nb] };
        if (!moved && e.id === entity.id) return { ...e, behaviors: e.behaviors.map((b) => (b.id === behavior.id ? nb : b)) };
        return e;
      });
      return {
        contract: { ...c, entities },
        summary: moved ? `Moved behavior ${q(nb.name)} to ${q(target.name)}` : `Updated behavior ${q(nb.name)}`,
        result: { behavior: { ...nb, entityId: target.id } },
        reveal: [target.id],
      };
    },
  }),

  op<{ id: string }>({
    name: 'delete_behavior',
    title: 'Delete behavior',
    description: 'Delete a behavior from its owning entity. Tests mapped to it remain defined in the contract (they just stop verifying this behavior). Undoable.',
    schema: S.obj({ id: S.nonEmpty('Behavior id.') }, ['id']),
    destructive: true,
    idempotent: true,
    run(c, a) {
      const { behavior, entity } = getBehavior(c, a.id);
      return {
        contract: { ...c, entities: c.entities.map((e) => (e.id === entity.id ? { ...e, behaviors: e.behaviors.filter((b) => b.id !== behavior.id) } : e)) },
        summary: `Deleted behavior ${q(behavior.name)}`,
        result: { deleted: { id: behavior.id, name: behavior.name, entityId: entity.id }, unmappedTestIds: behavior.testIds },
      };
    },
  }),

  op<{ behaviorId: string; testIds: string[] }>({
    name: 'map_tests',
    title: 'Map tests to a behavior',
    description: 'Add tests (by id, must exist) to a behavior. Already-mapped ids are ignored. Mapping a test does not run it (run_tests does).',
    schema: S.obj({ behaviorId: S.nonEmpty('Behavior id.'), testIds: { ...S.strList('Test ids to add.'), minItems: 1 } }, ['behaviorId', 'testIds']),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const { behavior, entity } = getBehavior(c, a.behaviorId);
      const add = checkTestIds(c, a.testIds);
      const added = add.filter((t) => !behavior.testIds.includes(t));
      const nb = { ...behavior, testIds: [...behavior.testIds, ...added] };
      return {
        contract: { ...c, entities: c.entities.map((e) => (e.id === entity.id ? { ...e, behaviors: e.behaviors.map((b) => (b.id === nb.id ? nb : b)) } : e)) },
        summary: added.length ? `Mapped ${added.length} test${added.length === 1 ? '' : 's'} to behavior ${q(behavior.name)}` : `Behavior ${q(behavior.name)} already maps those tests`,
        result: { behaviorId: nb.id, testIds: nb.testIds, added },
        warnings: added.length < add.length ? [`Already mapped, ignored: ${add.filter((t) => !added.includes(t)).join(', ')}`] : [],
        reveal: [entity.id],
      };
    },
  }),

  op<{ behaviorId: string; testIds: string[] }>({
    name: 'unmap_tests',
    title: 'Unmap tests from a behavior',
    description: 'Remove tests from a behavior (the tests stay in the contract). Ids that are not mapped are ignored with a warning.',
    schema: S.obj({ behaviorId: S.nonEmpty('Behavior id.'), testIds: { ...S.strList('Test ids to remove.'), minItems: 1 } }, ['behaviorId', 'testIds']),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const { behavior, entity } = getBehavior(c, a.behaviorId);
      const removed = a.testIds.filter((t) => behavior.testIds.includes(t));
      const nb = { ...behavior, testIds: behavior.testIds.filter((t) => !a.testIds.includes(t)) };
      return {
        contract: { ...c, entities: c.entities.map((e) => (e.id === entity.id ? { ...e, behaviors: e.behaviors.map((b) => (b.id === nb.id ? nb : b)) } : e)) },
        summary: removed.length ? `Unmapped ${removed.length} test${removed.length === 1 ? '' : 's'} from behavior ${q(behavior.name)}` : `No matching tests were mapped to ${q(behavior.name)}`,
        result: { behaviorId: nb.id, testIds: nb.testIds, removed },
        warnings: removed.length < a.testIds.length ? [`Not mapped, ignored: ${a.testIds.filter((t) => !removed.includes(t)).join(', ')}`] : [],
        reveal: [entity.id],
      };
    },
  }),

  // ───────────────────────────── tests ─────────────────────────────

  op<{ name: string; location: string; id?: string }>({
    name: 'create_test',
    title: 'Create test definition',
    description: "Register a test so behaviors can reference it. When used in a plan, set location to the intended path and title. The plan comparison labels new tests Planned.",
    schema: S.obj({ name: S.nonEmpty('Human-readable test name.'), location: S.nonEmpty('File path and test title.'), id: idProp('test') }, ['name', 'location']),
    destructive: false,
    idempotent: false,
    run(c, a) {
      const ids = allIds(c);
      const id = a.id ? trim(a.id) : generateId('test', ids.tests, a.name);
      if (ids.tests.has(id)) throw new ToolError(`A test with id '${id}' already exists.`, { suggestions: ['Omit id to auto-generate one, or use update_test.'] });
      const t: TestDefinition = { id, name: trim(a.name), location: trim(a.location) };
      return { contract: { ...c, tests: [...c.tests, t] }, summary: `Created test ${q(t.name)}`, result: { test: t } };
    },
  }),

  op<{ id: string; name?: string; location?: string; placeholder?: boolean }>({
    name: 'update_test',
    title: 'Update test definition',
    description: "Change a test definition's name, location and/or placeholder flag (the id is permanent). placeholder: false clears a legacy placeholder when the test exists. Mappings and evidence stay attached.",
    schema: S.obj({ id: S.nonEmpty('Test id.'), name: S.nonEmpty('New name.'), location: S.nonEmpty('New location.'), placeholder: { type: 'boolean', enum: [false], description: 'Clear a legacy placeholder.' } }, ['id']),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const t = c.tests.find((x) => x.id === a.id);
      if (!t) throw notFound('Test', a.id, testCandidates(c));
      needAny(a, ['name', 'location', 'placeholder'], `test '${a.id}'`);
      const nt: TestDefinition = { ...t, ...(a.name !== undefined ? { name: trim(a.name) } : {}), ...(a.location !== undefined ? { location: trim(a.location) } : {}) };
      if (a.placeholder === false) delete nt.placeholder;
      return { contract: { ...c, tests: c.tests.map((x) => (x.id === t.id ? nt : x)) }, summary: `Updated test ${q(nt.name)}`, result: { test: nt } };
    },
  }),

  op<{ id: string }>({
    name: 'delete_test',
    title: 'Delete test definition',
    description: "Delete a test definition and unmap it from every behavior - exactly what the UI's delete does. The result lists those implications. Undoable; use dryRun: true to preview.",
    schema: S.obj({ id: S.nonEmpty('Test id.') }, ['id']),
    destructive: true,
    idempotent: true,
    run(c, a) {
      const t = c.tests.find((x) => x.id === a.id);
      if (!t) throw notFound('Test', a.id, testCandidates(c));
      const implications = referencesTo(c, 'test', t.id);
      return {
        contract: removeTest(c, t.id, { unmap: true }),
        summary: `Deleted test ${q(t.name)}`,
        result: { deleted: t, implications },
      };
    },
  }),

  // ───────────────────────────── validation ─────────────────────────────

  op<{ command?: string | null; results?: string }>({
    name: 'set_validation',
    title: 'Set how tests are run',
    description:
      "Set the command that runs the ENTIRE test suite (run from the repository root, or the contract's folder outside git) and the folder of JUnit XML files it writes, normally 'reports' (relative to the same folder). Orbit reads test status from that file, matching each test by its location: '<file> › <describe> › <test title>' as the runner reports it. command: null removes the validation setup. Saved in the contract; a person must approve a new or changed command before it runs.",
    schema: S.obj({ command: S.nullableStr("Shell command, e.g. 'npm test'; null to remove the setup."), results: S.nonEmpty("Results folder (default 'reports'; every *.xml file in it is read) or a single XML file.") }),
    destructive: false,
    idempotent: true,
    run(c, a) {
      if (a.command === null) {
        if (!c.validation) throw new ToolError('No validation setup to remove.');
        const next = { ...c };
        delete next.validation;
        return { contract: next, summary: 'Removed the test setup', result: { validation: null } };
      }
      const command = a.command !== undefined ? trim(a.command) : c.validation?.command;
      const results = a.results !== undefined ? trim(a.results) : c.validation?.results;
      if (!command || !results) throw new ToolError('Both a command and a results file are needed.', { suggestions: ["set_validation({ command: 'npm test', results: 'reports' })"] });
      const validation = { command, results };
      return { contract: { ...c, validation }, summary: `Set the test command to ${q(command)}`, result: { validation } };
    },
  }),

  // ───────────────────────────── relationships ─────────────────────────────

  op<{ type: RelationshipType; sourceId: string; targetId: string; description?: string; id?: string }>({
    name: 'create_relationship',
    title: 'Create relationship',
    description:
      "Add a directed relationship source -> target. Types: dependsOn (source relies on the target's promised functionality), uses (source utilizes the target as a supporting system/capability), implementedBy (source capability is supported by the target system). Impact flows backwards: if the target changes, the source is potentially affected. Self-edges are refused. If an identical relationship (same type/source/target) already exists, nothing is created and the existing one is returned with a warning.",
    schema: S.obj(
      { type: S.oneOf([...RELATIONSHIP_TYPES], 'Relationship type.'), sourceId: S.nonEmpty('Source entity id (the one that depends/uses/is implemented).'), targetId: S.nonEmpty('Target entity id.'), description: S.str('Why this relationship exists (optional but valuable).'), id: idProp('relationship') },
      ['type', 'sourceId', 'targetId'],
    ),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const src = getEntity(c, a.sourceId);
      const tgt = getEntity(c, a.targetId);
      if (src.id === tgt.id) throw new ToolError(`A relationship cannot point from an entity to itself ('${src.id}').`, { suggestions: ['Choose a different targetId.'] });
      const dup = c.relationships.find((r) => r.type === a.type && r.sourceId === src.id && r.targetId === tgt.id);
      if (dup) return { contract: c, summary: `Relationship already exists: ${src.name} ${REL_INFO[a.type].verb} ${tgt.name}`, result: { relationship: dup, created: false }, warnings: [`Duplicate: relationship '${dup.id}' already has the same type, source and target; nothing was created. Use update_relationship to change its description.`] };
      const ids = allIds(c);
      const id = a.id ? trim(a.id) : generateId('rel', ids.relationships, `${src.name} ${a.type} ${tgt.name}`);
      if (ids.relationships.has(id)) throw new ToolError(`A relationship with id '${id}' already exists.`, { suggestions: ['Omit id to auto-generate one.'] });
      const desc = a.description ? trim(a.description) : '';
      const r: Relationship = { id, type: a.type, sourceId: src.id, targetId: tgt.id, ...(desc ? { description: desc } : {}) };
      const warnings: string[] = [];
      if (a.type === 'implementedBy' && (src.kind !== 'capability' || tgt.kind !== 'system')) warnings.push("implementedBy normally points from a capability to a system.");
      return { contract: { ...c, relationships: [...c.relationships, r] }, summary: `Created relationship: ${src.name} ${REL_INFO[a.type].verb} ${tgt.name}`, result: { relationship: r, created: true }, warnings };
    },
  }),

  op<{ id: string; type?: RelationshipType; sourceId?: string; targetId?: string; description?: string | null }>({
    name: 'update_relationship',
    title: 'Update relationship',
    description: 'Change the type, endpoints and/or description of a relationship. description: null (or empty) removes it. Self-edges and exact duplicates of another relationship are refused.',
    schema: S.obj(
      { id: S.nonEmpty('Relationship id.'), type: S.oneOf([...RELATIONSHIP_TYPES], 'New type.'), sourceId: S.nonEmpty('New source entity id.'), targetId: S.nonEmpty('New target entity id.'), description: S.nullableStr('New description; null removes.') },
      ['id'],
    ),
    destructive: false,
    idempotent: true,
    run(c, a) {
      const r = c.relationships.find((x) => x.id === a.id);
      if (!r) throw notFound('Relationship', a.id, relationshipCandidates(c));
      needAny(a, ['type', 'sourceId', 'targetId', 'description'], `relationship '${a.id}'`);
      const type = a.type ?? r.type;
      const src = getEntity(c, a.sourceId ?? r.sourceId);
      const tgt = getEntity(c, a.targetId ?? r.targetId);
      if (src.id === tgt.id) throw new ToolError(`A relationship cannot point from an entity to itself ('${src.id}').`);
      const dup = c.relationships.find((x) => x.id !== r.id && x.type === type && x.sourceId === src.id && x.targetId === tgt.id);
      if (dup) throw new ToolError(`This would duplicate relationship '${dup.id}' (same type, source and target).`, { suggestions: [`Delete one of them with delete_relationship, or change a different field.`] });
      const desc = a.description === undefined ? r.description : a.description === null ? '' : trim(a.description);
      const next: Relationship = { id: r.id, type, sourceId: src.id, targetId: tgt.id, ...(desc ? { description: desc } : {}) };
      return { contract: { ...c, relationships: c.relationships.map((x) => (x.id === r.id ? next : x)) }, summary: `Updated relationship: ${src.name} ${REL_INFO[type].verb} ${tgt.name}`, result: { relationship: next } };
    },
  }),

  op<{ id: string }>({
    name: 'delete_relationship',
    title: 'Delete relationship',
    description: 'Delete a relationship. Undoable.',
    schema: S.obj({ id: S.nonEmpty('Relationship id.') }, ['id']),
    destructive: true,
    idempotent: true,
    run(c, a) {
      const r = c.relationships.find((x) => x.id === a.id);
      if (!r) throw notFound('Relationship', a.id, relationshipCandidates(c));
      const nm = (id: string) => c.entities.find((e) => e.id === id)?.name ?? id;
      return { contract: { ...c, relationships: c.relationships.filter((x) => x.id !== r.id) }, summary: `Deleted relationship: ${nm(r.sourceId)} ${REL_INFO[r.type].verb} ${nm(r.targetId)}`, result: { deleted: r } };
    },
  }),
];

export const OPS_BY_NAME = new Map(OPS.map((o) => [o.name, o]));
