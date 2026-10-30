import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getStraightPath,
  useInternalNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  TOPOLOGY_NODE_KINDS,
  TOPOLOGY_ZONE_KINDS,
  autoLayoutTopology,
  getTopologyNodeKind,
  normalizeTopology,
  renderTopologySvg,
} from "../../../../shared/topology.js";

const ZONE_KIND_LABELS = {
  site: "Sitio",
  cloud: "Nube",
  dmz: "DMZ",
  internet: "Internet",
  datacenter: "Centro de datos",
  generic: "Zona",
};

const ReadOnlyContext = createContext(false);

const MIN_NODE_WIDTH = 120;
const MIN_NODE_HEIGHT = 48;

// Height that fits the wrapped label and detail at the given width, so long texts are not clipped.
function fitNodeHeight({ label = "", sublabel = "", width, height }) {
  const usable = Math.max(width - 32, 60);
  const labelLines = Math.max(1, Math.ceil(String(label).length / Math.max(Math.floor(usable / 7.6), 6)));
  const detailLines = sublabel ? Math.ceil(String(sublabel).length / Math.max(Math.floor(usable / 6.4), 6)) : 0;
  const needed = 20 + labelLines * 18 + detailLines * 16;
  return Math.max(height, Math.ceil(needed));
}

function TopoNode({ data, selected }) {
  const readOnly = useContext(ReadOnlyContext);
  const kind = getTopologyNodeKind(data.kind);
  return (
    <div className="ts-node" style={{ borderColor: kind.color }}>
      <NodeResizer minWidth={MIN_NODE_WIDTH} minHeight={MIN_NODE_HEIGHT} isVisible={selected && !readOnly} />
      <span className="ts-node-bar" style={{ background: kind.color }} />
      <Handle type="target" position={Position.Left} className="ts-handle-fill" isConnectableStart={false} />
      <div className="ts-node-text">
        <strong>{data.label}</strong>
        {data.sublabel ? <small>{data.sublabel}</small> : null}
      </div>
      {data.locked ? <span className="ts-node-lock" title="Bloqueado: la IA no lo modifica">🔒</span> : null}
      <Handle type="source" position={Position.Right} className="ts-handle-dot" />
    </div>
  );
}

function ZoneNode({ data, selected }) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <div className="ts-zone">
      <NodeResizer minWidth={140} minHeight={90} isVisible={selected && !readOnly} />
      <span className="ts-zone-label">{data.label}</span>
    </div>
  );
}

// Edge drawn between node borders along the center line, the same geometry as the PDF renderer.
function clipToRect(rect, from, to) {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: centerX, y: centerY };
  const scaleX = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

function nodeRect(node) {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    w: node.measured?.width || 170,
    h: node.measured?.height || 58,
  };
}

function FloatingEdge({ id, source, target, markerEnd, style, label, selected }) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const sourceRect = nodeRect(sourceNode);
  const targetRect = nodeRect(targetNode);
  const sourceCenter = { x: sourceRect.x + sourceRect.w / 2, y: sourceRect.y + sourceRect.h / 2 };
  const targetCenter = { x: targetRect.x + targetRect.w / 2, y: targetRect.y + targetRect.h / 2 };
  const start = clipToRect(sourceRect, sourceCenter, targetCenter);
  const end = clipToRect(targetRect, targetCenter, sourceCenter);
  const [path, labelX, labelY] = getStraightPath({ sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 2.4 : 1.6 }} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="ts-edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { topo: TopoNode, zone: ZoneNode };
const edgeTypes = { floating: FloatingEdge };

function toFlow(input) {
  const topology = autoLayoutTopology(normalizeTopology(input));
  const zones = topology.zones.map((zone) => ({
    id: zone.id,
    type: "zone",
    position: { x: zone.x, y: zone.y },
    width: zone.w,
    height: zone.h,
    zIndex: -1,
    data: { label: zone.label, kind: zone.kind },
  }));
  const nodes = topology.nodes.map((node) => ({
    id: node.id,
    type: "topo",
    position: { x: node.x, y: node.y },
    width: node.w,
    height: fitNodeHeight({ label: node.label, sublabel: node.sublabel, width: node.w, height: node.h }),
    data: {
      label: node.label,
      sublabel: node.sublabel,
      kind: node.kind,
      locked: node.locked,
      itemRef: node.itemRef,
    },
  }));
  const edges = topology.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "floating",
    label: edge.label,
    markerEnd: { type: "arrowclosed" },
    style: edge.style === "dashed" ? { strokeDasharray: "6 4" } : {},
    data: { style: edge.style },
  }));
  return { nodes: [...zones, ...nodes], edges, title: topology.title };
}

