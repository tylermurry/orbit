import type { Entity, OrbitContract, Relationship } from '@orbit/contract';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArchitectureGroup {
  id: string;
  name: string;
  box: Box;
  nodeIds: string[];
  kind: Entity['kind'];
}

export interface ArchitectureEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationships: Relationship[];
}

export interface ArchitectureScene {
  focusId: string | null;
  groups: ArchitectureGroup[];
  nodes: Map<string, { entity: Entity; box: Box }>;
  edges: ArchitectureEdge[];
  representatives: Map<string, string>;
  bounds: Box;
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1 };

export function projectArchitecture(scene: ArchitectureScene, size: { width: number; height: number }, camera: Camera) {
  const padding = 26;
  const fit = Math.min(1.16, (size.width - 2 * padding) / scene.bounds.width, (size.height - 2 * padding) / scene.bounds.height);
  const scale = Math.max(0.12, fit) * camera.scale;
  return (box: Box): Box => ({
    x: (box.x - scene.bounds.width / 2) * scale + size.width / 2 + camera.x,
    y: (box.y - scene.bounds.height / 2) * scale + size.height / 2 + camera.y,
    width: box.width * scale,
    height: box.height * scale,
  });
}

export function mixBoxes(a: Box, b: Box, progress: number): Box {
  const mix = (x: number, y: number) => x + (y - x) * progress;
  return {
    x: mix(a.x, b.x), y: mix(a.y, b.y),
    width: mix(a.width, b.width), height: mix(a.height, b.height),
  };
}

type Curve = [number, number, number, number, number, number, number, number];

export function drawArchitectureCurve(from: Curve, to: Curve = from, progress = 0) {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = from.map((value, i) => value + (to[i] - value) * progress);
  return {
    path: `M ${x1} ${y1} C ${x2} ${y2}, ${x3} ${y3}, ${x4} ${y4}`,
    labelX: (x1 + 3 * x2 + 3 * x3 + x4) / 8,
    labelY: (y1 + 3 * y2 + 3 * y3 + y4) / 8,
  };
}

export function architectureEdgeCurve(a: Box, b: Box, reverseEdge: boolean): Curve {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  if (a === b) {
    const right = a.x + a.width * 0.68;
    return [right, a.y, right + 24, a.y - 24, right + 44, a.y - 24, right + 28, a.y];
  }
  if (Math.abs(bx - ax) > (a.width + b.width) / 2) {
    const direction = Math.sign(bx - ax);
    const x1 = ax + direction * a.width / 2;
    const x2 = bx - direction * b.width / 2;
    const bend = (x2 - x1) * 0.45;
    const offset = reverseEdge ? direction * 8 : 0;
    return [x1, ay + offset, x1 + bend, ay + offset, x2 - bend, by + offset, x2, by + offset];
  }
  if (ax === bx && ay === by) return [ax, ay, ax, ay, ax, ay, ax, ay];
  if (Math.abs(by - ay) > Math.max(a.height, b.height) * 1.85) {
    const direction = reverseEdge && by < ay ? 1 : -1;
    const x1 = ax + direction * a.width / 2;
    const x2 = bx + direction * b.width / 2;
    const outside = (direction < 0 ? Math.min(x1, x2) : Math.max(x1, x2)) + direction * 32;
    return [x1, ay, outside, ay, outside, by, x2, by];
  }
  const direction = Math.sign(by - ay) || 1;
  const y1 = ay + direction * a.height / 2;
  const y2 = by - direction * b.height / 2;
  const bend = (y2 - y1) * 0.45;
  const offset = reverseEdge ? direction * 8 : 0;
  return [ax + offset, y1, ax + offset, y1 + bend, bx + offset, y2 - bend, bx + offset, y2];
}

const NODE_WIDTH = 232;
const NODE_HEIGHT = 54;
const GROUP_WIDTH = 272;
const COLUMN_GAP = 76;
const ROW_GAP = 26;

