export type XrayNodeRole = 'match' | 'context' | 'structure' | 'dimmed' | 'normal';

export type XrayEdgeRole = 'match' | 'context' | 'dimmed' | 'normal';

export type XrayNodeRef = {
  id: string;
  parentId?: string;
};

export type XrayEdgeRef = {
  id: string;
  sourceId: string;
  targetId: string;
};

export type XrayScene = {
  active: boolean;
  matchCount: number;
  nodes: ReadonlyMap<string, XrayNodeRole>;
  edges: ReadonlyMap<string, XrayEdgeRole>;
};

export type XrayLens = {
  enabled: false;
  showConnections: false;
  query: '';
};

const IDLE_SCENE: XrayScene = {
  active: false,
  matchCount: 0,
  nodes: new Map(),
  edges: new Map(),
};

export function xrayLensActive(enabled: boolean, query: string, notice: string | null, ready: boolean): boolean {
  return enabled && ready && query.trim().length > 0 && notice == null;
}

export function xrayQueryLabel(query: string, limit = 28): string {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1)}…`;
}

export function clearedXrayLens(): XrayLens {
  return { enabled: false, showConnections: false, query: '' };
}

export function classifyXray(input: {
  nodes: readonly XrayNodeRef[];
  edges: readonly XrayEdgeRef[];
  matchIds: readonly string[];
  enabled: boolean;
  showConnections: boolean;
  active: boolean;
}): XrayScene {
  if (!input.enabled || !input.active) return IDLE_SCENE;
  const parentOf = new Map<string, string | undefined>();
  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    nodeIds.add(node.id);
    parentOf.set(node.id, node.parentId);
  }
  const matches = new Set<string>();
  for (const id of input.matchIds) {
    if (nodeIds.has(id)) matches.add(id);
  }
  const context = new Set<string>();
  if (input.showConnections) {
    for (const edge of input.edges) {
      const sourceMatch = matches.has(edge.sourceId);
      const targetMatch = matches.has(edge.targetId);
      if (sourceMatch && !targetMatch && nodeIds.has(edge.targetId)) context.add(edge.targetId);
      if (targetMatch && !sourceMatch && nodeIds.has(edge.sourceId)) context.add(edge.sourceId);
    }
  }
  const structure = new Set<string>();
  const walked = new Set<string>();
  for (const id of matches) {
    let parentId = parentOf.get(id);
    while (parentId && !walked.has(parentId)) {
      walked.add(parentId);
      if (!matches.has(parentId) && !context.has(parentId) && nodeIds.has(parentId)) structure.add(parentId);
      parentId = parentOf.get(parentId);
    }
  }
  const nodes = new Map<string, XrayNodeRole>();
  for (const node of input.nodes) {
    if (matches.has(node.id)) nodes.set(node.id, 'match');
    else if (context.has(node.id)) nodes.set(node.id, 'context');
    else if (structure.has(node.id)) nodes.set(node.id, 'structure');
    else nodes.set(node.id, 'dimmed');
  }
  const edges = new Map<string, XrayEdgeRole>();
  for (const edge of input.edges) {
    const sourceMatch = matches.has(edge.sourceId);
    const targetMatch = matches.has(edge.targetId);
    if (sourceMatch && targetMatch) {
      edges.set(edge.id, 'match');
      continue;
    }
    const linkedContext = input.showConnections && ((sourceMatch && context.has(edge.targetId)) || (targetMatch && context.has(edge.sourceId)));
    edges.set(edge.id, linkedContext ? 'context' : 'dimmed');
  }
  return { active: true, matchCount: matches.size, nodes, edges };
}
