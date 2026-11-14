import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { Eye, EyeOff } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addNodes,
  commitInteraction,
  createEmptyBoard,
  createEmbeddedImageNode,
  createExternalImageNode,
  createTextNode,
  noteImageIntrinsic,
  placeNode,
  referencedAssetIds,
  renameBoard,
  setImageMode,
  setAppearance,
  setBackgroundPattern,
  setGroupBackgroundTone,
  setCodeLanguage,
  setCornerStyle,
  setNoteTone,
  setPresentation,
  setViewport,
  upgradeAtlasRenderer,
  toggleImageFlip,
  staggeredPositions,
  updateText,
} from '../domain/board';
import { contentExtent, facingHandles, isContentNode, normalizeRect, worldTopLeft } from '../domain/geometry';
import { toggleTaskAt } from '../domain/markdown';
import { gesturePhase, sameSelection } from '../editor/interaction';
import { plainShortcutBlocked, searchShortcut } from '../editor/shortcuts';
import { connectNodes, deleteEdges, hasUndirectedLink } from '../domain/graph';
import { cameraDuration, frameViewport, noteJumpZoom } from '../domain/camera';
import { setEdgeLabel, setEdgeStyle } from '../domain/relationships';
import { editSavedView, recallViewport } from '../domain/saved-views';
import { buildSearchIndex, centerOf, resultBounds, searchNodes } from '../domain/search';
import { decodeGraphClipboard, encodeGraphClipboard, GRAPH_CLIPBOARD_LIMIT, GRAPH_MIME, looksLikeGraphClipboard, pasteGraph, selectionClosure } from '../domain/graph-clipboard';
import {
  createTextInside,
  deleteGroupContents,
  deleteSelection,
  detachNodes,
  duplicateSelection,
  expandGroup,
  groupFrame,
  groupSelection,
  moveTargets,
  moveToGroup,
  renameGroup,
  restoreGroupLabels,
  ungroup,
} from '../domain/groups';
import { createHistory, pushHistory, redoHistory, retainedAssetIds, undoHistory, type History } from '../domain/history';
import { relaxBoard } from '../domain/physics';
import {
  GROUP_MIN_HEIGHT,
  GROUP_MIN_WIDTH,
  GROUP_PAD,
  type AssetRecord,
  type Board,
  type BoardNode,
  type HandleSide,
  type ImageNode,
  type Point,
  type Rect,
} from '../domain/types';
import { partitionIncoming } from '../ingest/admission';
import { ingestClipboard, ingestFileList, type PreparedItem } from '../ingest/browser';
import { captureClipboardData } from '../ingest/clipboard';
import { archiveFilename } from '../archive/format';
import { buildArchive, readArchive } from '../archive/zip';
import { downloadBytes } from '../project/download';
import { boardSnapshotKey, logicalUsage, snapshotAssets, type LogicalUsage } from '../project/storage';
import { releaseWriteLock, retainWriteLock } from '../project/ownership';
import { openBoardChannel, type BoardChannel } from '../project/tabs';
import { createAssetRecord, replaceStoredBoard, RevisionConflictError, type CanvasDatabase } from '../persistence/db';
import { createObjectUrlRegistry, type ObjectUrlRegistry } from '../persistence/object-urls';
import { errorMessage, SaveQueue, type SaveStatus } from '../persistence/save-queue';
import { canonicalViewportUpdate } from '../project/viewport-write';
import { BoardActionsProvider, type BoardActions } from './board-context';
import { edgeTypes } from './RelationshipEdge';
import { SavedViewsPanel } from './SavedViewsPanel';
import { SearchPalette } from './SearchPalette';
import { Coordinates, type CoordinatesHandle } from './Coordinates';
import { GroupNode, type GroupFlowNode } from './GroupNode';
import { ImageNoteNode, type ImageFlowNode } from './ImageNoteNode';
import { SelectionBar } from './SelectionBar';
import { TextNoteNode, type TextFlowNode } from './TextNoteNode';
import { AtlasBoundary } from '../backgrounds/AtlasBoundary';
import { AtlasTuningPanel } from '../backgrounds/AtlasTuningPanel';
import { ATLAS_LAB_ENABLED, clampAtlasTuning, defaultsForAtlasVersion, effectiveAtlasTuning, storedAtlasVersion, type AtlasPreview, type AtlasTuning } from '../backgrounds/atlas-tuning';
import { ProjectMenu } from './ProjectMenu';

const DitherAtlasLayer = lazy(() => import('../backgrounds/DitherAtlasLayer'));
import { Toolbar } from './Toolbar';

type CanvasFlowNode = TextFlowNode | ImageFlowNode | GroupFlowNode;
type Tool = 'select' | 'frame';

const nodeTypes = {
  text: TextNoteNode,
  image: ImageNoteNode,
  group: GroupNode,
};

const DEFAULT_EDGE_OPTIONS = { interactionWidth: 18 };

type SessionProps = {
  database: CanvasDatabase;
  board: Board;
  assets: AssetRecord[];
};

export function BoardView({ session }: { session: SessionProps }) {
  return (
    <ReactFlowProvider>
      <BoardSurface session={session} />
    </ReactFlowProvider>
  );
}