export function indexArchitecture(contract: OrbitContract) {
  const entities = new Map(contract.entities.map((entity) => [entity.id, entity]));
  const chains = new Map<string, string[]>();
  const parents = new Set<string>();
  for (const entity of entities.values()) {
    const chain = [entity.id];
    let parent = entity.parentId;
    while (parent && entities.has(parent) && !chain.includes(parent)) {
      chain.unshift(parent);
      parent = entities.get(parent)!.parentId;
    }
    chains.set(entity.id, chain);
    if (entity.parentId) parents.add(entity.parentId);
  }
  const relationships = contract.relationships.filter(({ sourceId, targetId }) =>
    entities.get(sourceId)?.kind === 'system' || entities.get(targetId)?.kind === 'system',
  );
  return { entities, chains, parents, relationships };
}

export function architectureScene(index: ReturnType<typeof indexArchitecture>, requestedFocus: string | null): ArchitectureScene {
  const { entities, chains, relationships } = index;
  const focus = requestedFocus ? entities.get(requestedFocus) : undefined;
  const inside = (id: string) => !!focus && !!chains.get(id)?.includes(focus.id);
  const representatives = new Map<string, string>();
  for (const [id, chain] of chains) {
    const representative = !focus ? chain[0] : inside(id) ? chain[chain.indexOf(focus.id) + 1] ?? id : id;
    representatives.set(id, representative);
  }

  const visible = new Set<string>();
  for (const entity of entities.values()) {
    if (focus ? entity.parentId === focus.id : entity.kind === 'system' && representatives.get(entity.id) === entity.id) {
      visible.add(entity.id);
    }
  }
  if (focus && visible.size === 0) visible.add(focus.id);
  const edges = new Map<string, ArchitectureEdge>();
  for (const relationship of relationships) {
    if (focus && !inside(relationship.sourceId) && !inside(relationship.targetId)) continue;
    const sourceId = representatives.get(relationship.sourceId);
    const targetId = representatives.get(relationship.targetId);
    if (!sourceId || !targetId || (sourceId === targetId && relationship.sourceId !== relationship.targetId)) continue;
    visible.add(sourceId);
    visible.add(targetId);
    const id = JSON.stringify([sourceId, targetId]);
    let edge = edges.get(id);
    if (!edge) {
      edge = { id, sourceId, targetId, relationships: [] };
      edges.set(id, edge);
    }
    edge.relationships.push(relationship);
  }

  const groupSpecs = new Map<string, Omit<ArchitectureGroup, 'box'> & { column: number }>();
  for (const entity of entities.values()) {
    if (!visible.has(entity.id)) continue;
    const rootId = chains.get(entity.id)![0];
    const inFocus = inside(entity.id);
    const heading = inFocus ? focus : focus ? entities.get(rootId) : undefined;
    const id = inFocus && focus ? `focus:${focus.id}` : heading ? `outside:${heading.id}` : entity.kind;
    const column = entity.kind === 'capability' ? 2 : inFocus ? 1 : 0;
    let group = groupSpecs.get(id);
    if (!group) {
      group = { id, column, name: heading?.name ?? (entity.kind === 'system' ? 'Systems' : 'Product'), nodeIds: [], kind: entity.kind };
      groupSpecs.set(id, group);
    }
    group.nodeIds.push(entity.id);
  }

  const nodes: ArchitectureScene['nodes'] = new Map();
  const groups: ArchitectureGroup[] = [];
  const columns = [...new Set([...groupSpecs.values()].map((group) => group.column))].sort();
  for (const [columnIndex, column] of columns.entries()) {
    const specs = [...groupSpecs.values()].filter((group) => group.column === column);
    const x = columnIndex * (GROUP_WIDTH + COLUMN_GAP);
    let y = 0;
    for (const group of specs) {
      const height = 64 + group.nodeIds.length * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
      groups.push({ ...group, box: { x, y, width: GROUP_WIDTH, height } });
      for (const [row, id] of group.nodeIds.entries()) {
        const box = { x: x + 20, y: y + 44 + row * (NODE_HEIGHT + ROW_GAP), width: NODE_WIDTH, height: NODE_HEIGHT };
        nodes.set(id, { entity: entities.get(id)!, box });
      }
      y += height + ROW_GAP;
    }
  }

  return {
    focusId: focus?.id ?? null, groups, nodes, edges: [...edges.values()], representatives,
    bounds: {
      x: 0, y: 0,
      width: Math.max(GROUP_WIDTH, columns.length * (GROUP_WIDTH + COLUMN_GAP) - COLUMN_GAP),
      height: Math.max(160, ...groups.map(({ box }) => box.y + box.height)),
    },
  };
}
