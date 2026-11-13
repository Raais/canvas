import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
  deleteNodes,
  noteImageIntrinsic,
  placeNode,
  renameBoard,
  setImageMode,
  setViewport,
  staggeredPositions,
  updateText,
} from '../domain/board';
import type { AssetRecord, Board, BoardNode, ImageNode, Point } from '../domain/types';
import { ingestDataTransfer, ingestFileList, type PreparedItem } from '../ingest/browser';
import { createAssetRecord, type CanvasDatabase } from '../persistence/db';
import { createObjectUrlRegistry, type ObjectUrlRegistry } from '../persistence/object-urls';
import { errorMessage, SaveQueue, type SaveStatus } from '../persistence/save-queue';
import { BoardActionsProvider, type BoardActions } from './board-context';
import { ImageNoteNode, type ImageFlowNode } from './ImageNoteNode';
import { TextNoteNode, type TextFlowNode } from './TextNoteNode';
import { Toolbar } from './Toolbar';

type CanvasFlowNode = TextFlowNode | ImageFlowNode;

const nodeTypes = {
  text: TextNoteNode,
  image: ImageNoteNode,
};

const NO_EDGES: Edge[] = [];

type SessionProps = {
  database: CanvasDatabase;
  board: Board;
  assets: { id: string; blob: Blob }[];
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [notice, setNotice] = useState<{ text: string; source: 'save' | 'ingest' } | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [urlEpoch, setUrlEpoch] = useState(0);

  const boardRef = useRef(session.board);
  const selectedRef = useRef<string[]>([]);
  const editingRef = useRef<string | null>(null);
  const pointerRef = useRef<Point | null>(null);
  const dragDepth = useRef(0);
  const initialViewport = useRef(session.board.viewport);
  const toWorldRef = useRef(screenToFlowPosition);
  toWorldRef.current = screenToFlowPosition;

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
    for (const asset of session.assets) registry.remember(asset);
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
    const assets: AssetRecord[] = [];
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
      assets.push(asset);
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
    replaceBoard(addNodes(boardRef.current, nodes));
    replaceSelection(nodes.map((node) => node.id));
    const only = nodes.length === 1 ? nodes[0] : undefined;
    if (only?.kind === 'text') {
      editingRef.current = only.id;
      setEditingId(only.id);
    }
    setUrlEpoch((value) => value + 1);
    queue.addAssets(assets);
    queue.saveNow();
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
      event.preventDefault();
      const origin = pointerRef.current ?? viewportCenterRef.current();
      void ingestDataTransfer(data, 'clipboard')
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

  const actions = useMemo<BoardActions>(
    () => ({
      beginEditing(id) {
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
        if (editingRef.current === null) return;
        editingRef.current = null;
        setEditingId(null);
        queue.saveNow();
      },
      setMode(id, mode) {
        const next = setImageMode(boardRef.current, id, mode);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.saveNow();
      },
      noteIntrinsicSize(id, width, height) {
        const next = noteImageIntrinsic(boardRef.current, id, width, height);
        if (next === boardRef.current) return;
        boardRef.current = next;
        setBoard(next);
        queue.saveNow();
      },
    }),
    [queue],
  );

  const nodes = useMemo(
    () =>
      board.nodes.map((node) =>
        toFlowNode(node, selectedIds.includes(node.id), editingId === node.id, registryRef.current),
      ),
    [board.nodes, editingId, selectedIds, urlEpoch],
  );

  function onNodesChange(changes: NodeChange<CanvasFlowNode>[]) {
    let geometry = boardRef.current;
    let sawDrag = false;
    let dragFinished = false;
    let resizeActive = false;
    let resizeFinished = false;
    let barePosition = false;
    const removed: string[] = [];
    let selection = selectedRef.current;
    let selectionChanged = false;

    for (const change of changes) {
      if (change.type === 'select') {
        const set = new Set(selection);
        if (change.selected) set.add(change.id);
        else set.delete(change.id);
        selection = [...set];
        selectionChanged = true;
      } else if (change.type === 'remove') {
        removed.push(change.id);
      } else if (change.type === 'position' && change.position) {
        geometry = placeNode(geometry, change.id, { x: change.position.x, y: change.position.y });
        if (change.dragging === true) sawDrag = true;
        else if (change.dragging === false) dragFinished = true;
        else barePosition = true;
      } else if (change.type === 'dimensions' && change.dimensions && change.resizing !== undefined) {
        geometry = placeNode(geometry, change.id, {
          width: change.dimensions.width,
          height: change.dimensions.height,
          lockImageSize: true,
        });
        if (change.resizing) resizeActive = true;
        else resizeFinished = true;
      }
    }

    let deleted = false;
    if (removed.length > 0) {
      const before = geometry.nodes.length;
      const result = deleteNodes(geometry, removed);
      for (const id of result.removedAssetIds) {
        registryRef.current?.revoke(id);
        queue.removeAssets([id]);
      }
      geometry = result.board;
      deleted = result.board.nodes.length !== before;
      selection = selection.filter((id) => !removed.includes(id));
      selectionChanged = true;
      if (editingRef.current && removed.includes(editingRef.current)) {
        editingRef.current = null;
        setEditingId(null);
      }
    }

    if (deleted) {
      replaceBoard(geometry);
      queue.saveNow();
    } else if (resizeFinished || dragFinished || (barePosition && !resizeActive)) {
      replaceBoard(commitInteraction(geometry));
      queue.saveNow();
    } else if (geometry !== boardRef.current) {
      replaceBoard(geometry);
      if (sawDrag || resizeActive) queue.markUnsaved();
    }

    if (selectionChanged) replaceSelection(selection);
  }

  function createNote(origin: Point) {
    const node = createTextNode(origin);
    replaceBoard(addNodes(boardRef.current, [node]));
    replaceSelection([node.id]);
    editingRef.current = node.id;
    setEditingId(node.id);
    queue.saveNow();
  }

  return (
    <BoardActionsProvider value={actions}>
      <div
        className="board"
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
          onTitle={(title) => {
            const next = renameBoard(boardRef.current, title);
            if (next === boardRef.current) return;
            replaceBoard(next);
            queue.schedule(500);
          }}
          onNewNote={() => createNote(viewportCenter())}
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
          edges={NO_EDGES}
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
            pointerRef.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          }}
          onDoubleClick={(event) => {
            if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
            createNote(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          minZoom={0.1}
          maxZoom={6}
          zoomOnDoubleClick={false}
          zoomOnScroll
          zoomOnPinch
          panOnDrag
          panOnScroll={false}
          selectionOnDrag={false}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
          panActivationKeyCode="Space"
          deleteKeyCode={['Backspace', 'Delete']}
          nodesConnectable={false}
          elementsSelectable
          colorMode="light"
          proOptions={{ hideAttribution: false }}
          fitView={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#b7bec8" />
        </ReactFlow>
      </div>
    </BoardActionsProvider>
  );
}

function toFlowNode(
  node: BoardNode,
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
    draggable: node.kind !== 'text' || !editing,
    style: { width: node.width, height: node.height },
  };
  if (node.kind === 'text') {
    return { ...base, type: 'text', data: { text: node.text, editing } };
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
    },
  };
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes('Files'));
}