function BoardSurface({ session }: { session: SessionProps }) {
  const flow = useReactFlow();
  const { screenToFlowPosition } = flow;
  const [board, setBoard] = useState(session.board);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [notice, setNotice] = useState<{ text: string; source: 'save' | 'ingest' } | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [urlEpoch, setUrlEpoch] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<Rect | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [usage, setUsage] = useState<LogicalUsage | null>(null);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewsOpen, setViewsOpen] = useState(false);
  const [historyStamp, setHistoryStamp] = useState(0);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [atlasBlocked, setAtlasBlocked] = useState(false);
  const atlasVersion = storedAtlasVersion(board.ditherAtlas?.rendererVersion);
  const [atlasTuning, setAtlasTuning] = useState<AtlasTuning>(() => defaultsForAtlasVersion(storedAtlasVersion(session.board.ditherAtlas?.rendererVersion)));
  const [atlasPreview, setAtlasPreview] = useState<AtlasPreview>('experimental');
  const [atlasLabOpen, setAtlasLabOpen] = useState(false);
  const blockAtlas = useCallback(() => setAtlasBlocked(true), []);
  const activeAtlasTuning = effectiveAtlasTuning(atlasPreview, atlasTuning, atlasVersion);
  useEffect(() => {
    const version = storedAtlasVersion(board.ditherAtlas?.rendererVersion);
    setAtlasTuning(defaultsForAtlasVersion(version));
    setAtlasPreview('experimental');
    setAtlasLabOpen(false);
  }, [board.id]);
  const [confirming, setConfirming] = useState<
    | null
    | { kind: 'blank' | 'clear' | 'exported-clear' }
    | { kind: 'export'; thenClear: boolean; summary: string; unsaved: boolean }
    | { kind: 'import'; summary: string; board: Board; assets: AssetRecord[] }
    | { kind: 'delete-contents'; groupId: string; label: string; count: number }
    | { kind: 'reload' }
  >(null);

  const boardRef = useRef(session.board);
  const selectedRef = useRef<string[]>([]);
  const selectedEdgeRef = useRef<string[]>([]);
  const editingRef = useRef<string | null>(null);
  const pointerRef = useRef<Point | null>(null);
  const dragDepth = useRef(0);
  const initialViewport = useRef(session.board.viewport);
  const toWorldRef = useRef(screenToFlowPosition);
  const flowRef = useRef(flow);
  const gestureRef = useRef<Board | null>(null);
  const textBefore = useRef<Board | null>(null);
  const renameBefore = useRef<Board | null>(null);
  const historyRef = useRef<History>(createHistory());
  const libraryRef = useRef(new Map<string, AssetRecord>());
  const toolRef = useRef<Tool>('select');
  const frameRef = useRef<Point | null>(null);
  const coordinatesRef = useRef<CoordinatesHandle>(null);
  const channelRef = useRef<BoardChannel | null>(null);
  const blockedRef = useRef(true);
  const searchOpenRef = useRef(false);
  const viewsOpenRef = useRef(false);
  const edgeEditorRef = useRef(false);
  const confirmingRef = useRef(false);
  searchOpenRef.current = searchOpen;
  viewsOpenRef.current = viewsOpen;
  confirmingRef.current = confirming !== null;
  const writerRef = useRef(false);
  const overlayRef = useRef(false);
  overlayRef.current = projectOpen || confirming !== null || searchOpen || viewsOpen;
  const foreignRef = useRef(false);
  const exportHold = useRef<{ board: Board; assets: AssetRecord[]; unsaved: boolean; key: string } | null>(null);
  const pasteRepeat = useRef({ key: '', count: 0 });
  const boardEl = useRef<HTMLDivElement>(null);
  const flowCache = useRef<{ nodeKey: string; nodes: CanvasFlowNode[]; edgeKey: string; edges: Edge[] }>({
    nodeKey: '',
    nodes: [],
    edgeKey: '',
    edges: [],
  });
  toWorldRef.current = screenToFlowPosition;
  flowRef.current = flow;
  toolRef.current = tool;

  const libraryReady = useRef(false);
  if (!libraryReady.current) {
    for (const asset of session.assets) libraryRef.current.set(asset.id, asset);
    libraryReady.current = true;
  }

  const registryRef = useRef<ObjectUrlRegistry | null>(null);
  if (!registryRef.current) {
    const registry = createObjectUrlRegistry();
    for (const asset of session.assets) registry.remember(asset);
    registryRef.current = registry;
  }

  const queueRef = useRef<SaveQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new SaveQueue(
      session.database,
      () => boardRef.current,
      (next, message) => {
        setStatus((current) => (current === next ? current : next));
        if (next === 'error' && message) setNotice({ text: message, source: 'save' });
        if (next === 'saved') setNotice((current) => (current?.source === 'save' ? null : current));
      },
      (saved) => channelRef.current?.announce(saved.id, saved.revision),
    );
    queueRef.current.adopt(session.board);
  }
  const queue = queueRef.current;

  useEffect(() => {
    const registry = registryRef.current;
    if (!registry) return;
    for (const asset of session.assets) {
      libraryRef.current.set(asset.id, asset);
      registry.remember(asset);
    }
    setUrlEpoch((value) => value + 1);
    return () => registry.revokeAll();
  }, [session.assets]);

  function replaceBoard(next: Board) {
    boardRef.current = next;
    setBoard(next);
  }

  function replaceSelection(ids: string[]) {
    if (sameSelection(ids, selectedRef.current)) return;
    selectedRef.current = ids;
    setSelectedIds(ids);
  }

  function replaceEdgeSelection(ids: string[]) {
    if (sameSelection(ids, selectedEdgeRef.current)) return;
    selectedEdgeRef.current = ids;
    setSelectedEdgeIds(ids);
  }

  function onEdgesChange(changes: EdgeChange[]) {
    if (blockedRef.current) return;
    let selection = selectedEdgeRef.current;
    let changed = false;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      const set = new Set(selection);
      if (change.selected) set.add(change.id);
      else set.delete(change.id);
      selection = [...set];
      changed = true;
    }
    if (changed) replaceEdgeSelection(selection);
  }

  function liveAssetIds(value: Board): Set<string> {
    const ids = new Set<string>();
    for (const node of value.nodes) {
      if (node.kind === 'image' && node.source.type === 'embedded') ids.add(node.source.assetId);
    }
    return ids;
  }

  function reconcile(previous: Board, next: Board) {
    const before = liveAssetIds(previous);
    const after = liveAssetIds(next);
    const keep = retainedAssetIds(next, historyRef.current);
    for (const id of before) {
      if (!after.has(id)) queue.removeAssets([id]);
    }
    for (const id of after) {
      if (before.has(id)) continue;
      const asset = libraryRef.current.get(id);
      if (!asset) continue;
      registryRef.current?.remember(asset);
      queue.addAssets([asset]);
    }
    for (const id of [...libraryRef.current.keys()]) {
      if (keep.has(id)) continue;
      libraryRef.current.delete(id);
      registryRef.current?.revoke(id);
      queue.removeAssets([id]);
    }
  }

  function publish(next: Board, before: Board | null, mode: 'save' | 'schedule' | 'live') {
    if (blockedRef.current) return;
    if (before) historyRef.current = pushHistory(historyRef.current, before);
    if (before) setHistoryStamp((value) => value + 1);
    const previous = boardRef.current;
    replaceBoard(next);
    reconcile(previous, next);
    if (mode === 'save') queue.saveNow();
    else if (mode === 'schedule') queue.schedule(500);
    else queue.markUnsaved();
  }

  function viewportCenter(): Point {
    const pane = document.querySelector('.react-flow__pane');
    if (!(pane instanceof HTMLElement)) {
      return toWorldRef.current({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
    const rect = pane.getBoundingClientRect();
    return toWorldRef.current({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  function showWarnings(warnings: string[]) {
    if (warnings.length === 0) return;
    setNotice({ text: warnings.join(' '), source: 'ingest' });
  }

  async function placeItems(items: PreparedItem[], origin: Point) {
    if (blockedRef.current || items.length === 0) return;
    const registry = registryRef.current;
    if (!registry) return;
    const referenced = referencedAssetIds(boardRef.current);
    let imageKey = 0;
    const incoming = items.flatMap((item) => item.type === 'image' ? [{ key: String(imageKey++), name: 'image', bytes: item.blob.size }] : []);
    const decision = partitionIncoming({
      board: boardRef.current,
      existingBytes: [...referenced].reduce((sum, id) => sum + (libraryRef.current.get(id)?.byteSize ?? 0), 0),
      existingCount: referenced.size,
      incoming,
    });
    if (decision.warnings.length > 0) showWarnings(decision.warnings);
    const allowed = new Set(decision.accepted);
    let seenImage = 0;
    const acceptedItems = items.filter((item) => {
      if (item.type !== 'image') return true;
      const key = String(seenImage++);
      return allowed.has(key);
    });
    if (acceptedItems.length === 0) return;
    const positions = staggeredPositions(origin, acceptedItems.length);
    const nodes: BoardNode[] = [];
    acceptedItems.forEach((item, index) => {
      const center = positions[index] ?? origin;
      if (item.type === 'text') {
        nodes.push(createTextNode(center, item.text));
        return;
      }
      if (item.type === 'external-image') {
        nodes.push(
          createExternalImageNode({
            center,
            url: item.url,
            intrinsicWidth: item.intrinsicWidth,
            intrinsicHeight: item.intrinsicHeight,
            sizedFromImage: item.sizedFromImage,
          }),
        );
        return;
      }
      const asset = createAssetRecord(item.blob, item.mimeType);
      libraryRef.current.set(asset.id, asset);
      registry.remember(asset);
      nodes.push(
        createEmbeddedImageNode({
          center,
          assetId: asset.id,
          intrinsicWidth: item.intrinsicWidth,
          intrinsicHeight: item.intrinsicHeight,
        }),
      );
    });
    const before = boardRef.current;
    const only = nodes.length === 1 ? nodes[0] : undefined;
    publish(addNodes(before, nodes), before, 'save');
    replaceSelection(nodes.map((node) => node.id));
    if (only?.kind === 'text') {
      editingRef.current = only.id;
      textBefore.current = structuredClone(boardRef.current);
      setEditingId(only.id);
    }
    setUrlEpoch((value) => value + 1);
  }

  const placeItemsRef = useRef(placeItems);
  placeItemsRef.current = placeItems;
  const showWarningsRef = useRef(showWarnings);
  showWarningsRef.current = showWarnings;
  const viewportCenterRef = useRef(viewportCenter);
  viewportCenterRef.current = viewportCenter;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = board.appearance;
    const zoom = boardRef.current.viewport.zoom || 1;
    boardEl.current?.style.setProperty('--handle-scale', String(1 / zoom));
  }, [board.appearance]);

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (editingRef.current || blockedRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const payload = selectionClosure(boardRef.current, selectedRef.current);
      if (!payload) return;
      const encoded = encodeGraphClipboard(payload);
      if (encoded.length > GRAPH_CLIPBOARD_LIMIT) {
        setNotice({ text: 'That selection is too large to copy.', source: 'ingest' });
        return;
      }
      event.clipboardData?.setData('text/plain', encoded);
      event.clipboardData?.setData(GRAPH_MIME, encoded);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editingRef.current || blockedRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const data = event.clipboardData;
      if (!data) return;
      const encoded = data.getData(GRAPH_MIME) || data.getData('text/plain');
      if (looksLikeGraphClipboard(encoded)) {
        const graph = decodeGraphClipboard(encoded);
        if (!graph) {
          event.preventDefault();
          setNotice({ text: 'The copied canvas selection is invalid or too large to paste.', source: 'ingest' });
          return;
        }
        event.preventDefault();
        const repeat = pasteRepeat.current.key === encoded ? pasteRepeat.current.count + 1 : 0;
        pasteRepeat.current = { key: encoded, count: repeat };
        const origin = pointerRef.current ?? viewportCenterRef.current();
        const result = pasteGraph(boardRef.current, graph, origin, new Set(libraryRef.current.keys()), repeat);
        if ('error' in result) {
          setNotice({ text: result.error, source: 'ingest' });
          return;
        }
        const previous = new Set(boardRef.current.nodes.map((node) => node.id));
        publish(result, boardRef.current, 'save');
        replaceSelection(result.nodes.filter((node) => !previous.has(node.id) && (node.kind === 'group' || !node.parentId)).map((node) => node.id));
        return;
      }
      const snapshot = captureClipboardData(data);
      event.preventDefault();
      const origin = pointerRef.current ?? viewportCenterRef.current();
      void ingestClipboard(snapshot, 'clipboard')
        .then((bundle) => {
          showWarningsRef.current(bundle.warnings);
          return placeItemsRef.current(bundle.items, origin);
        })
        .catch((error: unknown) => {
          setNotice({ text: errorMessage(error), source: 'ingest' });
        });
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  function groupSelected() {
    const before = boardRef.current;
    const result = groupSelection(before, selectedRef.current);
    if ('error' in result) {
      setNotice({ text: result.error, source: 'ingest' });
      return;
    }
    publish(result.board, before, 'save');
    const created = result.board.nodes.find((node) => !before.nodes.some((entry) => entry.id === node.id));
    if (created) replaceSelection([created.id]);
  }

  function ungroupSelected() {
    const groups = boardRef.current.nodes.filter((node) => node.kind === 'group' && selectedRef.current.includes(node.id));
    if (groups.length === 0) return;
    const before = boardRef.current;
    const next = ungroup(before, groups.map((node) => node.id));
    publish(next, before, 'save');
    replaceSelection(groups.flatMap((group) => next.nodes.filter((node) => isContentNode(node) && !node.parentId && before.nodes.some((entry) => entry.id === node.id && entry.kind !== 'group' && entry.parentId === group.id)).map((node) => node.id)));
  }

  function duplicateSelected() {
    const before = boardRef.current;
    const next = duplicateSelection(before, selectedRef.current);
    if (next === before) return;
    publish(next, before, 'save');
    const previous = new Set(before.nodes.map((node) => node.id));
    replaceSelection(next.nodes.filter((node) => !previous.has(node.id) && (node.kind === 'group' || !node.parentId)).map((node) => node.id));
  }

  function restoreHistory(direction: 'undo' | 'redo') {
    if (blockedRef.current) return;
    const current = boardRef.current;
    const result = direction === 'undo' ? undoHistory(historyRef.current, current) : redoHistory(historyRef.current, current);
    if (!result) return;
    historyRef.current = result.history;
    setHistoryStamp((value) => value + 1);
    replaceBoard(result.board);
    reconcile(current, result.board);
    queue.saveNow();
    setUrlEpoch((value) => value + 1);
  }

  function linkSelection(): boolean {
    if (blockedRef.current || editingRef.current) return false;
    const ids = selectedRef.current;
    if (ids.length !== 2) return false;
    const sourceId = ids[0];
    const targetId = ids[1];
    if (!sourceId || !targetId) return false;
    const current = boardRef.current;
    const handles = facingHandles(current.nodes, sourceId, targetId);
    if (!handles) return false;
    const next = connectNodes(current, sourceId, targetId, handles.source, handles.target);
    if (!next) return false;
    publish(next, current, 'save');
    return true;
  }

  function editSelection(): boolean {
    if (blockedRef.current || editingRef.current) return false;
    if (selectedRef.current.length !== 1) return false;
    const id = selectedRef.current[0];
    if (!id) return false;
    const node = boardRef.current.nodes.find((entry) => entry.id === id);
    if (!node || node.kind !== 'text') return false;
    textBefore.current = structuredClone(boardRef.current);
    editingRef.current = id;
    setEditingId(id);
    return true;
  }

  const commands = useRef({
    undo: () => restoreHistory('undo'),
    redo: () => restoreHistory('redo'),
    group: groupSelected,
    ungroup: ungroupSelected,
    duplicate: duplicateSelected,
    link: linkSelection,
    edit: editSelection,
  });
  commands.current = {
    undo: () => restoreHistory('undo'),
    redo: () => restoreHistory('redo'),
    group: groupSelected,
    ungroup: ungroupSelected,
    duplicate: duplicateSelected,
    link: linkSelection,
    edit: editSelection,
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      const editingField = Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
      if (searchShortcut({
        key: event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        composing: event.isComposing,
        repeat: event.repeat,
        editingField,
        confirming: confirmingRef.current,
        editing: editingRef.current !== null,
      })) {
        event.preventDefault();
        setViewsOpen(false);
        setSearchOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape' && searchOpenRef.current) {
        setSearchOpen(false);
        return;
      }
      if (event.key === 'Escape' && viewsOpenRef.current && !editingField) {
        setViewsOpen(false);
        return;
      }
      if (editingField) return;
      if (event.key === 'Escape') {
        frameRef.current = null;
        setDraft(null);
        setTool('select');
        return;
      }
      const plainBlocked = plainShortcutBlocked({
        defaultPrevented: event.defaultPrevented,
        composing: event.isComposing,
        repeat: event.repeat,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        tag: element?.tagName ?? null,
        editable: element?.isContentEditable ?? false,
        inOverlay: overlayRef.current || edgeEditorRef.current || Boolean(element?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')),
        editing: editingRef.current !== null,
        blocked: blockedRef.current,
      });
      if (!plainBlocked && (event.key === 'l' || event.key === 'L')) {
        if (commands.current.link()) event.preventDefault();
        return;
      }
      if (!plainBlocked && event.key === 'Enter') {
        if (commands.current.edit()) event.preventDefault();
        return;
      }
      if (blockedRef.current) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        commands.current.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        commands.current.redo();
      } else if (key === 'g' && event.shiftKey) {
        event.preventDefault();
        commands.current.ungroup();
      } else if (key === 'g') {
        event.preventDefault();
        commands.current.group();
      } else if (key === 'd') {
        event.preventDefault();
        commands.current.duplicate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const actions = useMemo<BoardActions>(
    () => ({
      beginEditing(id) {
        if (blockedRef.current) return;
        textBefore.current = structuredClone(boardRef.current);
        editingRef.current = id;
        setEditingId(id);
        selectedRef.current = [id];
        setSelectedIds([id]);
      },
      updateText(id, text) {
        if (blockedRef.current) return;
        const next = updateText(boardRef.current, id, text);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.schedule(500);
      },
      endEditing() {
        const before = textBefore.current;
        textBefore.current = null;
        if (editingRef.current === null && !before) return;
        editingRef.current = null;
        setEditingId(null);
        if (before && JSON.stringify(before.nodes) !== JSON.stringify(boardRef.current.nodes)) {
          historyRef.current = pushHistory(historyRef.current, before);
        }
        queue.saveNow();
      },
      setMode(id, mode) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setImageMode(before, id, mode);
        if (next === before) return;
        publish(next, before, 'save');
      },
      noteIntrinsicSize(id, width, height) {
        if (blockedRef.current) return;
        const next = noteImageIntrinsic(boardRef.current, id, width, height);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.saveNow();
      },
      setPresentation(id, presentation) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setPresentation(before, id, presentation);
        if (next === before) return;
        publish(next, before, 'save');
      },
      setNoteTone(id, kind, tone) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setNoteTone(before, id, kind === 'text' ? 'text' : 'background', tone as 'default');
        if (next === before) return;
        publish(next, before, 'save');
      },
      setCodeLanguage(id, language) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setCodeLanguage(before, id, language as 'auto');
        if (next === before) return;
        publish(next, before, 'save');
      },
      toggleTask(id, index) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const node = before.nodes.find((entry) => entry.id === id);
        if (!node || node.kind !== 'text') return;
        const text = toggleTaskAt(node.text, index);
        if (text === node.text) return;
        publish(updateText(before, id, text), before, 'save');
      },
      setGroupTone(id, tone) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setGroupBackgroundTone(before, id, tone as 'default');
        if (next === before) return;
        publish(next, before, 'save');
      },
      setCornerStyle(id, style) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setCornerStyle(before, id, style);
        if (next === before) return;
        publish(next, before, 'save');
      },
      toggleFlip(id, axis) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = toggleImageFlip(before, id, axis);
        if (next === before) return;
        publish(next, before, 'save');
      },
      renameGroup(id, label) {
        if (blockedRef.current) return;
        if (!renameBefore.current) renameBefore.current = structuredClone(boardRef.current);
        const next = renameGroup(boardRef.current, id, label);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.schedule(500);
      },
      endRename() {
        const before = renameBefore.current;
        renameBefore.current = null;
        if (!before) return;
        if (JSON.stringify(before.nodes) !== JSON.stringify(boardRef.current.nodes)) {
          historyRef.current = pushHistory(historyRef.current, before);
        }
        queue.saveNow();
      },
      cancelRename() {
        const before = renameBefore.current;
        renameBefore.current = null;
        if (!before) return;
        const next = restoreGroupLabels(boardRef.current, before);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.schedule(300);
      },
      createNoteIn(groupId) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const note = createTextNode({ x: 0, y: 0 });
        const next = createTextInside(before, groupId, note);
        if (next === before) return;
        publish(next, before, 'save');
        replaceSelection([note.id]);
        textBefore.current = structuredClone(boardRef.current);
        editingRef.current = note.id;
        setEditingId(note.id);
      },
      requestDeleteContents(groupId) {
        if (blockedRef.current) return;
        const group = boardRef.current.nodes.find((node) => node.id === groupId && node.kind === 'group');
        if (!group || group.kind !== 'group') return;
        const count = boardRef.current.nodes.filter((node) => node.kind !== 'group' && node.parentId === groupId).length;
        setConfirming({ kind: 'delete-contents', groupId, label: group.label || 'Group', count });
      },
      deleteContents(groupId) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = deleteGroupContents(before, groupId);
        if (next === before) return;
        publish(next, before, 'save');
        replaceSelection([]);
        setUrlEpoch((value) => value + 1);
      },
      commitEdgeLabel(id, label) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setEdgeLabel(before, id, label);
        if (!next || next === before) return;
        publish(next, before, 'save');
      },
      setRelationshipStyle(id, style) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = setEdgeStyle(before, id, style);
        if (!next || next === before) return;
        publish(next, before, 'save');
      },
      deleteRelationship(id) {
        if (blockedRef.current) return;
        const before = boardRef.current;
        const next = deleteEdges(before, [id]);
        if (next === before) return;
        publish(next, before, 'save');
        replaceEdgeSelection(selectedEdgeRef.current.filter((edgeId) => edgeId !== id));
      },
      setEdgeEditor(open) {
        edgeEditorRef.current = open;
      },
    }),
    [queue],
  );

  useEffect(() => {
    if (chromeHidden) setViewsOpen(false);
  }, [chromeHidden]);

  const searchIndex = useMemo(() => buildSearchIndex(board.nodes), [board.nodes]);
  const searchResults = useMemo(() => searchNodes(searchIndex, searchQuery), [searchIndex, searchQuery]);

  function closeSearch() {
    setSearchOpen(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.search-palette')) active.blur();
  }

  function jumpToNode(id: string) {
    const bounds = resultBounds(boardRef.current.nodes, id);
    const node = boardRef.current.nodes.find((entry) => entry.id === id);
    if (!bounds || !node) return;
    const duration = cameraDuration(250);
    if (node.kind === 'group') {
      const pane = document.querySelector('.react-flow');
      const width = pane instanceof HTMLElement ? pane.clientWidth : window.innerWidth;
      const height = pane instanceof HTMLElement ? pane.clientHeight : window.innerHeight;
      void flowRef.current.setViewport(frameViewport(bounds, width, height), { duration });
    }
    else {
      const center = centerOf(bounds);
      void flowRef.current.setCenter(center.x, center.y, { zoom: noteJumpZoom(flowRef.current.getViewport().zoom), duration });
    }
    replaceSelection([id]);
    replaceEdgeSelection([]);
    closeSearch();
  }

  function commitMetadata(next: Board | null) {
    if (!next || next === boardRef.current || blockedRef.current) return;
    replaceBoard(next);
    queue.saveNow();
  }

  function saveCurrentView(name: string) {
    commitMetadata(editSavedView(blockedRef.current, boardRef.current, { type: 'add', name, viewport: flowRef.current.getViewport() }));
  }

  function recallSavedView(view: Board['savedViews'][number]) {
    void flowRef.current.setViewport(recallViewport(view), { duration: cameraDuration(300) });
  }

  const nodes = useMemo(() => {
    const ordered = [...board.nodes].sort((left, right) => Number(left.kind !== 'group') - Number(right.kind !== 'group'));
    const projected = ordered.map((node) => toFlowNode(node, board.nodes, selectedIds.includes(node.id), editingId === node.id, registryRef.current));
    const nodeKey = JSON.stringify(projected.map((node) => [node.id, node.position, node.width, node.height, node.selected, node.parentId, node.data, node.draggable]));
    if (nodeKey === flowCache.current.nodeKey) return flowCache.current.nodes;
    flowCache.current = { ...flowCache.current, nodeKey, nodes: projected };
    return projected;
  }, [board.nodes, editingId, selectedIds, urlEpoch]);

  const edges = useMemo<Edge[]>(() => {
    const solo = selectedEdgeIds.length === 1;
    const projected = board.edges.map((edge) => ({
      id: edge.id,
      type: 'relationship',
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      selected: selectedEdgeIds.includes(edge.id),
      interactionWidth: 18,
      className: edge.style === 'dashed' ? 'relationship-dashed' : edge.style === 'red-string' ? 'relationship-string' : undefined,
      data: { label: edge.label, style: edge.style, solo },
    }));
    const edgeKey = JSON.stringify(projected);
    if (edgeKey === flowCache.current.edgeKey) return flowCache.current.edges;
    flowCache.current = { ...flowCache.current, edgeKey, edges: projected };
    return projected;
  }, [board.edges, selectedEdgeIds]);

  function onNodesChange(changes: NodeChange<CanvasFlowNode>[]) {
    if (blockedRef.current) return;
    const draggingParents = new Set(
      changes.flatMap((change) =>
        change.type === 'position' && change.dragging && boardRef.current.nodes.some((node) => node.id === change.id && node.kind === 'group')
          ? [change.id]
          : [],
      ),
    );
    let geometry = boardRef.current;
    let sawDrag = false;
    let dragFinished = false;
    let resizeActive = false;
    let resizeFinished = false;
    let barePosition = false;
    const pinned: string[] = [];
    let selection = selectedRef.current;
    let selectionChanged = false;

    for (const change of changes) {
      if (change.type === 'select') {
        const set = new Set(selection);
        if (change.selected) set.add(change.id);
        else set.delete(change.id);
        selection = [...set];
        selectionChanged = true;
        continue;
      }
      if (change.type !== 'position' && change.type !== 'dimensions') continue;
      const current = geometry.nodes.find((node) => node.id === change.id);
      if (!current) continue;
      if (isContentNode(current) && current.parentId && draggingParents.has(current.parentId)) continue;
      if (change.type === 'position' && change.position) {
        const next = placeNode(geometry, change.id, { x: change.position.x, y: change.position.y });
        geometry = isContentNode(current) && current.parentId ? expandGroup(next, current.parentId) : next;
        if (change.dragging === true) {
          sawDrag = true;
          pinned.push(change.id);
        } else if (change.dragging === false) {
          dragFinished = true;
          pinned.push(change.id);
        } else barePosition = true;
      } else if (change.type === 'dimensions' && change.dimensions && change.resizing !== undefined) {
        const next = placeNode(geometry, change.id, {
          width: change.dimensions.width,
          height: change.dimensions.height,
          lockImageSize: true,
        });
        geometry = isContentNode(current) && current.parentId ? expandGroup(next, current.parentId) : next;
        if (change.resizing) resizeActive = true;
        else resizeFinished = true;
      }
      if (geometry !== boardRef.current && !gestureRef.current && (sawDrag || dragFinished || resizeActive || resizeFinished || barePosition)) {
        gestureRef.current = structuredClone(boardRef.current);
      }
    }

    if (sawDrag && !document.hidden) geometry = relaxBoard(geometry, pinned, 4);
    if (dragFinished && !document.hidden) geometry = relaxBoard(geometry, pinned, 40);
    const phase = gesturePhase({
      sawDrag,
      dragFinished,
      resizeActive,
      resizeFinished,
      barePosition,
      changed: geometry !== boardRef.current,
      tracking: gestureRef.current !== null,
    });
    if (phase === 'commit') {
      const before = gestureRef.current;
      gestureRef.current = null;
      if (before) publish(commitInteraction(geometry), before, 'save');
    } else if (phase === 'live') {
      replaceBoard(geometry);
      if (sawDrag || resizeActive) queue.markUnsaved();
    }
    if (selectionChanged) replaceSelection(selection);
  }

  function createNote(origin: Point) {
    if (blockedRef.current) return;
    const before = boardRef.current;
    const node = createTextNode(origin);
    publish(addNodes(before, [node]), before, 'save');
    replaceSelection([node.id]);
    textBefore.current = structuredClone(boardRef.current);
    editingRef.current = node.id;
    setEditingId(node.id);
  }

  function finishFrame(point: Point) {
    const start = frameRef.current;
    frameRef.current = null;
    setDraft(null);
    setTool('select');
    if (!start || blockedRef.current) return;
    const rect = normalizeRect(start, point);
    const before = boardRef.current;
    const result = groupFrame(before, rect);
    if ('error' in result) {
      setNotice({ text: result.error, source: 'ingest' });
      return;
    }
    publish(result.board, before, 'save');
    const created = result.board.nodes.find((node) => node.kind === 'group' && !before.nodes.some((entry) => entry.id === node.id));
    if (created) replaceSelection([created.id]);
  }

  useEffect(() => {
    const openedAt = Date.now();
    const tabId = crypto.randomUUID();
    let alive = true;
    const locksAuthoritative = typeof navigator !== 'undefined' && Boolean(navigator.locks);
    const becomeReader = (text: string) => {
      foreignRef.current = true;
      blockedRef.current = true;
      writerRef.current = false;
      queue.pauseForConflict();
      editingRef.current = null;
      setEditingId(null);
      setReadOnly(true);
      setNotice({ text, source: 'save' });
    };
    void retainWriteLock().then((claim) => {
      if (!alive) return;
      if (claim === 'denied') {
        becomeReader('This board is open in another tab. Reload before editing so this tab does not overwrite it.');
        return;
      }
      writerRef.current = true;
      blockedRef.current = false;
      setReadOnly(false);
    });
    const channel = openBoardChannel(
      { tabId, openedAt },
      {
        isWriter: () => writerRef.current,
        locksAuthoritative,
        onYield: () => {
          if (!alive || locksAuthoritative) return;
          becomeReader('This board is open in another tab. Reload before editing so this tab does not overwrite it.');
        },
        onRemoteSave: (message) => {
          const expected = queue.expectation();
          if (message.boardId === expected.id && message.revision === expected.revision) return;
          if (!alive) return;
          becomeReader('Another tab saved this board. Download a recovery ZIP if this tab has edits, then reload.');
        },
      },
    );
    channelRef.current = channel;
    return () => {
      alive = false;
      writerRef.current = false;
      blockedRef.current = true;
      releaseWriteLock();
      channel.close();
    };
  }, [queue]);

  async function refreshStorage() {
    setUsage(logicalUsage(boardRef.current, [...libraryRef.current.values()]));
    const storage = navigator.storage;
    if (!storage?.estimate) {
      setEstimate(null);
      setPersisted(null);
      return;
    }
    const next = await storage.estimate();
    setEstimate({ usage: next.usage, quota: next.quota });
    setPersisted(storage.persisted ? await storage.persisted() : null);
  }

  function captureExport() {
    const board = structuredClone(boardRef.current);
    const snapshot = snapshotAssets(board, libraryRef.current);
    return { board, ...snapshot, unsaved: status !== 'saved' };
  }

  async function stageExport(thenClear: boolean) {
    const captured = captureExport();
    if (captured.missing.length > 0) {
      setNotice({ text: 'An embedded image is missing, so the archive was not created.', source: 'ingest' });
      return;
    }
    const summary = logicalUsage(captured.board, captured.assets);
    setConfirming({
      kind: 'export',
      thenClear,
      unsaved: captured.unsaved,
      summary: `${summary.embeddedAssets} embedded images, ${summary.externalImages} external references, about ${summary.totalBytes} bytes of board and image data.`,
    });
    exportHold.current = { ...captured, key: boardSnapshotKey(captured.board) };
  }

  async function downloadRecovery() {
    const recovered = queue.recovery();
    const board = recovered?.board ?? structuredClone(boardRef.current);
    const library = new Map(libraryRef.current);
    for (const asset of recovered?.assets ?? []) library.set(asset.id, asset);
    const snapshot = snapshotAssets(board, library);
    if (snapshot.missing.length > 0) {
      setNotice({ text: 'An embedded image is missing, so the recovery archive was not created.', source: 'save' });
      return;
    }
    try {
      const bytes = await buildArchive(board, snapshot.assets, new Date().toISOString());
      downloadBytes(bytes, archiveFilename(`${board.title} recovery`));
    } catch (error) {
      setNotice({ text: errorMessage(error), source: 'save' });
    }
  }

  async function runExport() {
    const captured = exportHold.current;
    const pending = confirming?.kind === 'export' ? confirming : null;
    if (!captured || !pending) return;
    try {
      const bytes = await buildArchive(captured.board, captured.assets, new Date().toISOString());
      downloadBytes(bytes, archiveFilename(captured.board.title));
      setConfirming(pending.thenClear ? { kind: 'exported-clear' } : null);
      setProjectOpen(false);
    } catch (error) {
      setNotice({ text: errorMessage(error), source: 'ingest' });
      setConfirming(null);
    }
  }

  async function replaceActive(nextBoard: Board, assets: AssetRecord[]) {
    if (foreignRef.current || blockedRef.current) {
      setNotice({ text: 'Reload this tab before replacing the board.', source: 'save' });
      return;
    }
    blockedRef.current = true;
    queue.holdForReplacement();
    await queue.idle();
    try {
      await replaceStoredBoard(session.database, nextBoard, assets, queue.expectation());
    } catch (error) {
      blockedRef.current = foreignRef.current;
      if (!foreignRef.current) queue.abortReplacement();
      setNotice({ text: error instanceof RevisionConflictError ? error.message : errorMessage(error), source: 'save' });
      return;
    }
    historyRef.current = createHistory();
    textBefore.current = null;
    renameBefore.current = null;
    gestureRef.current = null;
    libraryRef.current = new Map(assets.map((asset) => [asset.id, asset]));
    registryRef.current?.revokeAll();
    for (const asset of assets) registryRef.current?.remember(asset);
    queue.adopt(nextBoard);
    blockedRef.current = false;
    replaceBoard(nextBoard);
    replaceSelection([]);
    replaceEdgeSelection([]);
    editingRef.current = null;
    setEditingId(null);
    setUrlEpoch((value) => value + 1);
    setStatus('saved');
    setConfirming(null);
    setProjectOpen(false);
    flowRef.current.setViewport(nextBoard.viewport);
    boardEl.current?.style.setProperty('--handle-scale', String(1 / (nextBoard.viewport.zoom || 1)));
  }

  async function stageImport(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await readArchive(bytes);
      if ('error' in result) {
        setNotice({ text: result.error, source: 'ingest' });
        return;
      }
      setConfirming({
        kind: 'import',
        board: result.board,
        assets: result.assets,
        summary: `${result.summary.embedded} embedded images and ${result.summary.external} external references will replace the current board.`,
      });
    } catch (error) {
      setNotice({ text: errorMessage(error), source: 'ingest' });
    }
  }

  const selectedNodes = board.nodes.filter((node) => selectedIds.includes(node.id));
  const movement = moveTargets(board, selectedIds);
  const groupTargets = movement.groups;
  const selectionLabel = selectionReadout(board, selectedIds);
  const canGroup = selectedNodes.some((node) => isContentNode(node) && !node.parentId);
  const canUngroup = selectedNodes.some((node) => node.kind === 'group');
  const canDetach = selectedNodes.some((node) => isContentNode(node) && node.parentId);

  const handlers = useRef({
    onNodesChange,
    onEdgesChange,
    onMoveEnd(viewport: Viewport) {
      if (blockedRef.current) return;
      const next = setViewport(boardRef.current, viewport);
      if (next === boardRef.current) return;
      replaceBoard(next);
      queue.schedule(300);
    },
    onConnect(connection: Connection) {
      if (blockedRef.current || !connection.source || !connection.target) return;
      const before = boardRef.current;
      const next = connectNodes(before, connection.source, connection.target, asHandle(connection.sourceHandle), asHandle(connection.targetHandle));
      if (!next) return;
      publish(next, before, 'save');
    },
    isValidConnection(connection: Connection | { source: string | null; target: string | null }) {
      if (!connection.source || !connection.target || connection.source === connection.target) return false;
      return !hasUndirectedLink(boardRef.current, connection.source, connection.target);
    },
    onSelectionChange(nodeIds: string[], edgeIds: string[]) {
      replaceSelection(nodeIds);
      replaceEdgeSelection(edgeIds);
    },
    async onBeforeDelete(doomed: { id: string }[], doomedEdges: { id: string }[]) {
      if (blockedRef.current) return false;
      const before = boardRef.current;
      const withoutEdges = deleteEdges(before, doomedEdges.map((edge) => edge.id));
      const result = deleteSelection(withoutEdges, doomed.map((node) => node.id));
      if (result.board !== before) {
        publish(result.board, before, 'save');
        const live = new Set(result.board.nodes.map((node) => node.id));
        replaceSelection(selectedRef.current.filter((id) => live.has(id)));
        replaceEdgeSelection(selectedEdgeRef.current.filter((id) => result.board.edges.some((edge) => edge.id === id)));
        setUrlEpoch((value) => value + 1);
      }
      return false;
    },
    onPointerMove(world: Point) {
      pointerRef.current = world;
      coordinatesRef.current?.setCursor(Math.round(world.x), Math.round(world.y));
      if (frameRef.current) setDraft(normalizeRect(frameRef.current, world));
    },
  });
  handlers.current.onNodesChange = onNodesChange;
  handlers.current.onEdgesChange = onEdgesChange;
  handlers.current.onMoveEnd = (viewport) => {
    if (blockedRef.current) return;
    const next = setViewport(boardRef.current, viewport);
    if (next === boardRef.current) return;
    replaceBoard(next);
    queue.schedule(300);
  };
  handlers.current.onConnect = (connection) => {
    if (blockedRef.current || !connection.source || !connection.target) return;
    const before = boardRef.current;
    const next = connectNodes(before, connection.source, connection.target, asHandle(connection.sourceHandle), asHandle(connection.targetHandle));
    if (!next) return;
    publish(next, before, 'save');
  };
  handlers.current.isValidConnection = (connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    return !hasUndirectedLink(boardRef.current, connection.source, connection.target);
  };
  handlers.current.onSelectionChange = (nodeIds, edgeIds) => {
    replaceSelection(nodeIds);
    replaceEdgeSelection(edgeIds);
  };
  handlers.current.onBeforeDelete = async (doomed, doomedEdges) => {
    if (blockedRef.current) return false;
    const before = boardRef.current;
    const withoutEdges = deleteEdges(before, doomedEdges.map((edge) => edge.id));
    const result = deleteSelection(withoutEdges, doomed.map((node) => node.id));
    if (result.board !== before) {
      publish(result.board, before, 'save');
      const live = new Set(result.board.nodes.map((node) => node.id));
      replaceSelection(selectedRef.current.filter((id) => live.has(id)));
      replaceEdgeSelection(selectedEdgeRef.current.filter((id) => result.board.edges.some((edge) => edge.id === id)));
      setUrlEpoch((value) => value + 1);
    }
    return false;
  };
  handlers.current.onPointerMove = (world) => {
    pointerRef.current = world;
    coordinatesRef.current?.setCursor(Math.round(world.x), Math.round(world.y));
    if (frameRef.current) setDraft(normalizeRect(frameRef.current, world));
  };

  const onNodesChangeStable = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    handlers.current.onNodesChange(changes);
  }, []);
  const onEdgesChangeStable = useCallback((changes: EdgeChange[]) => {
    handlers.current.onEdgesChange(changes);
  }, []);
  const onMoveEndStable = useCallback((_: unknown, viewport: Viewport) => {
    handlers.current.onMoveEnd(viewport);
  }, []);
  const onConnectStable = useCallback((connection: Connection) => {
    handlers.current.onConnect(connection);
  }, []);
  const isValidConnectionStable = useCallback((connection: Connection | { source: string | null; target: string | null }) => {
    return handlers.current.isValidConnection(connection);
  }, []);
  const onSelectionChangeStable = useCallback((params: { nodes: { id: string }[]; edges: { id: string }[] }) => {
    handlers.current.onSelectionChange(params.nodes.map((node) => node.id), params.edges.map((edge) => edge.id));
  }, []);
  const onBeforeDeleteStable = useCallback((params: { nodes: { id: string }[]; edges: { id: string }[] }) => {
    return handlers.current.onBeforeDelete(params.nodes, params.edges);
  }, []);
  const onMoveStable = useCallback((_: unknown, viewport: Viewport) => {
    const zoom = viewport.zoom || 1;
    boardEl.current?.style.setProperty('--handle-scale', String(1 / zoom));
  }, []);
  const onPointerMoveStable = useCallback((event: ReactPointerEvent) => {
    handlers.current.onPointerMove(flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, []);

  return (
    <BoardActionsProvider value={actions}>
      <div
        ref={boardEl}
        className={`${tool === 'frame' ? 'board is-framing' : 'board'}${board.backgroundPattern === 'dither-atlas' && board.ditherAtlas && !atlasBlocked ? ' has-dither-atlas' : ''}`}
        onDragEnter={(event) => {
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setFileDrag(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setFileDrag(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setFileDrag(false);
          if (blockedRef.current) return;
          const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          void ingestFileList(event.dataTransfer.files)
            .then((bundle) => {
              showWarnings(bundle.warnings);
              return placeItems(bundle.items, origin);
            })
            .catch((error: unknown) => {
              setNotice({ text: errorMessage(error), source: 'ingest' });
            });
        }}
      >
        {board.backgroundPattern === 'dither-atlas' && board.ditherAtlas && !atlasBlocked ? (
          <AtlasBoundary onUnavailable={blockAtlas}>
            <Suspense fallback={null}>
              <DitherAtlasLayer seed={board.ditherAtlas.seed} appearance={board.appearance} tuning={activeAtlasTuning} onUnavailable={blockAtlas} />
            </Suspense>
          </AtlasBoundary>
        ) : null}
        {chromeHidden ? null : (
        <Toolbar
          title={board.title}
          status={status}
          tool={tool}
          appearance={board.appearance}
          canUndo={historyStamp >= 0 && historyRef.current.past.length > 0}
          canRedo={historyStamp >= 0 && historyRef.current.future.length > 0}
          canGroup={canGroup}
          canUngroup={canUngroup}
          onTitle={(title) => {
            if (blockedRef.current) return;
            const next = renameBoard(boardRef.current, title);
            if (next === boardRef.current) return;
            replaceBoard(next);
            queue.schedule(500);
          }}
          onNewNote={() => createNote(viewportCenter())}
          onTool={(next) => {
            frameRef.current = null;
            setDraft(null);
            setTool(next);
          }}
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          onViewport={(viewport) => {
            const next = canonicalViewportUpdate(blockedRef.current, boardRef.current, viewport);
            if (!next) return;
            replaceBoard(next);
            queue.schedule(300);
          }}
          onAddImages={(files) => {
            if (blockedRef.current) return;
            const origin = pointerRef.current ?? viewportCenter();
            void ingestFileList(files)
              .then((bundle) => {
                showWarnings(bundle.warnings);
                return placeItems(bundle.items, origin);
              })
              .catch((error: unknown) => {
                setNotice({ text: errorMessage(error), source: 'ingest' });
              });
          }}
          onUndo={() => commands.current.undo()}
          onRedo={() => commands.current.redo()}
          onSearch={() => {
            setViewsOpen(false);
            setSearchOpen(true);
          }}
          onToggleViews={() => {
            setSearchOpen(false);
            setViewsOpen((open) => !open);
          }}
          viewsOpen={viewsOpen}
          onAppearance={() => {
            if (blockedRef.current) return;
            const next = setAppearance(boardRef.current, boardRef.current.appearance === 'dark' ? 'light' : 'dark');
            if (next === boardRef.current) return;
            replaceBoard(next);
            queue.schedule(300);
          }}
          trailing={
            <ProjectMenu
              open={projectOpen}
              usage={usage}
              estimate={estimate}
              persisted={persisted}
              pattern={board.backgroundPattern}
              atlasBlocked={atlasBlocked}
              rendererVersion={board.ditherAtlas?.rendererVersion ?? null}
              onTune={() => { setProjectOpen(false); setAtlasLabOpen(true); }}
              onUpgrade={() => {
                if (blockedRef.current) return;
                const next = upgradeAtlasRenderer(boardRef.current);
                if (next === boardRef.current) return;
                replaceBoard(next);
                queue.schedule(300);
                setAtlasTuning(defaultsForAtlasVersion(3));
                setAtlasPreview('experimental');
                setProjectOpen(false);
              }}
              onPattern={(pattern) => {
                setAtlasBlocked(false);
                if (blockedRef.current) return;
                const next = setBackgroundPattern(boardRef.current, pattern);
                if (next === boardRef.current) return;
                replaceBoard(next);
                queue.schedule(300);
              }}
              onToggle={() => {
                setProjectOpen((open) => {
                  const next = !open;
                  if (next) void refreshStorage();
                  return next;
                });
              }}
              onExport={() => void stageExport(false)}
              onExportNew={() => void stageExport(true)}
              onImport={(file) => void stageImport(file)}
              onBlank={() => setConfirming({ kind: 'blank' })}
              onClear={() => setConfirming({ kind: 'clear' })}
              onPersist={() => {
                const storage = navigator.storage;
                if (!storage?.persist) {
                  setPersisted(null);
                  return;
                }
                void storage.persist().then((granted) => setPersisted(granted));
              }}
            />
          }
        />
        )}
        {atlasBlocked && board.backgroundPattern === 'dither-atlas' ? (
          <div className="banner" role="status">
            <p>Dither Atlas unavailable on this device. Showing Dots.</p>
          </div>
        ) : null}
        {readOnly ? (
          <div className="banner" role="status">
            <p>{notice?.text || 'This board is open in another tab. You can inspect it and download a recovery ZIP. Reload before editing.'}</p>
            <button
              type="button"
              onClick={() => {
                void downloadRecovery();
              }}
            >
              Download recovery ZIP
            </button>
            <button
              type="button"
              onClick={() => {
                if (queue.hasUnpersisted()) setConfirming({ kind: 'reload' });
                else window.location.reload();
              }}
            >
              Reload
            </button>
          </div>
        ) : null}
        {confirming ? (
          <div
            className="banner confirm-banner"
            role="alertdialog"
            aria-label="Confirm project change"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setConfirming(null);
            }}
          >
            <p>
              {confirming.kind === 'delete-contents'
                ? `Delete "${confirming.label}" and its ${confirming.count} notes/images? Connected links will also be removed.`
                : confirming.kind === 'reload'
                  ? 'Reload will discard open edits that are not in the saved board. Download a recovery ZIP first if you need them.'
                  : confirming.kind === 'export'
                ? `${confirming.summary} External image addresses are not downloaded and may change later.${confirming.unsaved ? ' Some edits are not in IndexedDB yet; this archive uses the open board.' : ''}`
                : confirming.kind === 'import'
                  ? confirming.summary
                  : confirming.kind === 'exported-clear'
                    ? 'The download was started. The browser cannot confirm that the file was kept. Clear the current board only if you have the archive.'
                    : confirming.kind === 'clear'
                      ? 'This removes the canvas board and its embedded images from this site. It does not clear other data stored for raais.github.io.'
                      : 'Replace this board with an empty one? Notes, groups, links, and embedded images will be removed.'}
            </p>
            <button
              type="button"
              onClick={() => {
                if (confirming.kind === 'delete-contents') {
                  const before = boardRef.current;
                  const next = deleteGroupContents(before, confirming.groupId);
                  setConfirming(null);
                  if (next === before) return;
                  publish(next, before, 'save');
                  replaceSelection([]);
                  setUrlEpoch((value) => value + 1);
                } else if (confirming.kind === 'reload') window.location.reload();
                else if (confirming.kind === 'export') void runExport();
                else if (confirming.kind === 'import') void replaceActive(confirming.board, confirming.assets);
                else if (confirming.kind === 'exported-clear') {
                  const exported = exportHold.current;
                  if (!exported || boardSnapshotKey(boardRef.current) !== exported.key) {
                    setNotice({ text: 'The board changed after that export. Export it again before clearing.', source: 'ingest' });
                    setConfirming(null);
                    return;
                  }
                  void replaceActive(createEmptyBoard(), []);
                } else if (confirming.kind === 'blank' || confirming.kind === 'clear') {
                  void replaceActive(createEmptyBoard(), []);
                }
              }}
            >
              {confirming.kind === 'export' ? 'Download' : confirming.kind === 'delete-contents' ? 'Delete' : confirming.kind === 'reload' ? 'Reload anyway' : 'Continue'}
            </button>
            <button type="button" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        {chromeHidden ? null : (
        <SelectionBar
          canGroup={canGroup}
          canUngroup={canUngroup}
          canDetach={canDetach}
          groups={groupTargets}
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          onDetach={() => {
            const before = boardRef.current;
            const next = detachNodes(before, selectedRef.current);
            if (next === before) return;
            publish(next, before, 'save');
          }}
          onAddTo={(groupId) => {
            const before = boardRef.current;
            const result = moveToGroup(before, moveTargets(before, selectedRef.current).ids, groupId);
            if ('error' in result) {
              setNotice({ text: result.error, source: 'ingest' });
              return;
            }
            publish(result.board, before, 'save');
          }}
        />
        )}
        {notice ? (
          <div className="banner" role="alert">
            <p>{notice.text}</p>
            <button type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {fileDrag ? <div className="drop-overlay" /> : null}
        {searchOpen ? (
          <SearchPalette query={searchQuery} results={searchResults} onQuery={setSearchQuery} onJump={jumpToNode} onClose={closeSearch} />
        ) : null}
        {viewsOpen && !chromeHidden ? (
          <SavedViewsPanel
            views={board.savedViews}
            readOnly={readOnly}
            onClose={() => setViewsOpen(false)}
            onSave={saveCurrentView}
            onRecall={recallSavedView}
            onRename={(id, name) => commitMetadata(editSavedView(blockedRef.current, boardRef.current, { type: 'rename', id, name }))}
            onUpdate={(id) => commitMetadata(editSavedView(blockedRef.current, boardRef.current, { type: 'update', id, viewport: flowRef.current.getViewport() }))}
            onDelete={(id) => commitMetadata(editSavedView(blockedRef.current, boardRef.current, { type: 'delete', id }))}
          />
        ) : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={initialViewport.current}
          onNodesChange={onNodesChangeStable}
          onEdgesChange={onEdgesChangeStable}
          onMove={onMoveStable}
          onMoveEnd={onMoveEndStable}
          onPointerMove={onPointerMoveStable}
          onPointerDown={(event) => {
            if (toolRef.current !== 'frame') return;
            if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
            frameRef.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (!frameRef.current) return;
            finishFrame(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          onDoubleClick={(event) => {
            if (toolRef.current === 'frame') return;
            if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
            createNote(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          onConnect={onConnectStable}
          isValidConnection={isValidConnectionStable}
          onBeforeDelete={onBeforeDeleteStable}
          onSelectionChange={onSelectionChangeStable}
          minZoom={0.1}
          maxZoom={6}
          zoomOnDoubleClick={false}
          zoomOnScroll
          zoomOnPinch
          panOnDrag={tool !== 'frame'}
          panOnScroll={false}
          selectionOnDrag={false}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
          panActivationKeyCode="Space"
          deleteKeyCode={['Backspace', 'Delete']}
          nodesConnectable
          connectOnClick={false}
          connectionMode={ConnectionMode.Loose}
          elementsSelectable
          elevateNodesOnSelect={false}
          colorMode={board.appearance}
          proOptions={{ hideAttribution: true }}
          fitView={false}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        >
          {board.backgroundPattern === 'blank' || (board.backgroundPattern === 'dither-atlas' && !atlasBlocked) ? null : (
            <Background variant={board.backgroundPattern === 'grid' ? BackgroundVariant.Lines : board.backgroundPattern === 'cross' ? BackgroundVariant.Cross : BackgroundVariant.Dots} gap={20} size={1.4} color={board.appearance === 'light' ? '#d2c9be' : '#3c4652'} />
          )}
          {draft ? (
            <ViewportPortal>
              <div
                className="frame-draft"
                style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height }}
              />
            </ViewportPortal>
          ) : null}
        </ReactFlow>
        {chromeHidden || !ATLAS_LAB_ENABLED || !atlasLabOpen || board.backgroundPattern !== 'dither-atlas' ? null : (
          <AtlasTuningPanel
            tuning={atlasTuning}
            preview={atlasPreview}
            seed={board.ditherAtlas?.seed ?? 0}
            title={board.title}
            zoom={board.viewport.zoom}
            rendererVersion={atlasVersion}
            onChange={(next) => setAtlasTuning(clampAtlasTuning(next, defaultsForAtlasVersion(atlasVersion)))}
            onPreview={setAtlasPreview}
            onReset={() => { setAtlasTuning(defaultsForAtlasVersion(atlasVersion)); setAtlasPreview('experimental'); }}
            onClose={() => setAtlasLabOpen(false)}
          />
        )}
        {chromeHidden ? null : <Coordinates ref={coordinatesRef} selection={selectionLabel} />}
        <button
          type="button"
          className="focus-toggle"
          aria-label={chromeHidden ? 'Show interface' : 'Hide interface'}
          title={chromeHidden ? 'Show interface' : 'Hide interface'}
          onClick={() => {
            setChromeHidden((hidden) => {
              if (!hidden) setProjectOpen(false);
              return !hidden;
            });
          }}
        >
          {chromeHidden ? <Eye size={16} strokeWidth={1.75} /> : <EyeOff size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </BoardActionsProvider>
  );
}

function toFlowNode(
  node: BoardNode,
  nodes: readonly BoardNode[],
  selected: boolean,
  editing: boolean,
  registry: ObjectUrlRegistry | null,
): CanvasFlowNode {
  const base = {
    id: node.id,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    selected,
    parentId: isContentNode(node) ? node.parentId : undefined,
    zIndex: node.kind === 'group' ? 0 : 1,
    draggable: node.kind !== 'text' || !editing,
    style: { width: node.width, height: node.height },
    measured: { width: node.width, height: node.height },
  };
  if (node.kind === 'group') {
    const extent = contentExtent(nodes, node.id);
    return {
      ...base,
      type: 'group',
      dragHandle: '.group-node',
      data: {
        label: node.label,
        minWidth: Math.max(GROUP_MIN_WIDTH, extent ? extent.right + GROUP_PAD : GROUP_MIN_WIDTH),
        minHeight: Math.max(GROUP_MIN_HEIGHT, extent ? extent.bottom + GROUP_PAD : GROUP_MIN_HEIGHT),
        backgroundTone: node.backgroundTone,
      },
    };
  }
  if (node.kind === 'text') {
    return {
      ...base,
      type: 'text',
      data: { text: node.text, editing, presentation: node.presentation ?? 'text', language: node.language, codeLanguage: node.codeLanguage, backgroundTone: node.backgroundTone, textTone: node.textTone },
    };
  }
  const image = node as ImageNode;
  const src = image.source.type === 'external' ? image.source.url : (registry?.get(image.source.assetId) ?? null);
  return {
    ...base,
    type: 'image',
    data: {
      mode: image.mode,
      src,
      externalUrl: image.source.type === 'external' ? image.source.url : null,
      flipX: image.flipX === true,
      flipY: image.flipY === true,
      cornerStyle: image.cornerStyle === 'square' ? 'square' : 'rounded',
    },
  };
}

function selectionReadout(board: Board, ids: readonly string[]): string | null {
  if (ids.length !== 1) return null;
  const node = board.nodes.find((entry) => entry.id === ids[0]);
  if (!node) return null;
  const world = worldTopLeft(board.nodes, node);
  return `Selected  X: ${Math.round(world.x)}  Y: ${Math.round(world.y)}`;
}

function asHandle(value: string | null | undefined): HandleSide {
  if (value === 'top' || value === 'right' || value === 'bottom' || value === 'left') return value;
  return 'right';
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes('Files'));
}
