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
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addNodes,
  commitInteraction,
  createEmbeddedImageNode,
  createExternalImageNode,
  createTextNode,
  noteImageIntrinsic,
  placeNode,
  renameBoard,
  setImageMode,
  setViewport,
  staggeredPositions,
  updateText,
} from '../domain/board';
import { contentExtent, isContentNode, normalizeRect, worldTopLeft } from '../domain/geometry';
import { connectNodes, deleteEdges, hasUndirectedLink } from '../domain/graph';
import {
  createTextInside,
  deleteGroupContents,
  deleteSelection,
  detachNodes,
  duplicateSelection,
  expandGroup,
  groupFrame,
  groupSelection,
  moveToGroup,
  renameGroup,
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
import { ingestClipboard, ingestFileList, type PreparedItem } from '../ingest/browser';
import { captureClipboardData } from '../ingest/clipboard';
import { createAssetRecord, type CanvasDatabase } from '../persistence/db';
import { createObjectUrlRegistry, type ObjectUrlRegistry } from '../persistence/object-urls';
import { errorMessage, SaveQueue, type SaveStatus } from '../persistence/save-queue';
import { BoardActionsProvider, type BoardActions } from './board-context';
import { Coordinates, type CoordinatesHandle } from './Coordinates';
import { GroupNode, type GroupFlowNode } from './GroupNode';
import { ImageNoteNode, type ImageFlowNode } from './ImageNoteNode';
import { SelectionBar } from './SelectionBar';
import { TextNoteNode, type TextFlowNode } from './TextNoteNode';
import { Toolbar } from './Toolbar';

type CanvasFlowNode = TextFlowNode | ImageFlowNode | GroupFlowNode;
type Tool = 'select' | 'frame';

const nodeTypes = {
  text: TextNoteNode,
  image: ImageNoteNode,
  group: GroupNode,
};

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
  const { screenToFlowPosition } = useReactFlow();
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

  const boardRef = useRef(session.board);
  const selectedRef = useRef<string[]>([]);
  const editingRef = useRef<string | null>(null);
  const pointerRef = useRef<Point | null>(null);
  const dragDepth = useRef(0);
  const initialViewport = useRef(session.board.viewport);
  const toWorldRef = useRef(screenToFlowPosition);
  const gestureRef = useRef<Board | null>(null);
  const textBefore = useRef<Board | null>(null);
  const renameBefore = useRef<Board | null>(null);
  const historyRef = useRef<History>(createHistory());
  const libraryRef = useRef(new Map<string, AssetRecord>());
  const toolRef = useRef<Tool>('select');
  const frameRef = useRef<Point | null>(null);
  const coordinatesRef = useRef<CoordinatesHandle>(null);
  toWorldRef.current = screenToFlowPosition;
  toolRef.current = tool;

  if (libraryRef.current.size === 0) {
    for (const asset of session.assets) libraryRef.current.set(asset.id, asset);
  }

  const registryRef = useRef<ObjectUrlRegistry | null>(null);
  if (!registryRef.current) {
    const registry = createObjectUrlRegistry();
    for (const asset of session.assets) registry.remember(asset);
    registryRef.current = registry;
  }

  const queueRef = useRef<SaveQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new SaveQueue(session.database, () => boardRef.current, (next, message) => {
      setStatus((current) => (current === next ? current : next));
      if (next === 'error' && message) setNotice({ text: message, source: 'save' });
      if (next === 'saved') setNotice((current) => (current?.source === 'save' ? null : current));
    });
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
    selectedRef.current = ids;
    setSelectedIds(ids);
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
    if (before) historyRef.current = pushHistory(historyRef.current, before);
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
    if (items.length === 0) return;
    const registry = registryRef.current;
    if (!registry) return;
    const positions = staggeredPositions(origin, items.length);
    const nodes: BoardNode[] = [];
    items.forEach((item, index) => {
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

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (editingRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const data = event.clipboardData;
      if (!data) return;
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
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  function groupSelected() {
    const before = boardRef.current;
    const ids = before.nodes
      .filter((node) => selectedRef.current.includes(node.id) && isContentNode(node) && !node.parentId)
      .map((node) => node.id);
    const result = groupSelection(before, ids);
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
    const current = boardRef.current;
    const result = direction === 'undo' ? undoHistory(historyRef.current, current) : redoHistory(historyRef.current, current);
    if (!result) return;
    historyRef.current = result.history;
    replaceBoard(result.board);
    reconcile(current, result.board);
    queue.saveNow();
    setUrlEpoch((value) => value + 1);
  }

  const commands = useRef({
    undo: () => restoreHistory('undo'),
    redo: () => restoreHistory('redo'),
    group: groupSelected,
    ungroup: ungroupSelected,
    duplicate: duplicateSelected,
  });
  commands.current = {
    undo: () => restoreHistory('undo'),
    redo: () => restoreHistory('redo'),
    group: groupSelected,
    ungroup: ungroupSelected,
    duplicate: duplicateSelected,
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (event.key === 'Escape') {
        frameRef.current = null;
        setDraft(null);
        setTool('select');
        return;
      }
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
        textBefore.current = structuredClone(boardRef.current);
        editingRef.current = id;
        setEditingId(id);
        selectedRef.current = [id];
        setSelectedIds([id]);
      },
      updateText(id, text) {
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
        const before = boardRef.current;
        const next = setImageMode(before, id, mode);
        if (next === before) return;
        publish(next, before, 'save');
      },
      noteIntrinsicSize(id, width, height) {
        const next = noteImageIntrinsic(boardRef.current, id, width, height);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.saveNow();
      },
      renameGroup(id, label) {
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
      createNoteIn(groupId) {
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
      deleteContents(groupId) {
        const before = boardRef.current;
        const next = deleteGroupContents(before, groupId);
        if (next === before) return;
        publish(next, before, 'save');
        replaceSelection([]);
        setUrlEpoch((value) => value + 1);
      },
    }),
    [queue],
  );

  const nodes = useMemo(() => {
    const ordered = [...board.nodes].sort((left, right) => Number(left.kind !== 'group') - Number(right.kind !== 'group'));
    return ordered.map((node) => toFlowNode(node, board.nodes, selectedIds.includes(node.id), editingId === node.id, registryRef.current));
  }, [board.nodes, editingId, selectedIds, urlEpoch]);

  const edges = useMemo<Edge[]>(
    () =>
      board.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        selected: selectedEdgeIds.includes(edge.id),
      })),
    [board.edges, selectedEdgeIds],
  );

  function onNodesChange(changes: NodeChange<CanvasFlowNode>[]) {
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

    const finish = dragFinished || resizeFinished || (barePosition && !resizeActive);
    if (sawDrag && !document.hidden) geometry = relaxBoard(geometry, pinned, 4);
    if (finish && dragFinished && !document.hidden) geometry = relaxBoard(geometry, pinned, 40);

    if (finish) {
      const before = gestureRef.current;
      gestureRef.current = null;
      if (before) publish(commitInteraction(geometry), before, 'save');
    } else if (geometry !== boardRef.current) {
      replaceBoard(geometry);
      if (sawDrag || resizeActive) queue.markUnsaved();
    }
    if (selectionChanged) replaceSelection(selection);
  }

  function createNote(origin: Point) {
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
    if (!start) return;
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

  const selectedNodes = board.nodes.filter((node) => selectedIds.includes(node.id));
  const groupTargets = board.nodes.filter((node) => node.kind === 'group' && !selectedNodes.every((entry) => isContentNode(entry) && entry.parentId === node.id));
  const selectionLabel = selectionReadout(board, selectedIds);
  const canGroup = selectedNodes.some((node) => isContentNode(node) && !node.parentId);
  const canUngroup = selectedNodes.some((node) => node.kind === 'group');
  const canDetach = selectedNodes.some((node) => isContentNode(node) && node.parentId);

  return (
    <BoardActionsProvider value={actions}>
      <div
        className={tool === 'frame' ? 'board is-framing' : 'board'}
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
        <Toolbar
          title={board.title}
          status={status}
          tool={tool}
          canGroup={canGroup}
          canUngroup={canUngroup}
          onTitle={(title) => {
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
            const next = setViewport(boardRef.current, viewport);
            if (next === boardRef.current) return;
            replaceBoard(next);
            queue.schedule(300);
          }}
          onAddImages={(files) => {
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
        />
        <SelectionBar
          canGroup={canGroup}
          canUngroup={canUngroup}
          canDetach={canDetach}
          groups={groupTargets.flatMap((node) => (node.kind === 'group' ? [{ id: node.id, label: node.label }] : []))}
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
            const result = moveToGroup(before, selectedRef.current.filter((id) => before.nodes.some((node) => node.id === id && node.kind !== 'group')), groupId);
            if ('error' in result) {
              setNotice({ text: result.error, source: 'ingest' });
              return;
            }
            publish(result.board, before, 'save');
          }}
        />
        {notice ? (
          <div className="banner" role="alert">
            <p>{notice.text}</p>
            <button type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {fileDrag ? <div className="drop-overlay" /> : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultViewport={initialViewport.current}
          onNodesChange={onNodesChange}
          onMoveEnd={(_, viewport: Viewport) => {
            const next = setViewport(boardRef.current, viewport);
            if (next === boardRef.current) return;
            replaceBoard(next);
            queue.schedule(300);
          }}
          onPointerMove={(event) => {
            const world = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            pointerRef.current = world;
            coordinatesRef.current?.setCursor(Math.round(world.x), Math.round(world.y));
            if (frameRef.current) setDraft(normalizeRect(frameRef.current, world));
          }}
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
          onConnect={(connection: Connection) => {
            if (!connection.source || !connection.target) return;
            const before = boardRef.current;
            const next = connectNodes(before, connection.source, connection.target, asHandle(connection.sourceHandle), asHandle(connection.targetHandle));
            if (!next) return;
            publish(next, before, 'save');
          }}
          isValidConnection={(connection) => {
            if (!connection.source || !connection.target || connection.source === connection.target) return false;
            return !hasUndirectedLink(boardRef.current, connection.source, connection.target);
          }}
          onBeforeDelete={async ({ nodes: doomed, edges: doomedEdges }) => {
            const before = boardRef.current;
            const withoutEdges = deleteEdges(before, doomedEdges.map((edge) => edge.id));
            const result = deleteSelection(withoutEdges, doomed.map((node) => node.id));
            if (result.board !== before) {
              publish(result.board, before, 'save');
              const live = new Set(result.board.nodes.map((node) => node.id));
              replaceSelection(selectedRef.current.filter((id) => live.has(id)));
              setSelectedEdgeIds((current) => current.filter((id) => result.board.edges.some((edge) => edge.id === id)));
              setUrlEpoch((value) => value + 1);
            }
            return false;
          }}
          onSelectionChange={({ nodes: picked, edges: pickedEdges }) => {
            const nodeIds = picked.map((node) => node.id);
            const edgeIds = pickedEdges.map((edge) => edge.id);
            if (!sameIds(nodeIds, selectedRef.current)) replaceSelection(nodeIds);
            setSelectedEdgeIds((current) => (sameIds(edgeIds, current) ? current : edgeIds));
          }}
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
          colorMode="dark"
          proOptions={{ hideAttribution: false }}
          fitView={false}
          defaultEdgeOptions={{ interactionWidth: 18 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#4c596b" />
          {draft ? (
            <ViewportPortal>
              <div
                className="frame-draft"
                style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height }}
              />
            </ViewportPortal>
          ) : null}
        </ReactFlow>
        <Coordinates ref={coordinatesRef} selection={selectionLabel} />
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
  };
  if (node.kind === 'group') {
    const extent = contentExtent(nodes, node.id);
    return {
      ...base,
      type: 'group',
      dragHandle: '.group-header',
      data: {
        label: node.label,
        minWidth: Math.max(GROUP_MIN_WIDTH, extent ? extent.right + GROUP_PAD : GROUP_MIN_WIDTH),
        minHeight: Math.max(GROUP_MIN_HEIGHT, extent ? extent.bottom + GROUP_PAD : GROUP_MIN_HEIGHT),
      },
    };
  }
  if (node.kind === 'text') return { ...base, type: 'text', data: { text: node.text, editing } };
  const image = node as ImageNode;
  const src = image.source.type === 'external' ? image.source.url : (registry?.get(image.source.assetId) ?? null);
  return {
    ...base,
    type: 'image',
    data: {
      mode: image.mode,
      src,
      externalUrl: image.source.type === 'external' ? image.source.url : null,
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

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes('Files'));
}
