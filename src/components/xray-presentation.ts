import type { XrayEdgeRole, XrayNodeRole, XrayScene } from '../domain/xray';

type Classed = {
  id: string;
  className?: string;
};

const NODE_CLASS: Record<Exclude<XrayNodeRole, 'normal'>, string> = {
  match: 'xray-match',
  context: 'xray-context',
  structure: 'xray-structure',
  dimmed: 'xray-dim',
};

const EDGE_CLASS: Record<Exclude<XrayEdgeRole, 'normal'>, string> = {
  match: 'xray-edge-match',
  context: 'xray-edge-context',
  dimmed: 'xray-edge-dim',
};

export function createXrayPresentation<T extends Classed, E extends Classed>() {
  const nodes = new Map<string, { source: T; role: XrayNodeRole; presented: T }>();
  const edges = new Map<string, { source: E; role: XrayEdgeRole; presented: E }>();
  return {
    present(flowNodes: readonly T[], flowEdges: readonly E[], scene: XrayScene): { nodes: T[]; edges: E[] } {
      if (!scene.active) {
        nodes.clear();
        edges.clear();
        return { nodes: flowNodes as T[], edges: flowEdges as E[] };
      }
      return {
        nodes: flowNodes.map((node) => presentOne(nodes, node, scene.nodes.get(node.id) ?? 'dimmed', NODE_CLASS)),
        edges: flowEdges.map((edge) => presentOne(edges, edge, scene.edges.get(edge.id) ?? 'dimmed', EDGE_CLASS)),
      };
    },
  };
}

function presentOne<T extends Classed, Role extends string>(
  cache: Map<string, { source: T; role: Role; presented: T }>,
  source: T,
  role: Role,
  classes: Record<string, string>,
): T {
  const cached = cache.get(source.id);
  if (cached && cached.source === source && cached.role === role) return cached.presented;
  const token = classes[role] ?? null;
  const className = composeClass(source.className, token);
  const presented = className === source.className ? source : { ...source, className };
  cache.set(source.id, { source, role, presented });
  return presented;
}

function composeClass(className: string | undefined, token: string | null): string | undefined {
  const kept = (className ?? '').split(/\s+/).filter((entry) => entry && !entry.startsWith('xray-'));
  if (token) kept.push(token);
  return kept.length > 0 ? kept.join(' ') : undefined;
}