function sizeOf(node) {
  return {
    w: Math.round(node.width ?? node.measured?.width ?? 170),
    h: Math.round(node.height ?? node.measured?.height ?? 58),
  };
}

function fromFlow(nodes, edges, title) {
  const zoneNodes = nodes.filter((node) => node.type === "zone");
  const zones = zoneNodes.map((node) => ({
    id: node.id,
    label: node.data.label,
    kind: node.data.kind,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    ...sizeOf(node),
  }));
  const containing = (center) =>
    zones
      .filter((zone) => center.x >= zone.x && center.x <= zone.x + zone.w && center.y >= zone.y && center.y <= zone.y + zone.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0] || null;
  const topoNodes = nodes
    .filter((node) => node.type === "topo")
    .map((node) => {
      const size = sizeOf(node);
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);
      return {
        id: node.id,
        label: node.data.label,
        sublabel: node.data.sublabel || "",
        kind: node.data.kind,
        zoneId: containing({ x: x + size.w / 2, y: y + size.h / 2 })?.id || null,
        x,
        y,
        ...size,
        locked: Boolean(node.data.locked),
        itemRef: node.data.itemRef || "",
      };
    });
  return {
    title,
    zones,
    nodes: topoNodes,
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || "",
      style: edge.data?.style === "dashed" ? "dashed" : "solid",
    })),
  };
}

