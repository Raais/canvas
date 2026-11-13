import { forceSimulation, type Force, type SimulationNodeDatum } from 'd3-force';
import { attachmentPoint, effectiveBodyId } from './geometry';
import type { Board, BoardNode, Point } from './types';

export const TENSION = {
  stiffness: 0.045,
  tolerance: 0.75,
  maxLinkForce: 8,
  maxBodyForce: 14,
  maxSpeed: 18,
  velocityDecay: 0.4,
};

export type TensionBody = SimulationNodeDatum & {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
};

type TensionLink = {
  sourceId: string;
  targetId: string;
  restLength: number;
  sourceOffset: Point;
  targetOffset: Point;
};

export function tensionMagnitude(distance: number, restLength: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  const stretch = distance - restLength;
  if (stretch <= TENSION.tolerance) return 0;
  return Math.min(TENSION.maxLinkForce, TENSION.stiffness * stretch);
}

export function relaxBoard(board: Board, pinnedNodeIds: readonly string[], ticks: number): Board {
  const system = buildSystem(board, pinnedNodeIds);
  if (!system) return board;
  const simulation = forceSimulation(system.bodies)
    .force('tension', tensionForce(system.links))
    .velocityDecay(TENSION.velocityDecay)
    .alpha(1)
    .alphaDecay(0)
    .stop();
  for (let step = 0; step < ticks; step += 1) {
    simulation.tick();
    if (step > 2 && settled(system.bodies)) break;
  }
  return applyBodyPositions(board, system.bodies);
}

export function stepTension(bodies: readonly TensionBody[], links: readonly TensionLink[]): TensionBody[] {
  const next = bodies.map((body) => ({ ...body }));
  const force = tensionForce(links);
  force.initialize?.(next, Math.random);
  force(1);
  for (const body of next) {
    if (body.fx != null && body.fy != null) {
      body.x = body.fx;
      body.y = body.fy;
      body.vx = 0;
      body.vy = 0;
      continue;
    }
    body.vx *= 1 - TENSION.velocityDecay;
    body.vy *= 1 - TENSION.velocityDecay;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > TENSION.maxSpeed) {
      body.vx = (body.vx / speed) * TENSION.maxSpeed;
      body.vy = (body.vy / speed) * TENSION.maxSpeed;
    }
    body.x += body.vx;
    body.y += body.vy;
  }
  return next;
}

function tensionForce(links: readonly TensionLink[]): Force<TensionBody, undefined> {
  let nodes: TensionBody[] = [];
  const force = (alpha: number) => {
    const index = new Map(nodes.map((node) => [node.id, node]));
    const acc = new Map<string, Point>(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (const link of links) {
      const source = index.get(link.sourceId);
      const target = index.get(link.targetId);
      if (!source || !target) continue;
      const sx = source.x + link.sourceOffset.x;
      const sy = source.y + link.sourceOffset.y;
      const tx = target.x + link.targetOffset.x;
      const ty = target.y + link.targetOffset.y;
      const dx = tx - sx;
      const dy = ty - sy;
      const span = Math.hypot(dx, dy);
      const magnitude = tensionMagnitude(span, link.restLength);
      if (magnitude === 0) continue;
      const ux = dx / span;
      const uy = dy / span;
      const sourceForce = acc.get(source.id);
      const targetForce = acc.get(target.id);
      if (!sourceForce || !targetForce) continue;
      sourceForce.x += ux * magnitude;
      sourceForce.y += uy * magnitude;
      targetForce.x -= ux * magnitude;
      targetForce.y -= uy * magnitude;
    }
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;
      const raw = acc.get(node.id) ?? { x: 0, y: 0 };
      const capped = cap(raw, TENSION.maxBodyForce);
      node.vx = (node.vx ?? 0) + (capped.x / node.mass) * alpha;
      node.vy = (node.vy ?? 0) + (capped.y / node.mass) * alpha;
    }
  };
  force.initialize = (incoming: TensionBody[], _random: () => number) => {
    nodes = incoming;
  };
  return force;
}