let idCounter = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idCounter += 1)}`;

function Inspector({ selected, quotationItems, readOnly, onChangeNode, onChangeEdge, onDelete }) {
  if (!selected) {
    return <p className="field-hint">Selecciona un componente, una zona o un enlace para editarlo.</p>;
  }
  if (selected.kind === "edge") {
    const { edge } = selected;
    return (
      <div className="ts-inspector">
        <strong>Enlace</strong>
        <label>Etiqueta
          <input value={edge.label || ""} readOnly={readOnly} onChange={(event) => onChangeEdge(edge.id, { label: event.target.value })} />
        </label>
        <label>Estilo
          <select value={edge.data?.style || "solid"} disabled={readOnly} onChange={(event) => onChangeEdge(edge.id, { dashed: event.target.value === "dashed" })}>
            <option value="solid">Continuo</option>
            <option value="dashed">Punteado</option>
          </select>
        </label>
        {readOnly ? null : <button type="button" className="btn-link" onClick={() => onDelete(edge.id, "edge")}>Eliminar enlace</button>}
      </div>
    );
  }
  const { node } = selected;
  if (node.type === "zone") {
    return (
      <div className="ts-inspector">
        <strong>Zona</strong>
        <label>Nombre
          <input value={node.data.label} readOnly={readOnly} onChange={(event) => onChangeNode(node.id, { label: event.target.value })} />
        </label>
        <label>Tipo
          <select value={node.data.kind} disabled={readOnly} onChange={(event) => onChangeNode(node.id, { kind: event.target.value })}>
            {TOPOLOGY_ZONE_KINDS.map((kind) => <option key={kind} value={kind}>{ZONE_KIND_LABELS[kind]}</option>)}
          </select>
        </label>
        {readOnly ? null : <button type="button" className="btn-link" onClick={() => onDelete(node.id, "zone")}>Eliminar zona</button>}
      </div>
    );
  }
  return (
    <div className="ts-inspector">
      <strong>Componente</strong>
      <label>Nombre
        <input value={node.data.label} readOnly={readOnly} onChange={(event) => onChangeNode(node.id, { label: event.target.value })} />
      </label>
      <label>Detalle (cantidad, modelo)
        <input value={node.data.sublabel || ""} readOnly={readOnly} onChange={(event) => onChangeNode(node.id, { sublabel: event.target.value })} />
      </label>
      <label>Tipo
        <select value={node.data.kind} disabled={readOnly} onChange={(event) => onChangeNode(node.id, { kind: event.target.value })}>
          {TOPOLOGY_NODE_KINDS.map((kind) => <option key={kind.code} value={kind.code}>{kind.label}</option>)}
        </select>
      </label>
      <label>Partida cotizada
        <select value={node.data.itemRef || ""} disabled={readOnly} onChange={(event) => onChangeNode(node.id, { itemRef: event.target.value })}>
          <option value="">Sin partida</option>
          {quotationItems.map((item) => <option key={item.productCode} value={item.productCode}>{item.productCode}</option>)}
        </select>
      </label>
      <label className="ts-check">
        <input type="checkbox" checked={Boolean(node.data.locked)} disabled={readOnly} onChange={(event) => onChangeNode(node.id, { locked: event.target.checked })} />
        Bloquear (la IA no lo modifica al regenerar)
      </label>
      {readOnly ? null : <button type="button" className="btn-link" onClick={() => onDelete(node.id, "node")}>Eliminar componente</button>}
    </div>
  );
}

function EditorInner({ value, quotationItems, readOnly, onSave, onPropose, busy, title, extraActions, startDirty = false }) {
  const initial = useMemo(() => toFlow(value), [value]);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [selected, setSelected] = useState(null);
  const [dirty, setDirty] = useState(startDirty);
  const [showSvg, setShowSvg] = useState(false);
  const dragRef = useRef(null);
  const topologyTitle = initial.title;

  const onNodesChange = useCallback((changes) => {
    // Measurements are reported as "dimensions" too; only an explicit resize (setAttributes) is a user edit.
    if (changes.some((change) => (change.type !== "select" && change.type !== "dimensions") || (change.type === "dimensions" && change.setAttributes))) setDirty(true);
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const onEdgesChange = useCallback((changes) => {
    if (changes.some((change) => change.type === "remove")) setDirty(true);
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);
  const onConnect = useCallback((connection) => {
    setDirty(true);
    setEdges((current) =>
      addEdge({ ...connection, id: newId("e"), type: "floating", markerEnd: { type: "arrowclosed" }, data: { style: "solid" } }, current),
    );
  }, []);

  const onNodeDragStart = useCallback((_event, node) => {
    if (node.type !== "zone") {
      dragRef.current = null;
      return;
    }
    const width = node.width ?? node.measured?.width ?? 0;
    const height = node.height ?? node.measured?.height ?? 0;
    const members = {};
    for (const candidate of nodes) {
      if (candidate.type !== "topo") continue;
      const centerX = candidate.position.x + (candidate.width ?? 170) / 2;
      const centerY = candidate.position.y + (candidate.height ?? 58) / 2;
      if (centerX >= node.position.x && centerX <= node.position.x + width && centerY >= node.position.y && centerY <= node.position.y + height) {
        members[candidate.id] = { ...candidate.position };
      }
    }
    dragRef.current = { start: { ...node.position }, members };
  }, [nodes]);

  const onNodeDrag = useCallback((_event, node) => {
    const drag = dragRef.current;
    if (!drag || node.type !== "zone") return;
    const dx = node.position.x - drag.start.x;
    const dy = node.position.y - drag.start.y;
    setNodes((current) =>
      current.map((candidate) =>
        drag.members[candidate.id]
          ? { ...candidate, position: { x: drag.members[candidate.id].x + dx, y: drag.members[candidate.id].y + dy } }
          : candidate,
      ),
    );
  }, []);

  const updateNodeData = (id, patch) => {
    setDirty(true);
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== id) return node;
        const data = { ...node.data, ...patch };
        if (patch.label === undefined && patch.sublabel === undefined) return { ...node, data };
        const width = node.width ?? node.measured?.width ?? 170;
        const height = fitNodeHeight({ label: data.label, sublabel: data.sublabel, width, height: node.height ?? node.measured?.height ?? 58 });
        return { ...node, data, width, height };
      }),
    );
    setSelected((current) =>
      current?.kind === "node" && current.node.id === id
        ? { ...current, node: { ...current.node, data: { ...current.node.data, ...patch } } }
        : current,
    );
  };
  const updateEdge = (id, patch) => {
    setDirty(true);
    const { dashed, ...rest } = patch;
    setEdges((current) =>
      current.map((edge) => {
        if (edge.id !== id) return edge;
        const next = { ...edge, ...rest };
        if (dashed !== undefined) {
          next.data = { ...edge.data, style: dashed ? "dashed" : "solid" };
          next.style = dashed ? { strokeDasharray: "6 4" } : {};
        }
        return next;
      }),
    );
    setSelected((current) =>
      current?.kind === "edge" && current.edge.id === id
        ? {
            ...current,
            edge: {
              ...current.edge,
              ...rest,
              data: dashed !== undefined ? { ...current.edge.data, style: dashed ? "dashed" : "solid" } : current.edge.data,
            },
          }
        : current,
    );
  };
  const remove = (id, kind) => {
    setDirty(true);
    if (kind === "edge") {
      setEdges((current) => current.filter((edge) => edge.id !== id));
    } else {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    }
    setSelected(null);
  };

  const addNode = (kind) => {
    const count = nodes.filter((node) => node.type === "topo").length;
    const definition = getTopologyNodeKind(kind);
    setDirty(true);
    setNodes((current) => [
      ...current,
      {
        id: newId("n"),
        type: "topo",
        position: { x: 40 + (count % 6) * 30, y: 40 + (count % 6) * 30 },
        width: 170,
        height: 58,
        data: { label: definition.label, sublabel: "", kind, locked: false, itemRef: "" },
      },
    ]);
  };
  const addZone = () => {
    setDirty(true);
    setNodes((current) => [
      { id: newId("z"), type: "zone", position: { x: 20, y: 20 }, width: 320, height: 220, zIndex: -1, data: { label: "Nueva zona", kind: "generic" } },
      ...current,
    ]);
  };

  const current = useMemo(() => fromFlow(nodes, edges, topologyTitle), [nodes, edges, topologyTitle]);
  const svg = useMemo(() => (showSvg ? renderTopologySvg(current) : ""), [showSvg, current]);

  return (
    <ReadOnlyContext.Provider value={Boolean(readOnly)}>
    <div className="ts-topology">
      <div className="ts-topology-toolbar">
        <strong>{title}</strong>
        {readOnly ? null : (
          <>
            <select aria-label="Agregar componente" value="" onChange={(event) => event.target.value && addNode(event.target.value)}>
              <option value="">+ Agregar componente…</option>
              {TOPOLOGY_NODE_KINDS.map((kind) => <option key={kind.code} value={kind.code}>{kind.label}</option>)}
            </select>
            <button type="button" className="btn-secondary" onClick={addZone}>+ Zona</button>
            {onPropose ? (
              <button type="button" className="btn-secondary" disabled={busy} onClick={onPropose}>
                Proponer desde el playbook
              </button>
            ) : null}
            <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => onSave(current)}>
              Guardar topología
            </button>
            <button type="button" className="btn-link" disabled={!dirty} onClick={() => { setNodes(initial.nodes); setEdges(initial.edges); setDirty(false); }}>
              Descartar cambios
            </button>
          </>
        )}
        <label className="ts-check">
          <input type="checkbox" checked={showSvg} onChange={(event) => setShowSvg(event.target.checked)} />
          Ver como se imprimirá
        </label>
        {extraActions}
      </div>
      <div className="ts-topology-body">
        <div className="ts-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeClick={(_event, node) => setSelected({ kind: "node", node })}
            onEdgeClick={(_event, edge) => setSelected({ kind: "edge", edge })}
            onPaneClick={() => setSelected(null)}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <aside className="ts-inspector-panel">
          <Inspector
            selected={selected}
            quotationItems={quotationItems}
            readOnly={readOnly}
            onChangeNode={updateNodeData}
            onChangeEdge={updateEdge}
            onDelete={remove}
          />
        </aside>
      </div>
      {showSvg ? (
        <div className="ts-svg-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : null}
    </div>
    </ReadOnlyContext.Provider>
  );
}

// Remounts when the stored topology (or a proposed candidate) changes so the canvas starts from it.
export default function TopologyEditor(props) {
  const signature = JSON.stringify(props.value || null) + String(Boolean(props.startDirty));
  return (
    <ReactFlowProvider key={signature}>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