function buildSystem(board: Board, pinnedNodeIds: readonly string[]): { bodies: TensionBody[]; links: TensionLink[] } | null {
  const allLinks = physicsLinks(board);
  if (allLinks.length === 0) return null;
  const pinned = new Set(
    pinnedNodeIds
      .map((id) => effectiveBodyId(board.nodes, id))
      .filter((id): id is string => Boolean(id)),
  );
  const seeds = pinned.size > 0 ? pinned : new Set(allLinks.flatMap((link) => [link.sourceId, link.targetId]));
  const component = componentOf(allLinks, seeds);
  const links = allLinks.filter((link) => component.has(link.sourceId) && component.has(link.targetId));
  if (links.length === 0) return null;
  const bodies = [...component].map((id) => bodyFrom(board, id, pinned.has(id)));
  return { bodies, links };
}

function physicsLinks(board: Board): TensionLink[] {
  const links: TensionLink[] = [];
  for (const edge of board.edges) {
    const sourceBody = effectiveBodyId(board.nodes, edge.sourceId);
    const targetBody = effectiveBodyId(board.nodes, edge.targetId);
    const source = board.nodes.find((node) => node.id === edge.sourceId);
    const target = board.nodes.find((node) => node.id === edge.targetId);
    const sourceBodyNode = sourceBody ? board.nodes.find((node) => node.id === sourceBody) : undefined;
    const targetBodyNode = targetBody ? board.nodes.find((node) => node.id === targetBody) : undefined;
    if (!sourceBody || !targetBody || sourceBody === targetBody || !source || !target || !sourceBodyNode || !targetBodyNode) {
      continue;
    }
    const sourcePoint = attachmentPoint(board.nodes, source, edge.sourceHandle);
    const targetPoint = attachmentPoint(board.nodes, target, edge.targetHandle);
    links.push({
      sourceId: sourceBody,
      targetId: targetBody,
      restLength: edge.restLength,
      sourceOffset: { x: sourcePoint.x - sourceBodyNode.x, y: sourcePoint.y - sourceBodyNode.y },
      targetOffset: { x: targetPoint.x - targetBodyNode.x, y: targetPoint.y - targetBodyNode.y },
    });
  }
  return links;
}

function componentOf(links: readonly TensionLink[], seeds: ReadonlySet<string>): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const link of links) {
    const left = adjacent.get(link.sourceId) ?? [];
    left.push(link.targetId);
    adjacent.set(link.sourceId, left);
    const right = adjacent.get(link.targetId) ?? [];
    right.push(link.sourceId);
    adjacent.set(link.targetId, right);
  }
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacent.get(id) ?? []) queue.push(next);
  }
  return seen;
}

function bodyFrom(board: Board, id: string, pinned: boolean): TensionBody {
  const node = board.nodes.find((entry) => entry.id === id);
  const x = node?.x ?? 0;
  const y = node?.y ?? 0;
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    mass: massOf(board.nodes, id),
    ...(pinned ? { fx: x, fy: y } : {}),
  };
}

function massOf(nodes: readonly BoardNode[], id: string): number {
  const node = nodes.find((entry) => entry.id === id);
  if (node?.kind !== 'group') return 1;
  const count = nodes.filter((entry) => entry.kind !== 'group' && entry.parentId === id).length;
  return Math.min(5, 1.25 + count * 0.2);
}

function applyBodyPositions(board: Board, bodies: readonly TensionBody[]): Board {
  const positions = new Map(bodies.map((body) => [body.id, body]));
  let changed = false;
  const nodes = board.nodes.map((node) => {
    const body = positions.get(node.id);
    if (!body || (body.x === node.x && body.y === node.y)) return node;
    changed = true;
    return { ...node, x: body.x, y: body.y };
  });
  if (!changed) return board;
  return { ...board, nodes };
}

function settled(bodies: readonly TensionBody[]): boolean {
  return bodies.every((body) => Math.hypot(body.vx, body.vy) < 0.05);
}

function cap(force: Point, limit: number): Point {
  const magnitude = Math.hypot(force.x, force.y);
  if (magnitude <= limit || magnitude === 0) return force;
  return { x: (force.x / magnitude) * limit, y: (force.y / magnitude) * limit };
}
