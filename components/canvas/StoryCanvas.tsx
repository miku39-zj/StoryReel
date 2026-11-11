"use client";

import { shotWorkspaceGraph } from "@/lib/canvas/shot-workspace";
import { CanvasBackground } from "./CanvasBackground";
import { CanvasEntryViewport } from "./CanvasEntryViewport";
import { GraphDebugger } from "./GraphDebugger";
import { GenerationTasks } from "./GenerationTasks";
import { useCallback, useMemo, useState, useEffect, type ReactNode } from "react";
import {
  ReactFlow,
  MiniMap,
  type Connection,
  type EdgeChange,
  type NodeChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  getBezierPath,
  Position,
} from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvas-store";
import { VideoNode } from "./nodes/VideoNode";
import { ChoiceNode } from "./nodes/ChoiceNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { MergeNode } from "./nodes/MergeNode";
import { EndingNode } from "./nodes/EndingNode";
import { TextNode } from "./nodes/TextNode";
import { ImageNode } from "./nodes/ImageNode";
import type { StoryFlowNode, StoryFlowEdge, StoryNodeType } from "@/lib/story/types";

import { connectionNodeOptions } from "@/lib/story/connection-options";
import { NodeConnectionMenu } from "./nodes/NodeConnectionMenu";
import {
  proposeConnection,
  isContextEdge,
  inputRole,
  INPUT_LABELS,
  connectionPortData,
} from "@/lib/story/connections";

// 把自定义节点类型注册给 React Flow
const nodeTypes = {
  video: VideoNode,
  choice: ChoiceNode,
  condition: ConditionNode,
  merge: MergeNode,
  ending: EndingNode,
  text: TextNode,
  image: ImageNode,
};

const defaultEdgeOptions = {
  type: "smoothstep" as const,
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#555" },
  style: { stroke: "#555", strokeWidth: 2 },
};

export function StoryCanvas({ children }: { children?: ReactNode }) {
  const [draft, setDraft] = useState<{
    nodeId: string;
    type: StoryNodeType;
    direction: "input" | "output";
    handleId?: string | null;
    point: { x: number; y: number };
    fromPoint: { x: number; y: number };
  } | null>(null);
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const shotId = useCanvasStore((s) => s.activeShotId);
  useEffect(() => setDraft(null), [shotId]);
  const workspaces = useCanvasStore((s) => s.shotWorkspaces);
  const { nodes, edges } = useMemo(() => {
    const project = useCanvasStore.getState().toProject();
    return project && shotId
      ? shotWorkspaceGraph({ ...project, shotWorkspaces: workspaces }, shotId)
      : { nodes: allNodes, edges: allEdges };
  }, [allNodes, allEdges, shotId, workspaces]);
  const updateNodes = useCanvasStore((s) => s.onNodesChange);
  const updateEdges = useCanvasStore((s) => s.onEdgesChange);
  const updateShotNodes = useCanvasStore((s) => s.updateShotNodes);
  const updateShotEdges = useCanvasStore((s) => s.updateShotEdges);
  const onNodesChange = shotId ? updateShotNodes : updateNodes;
  const onEdgesChange = shotId ? updateShotEdges : updateEdges;
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const addEdgeAction = useCanvasStore((s) => s.addEdge);

  // 把 React Flow 的 onNodesChange 映射到 store
  const handleNodesChange = useCallback(
    (changes: NodeChange<StoryFlowNode>[]) => {
      onNodesChange(applyNodeChanges(changes, nodes));
    },
    [nodes, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<StoryFlowEdge>[]) => {
      onEdgesChange(applyEdgeChanges(changes, edges));
    },
    [edges, onEdgesChange],
  );

  // 新建连接
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        addEdgeAction(
          connection.source,
          connection.target,
          connectionPortData(connection.targetHandle),
        );
      }
    },
    [addEdgeAction],
  );

  // 同步选中状态
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: StoryFlowNode) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        selectNode(null);
        return;
      }
      selectNode(node.id);
    },
    [selectNode],
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: StoryFlowEdge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const context = isContextEdge(edge, nodes);
        return {
          ...edge,
          sourceHandle: "output",
          targetHandle: context ? "context" : "flow-in",
          type: context ? "default" : "smoothstep",
          animated: !context,
          label: context ? INPUT_LABELS[inputRole(edge, nodes)] : edge.data?.choiceLabel,
          labelStyle: { fill: context ? "#ff715b" : "#aaa", fontSize: 11 },
          labelBgStyle: { fill: "#222224" },
          style: { ...edge.style, stroke: context ? "#858587" : "#555", strokeWidth: 1.5 },
        };
      }),
    [edges, nodes],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={displayEdges}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      onMoveEnd={(_event, viewport) => {
        if (shotId) useCanvasStore.getState().saveShotViewport(viewport);
      }}
      onConnectStart={() => setDraft(null)}
      onConnectEnd={(event, state) => {
        const point = "changedTouches" in event ? event.changedTouches[0] : event;
        if (!point) return;
        const target =
          document.elementFromPoint(point.clientX, point.clientY) ??
          (event.target as Element | null);
        if (state.isValid || !state.fromNode || !state.fromHandle || state.toNode || state.toHandle)
          return;
        if (
          !target?.closest?.(".react-flow") ||
          target.closest(
            ".react-flow__node,.react-flow__handle,.react-flow__panel,button,input,textarea,[role=menu]",
          )
        )
          return;
        const direction = state.fromHandle.type === "target" ? "input" : "output";
        const type = state.fromNode.type as StoryNodeType;
        if (!connectionNodeOptions(type, direction).length) return;
        const handle = document.querySelector(
          `.react-flow__handle[data-nodeid="${CSS.escape(state.fromNode.id)}"][data-handleid="${CSS.escape(state.fromHandle.id || "")}"]`,
        );
        const bounds = handle?.getBoundingClientRect();
        if (!bounds) return;
        setDraft({
          nodeId: state.fromNode.id,
          type,
          direction,
          handleId: state.fromHandle.id,
          point: { x: point.clientX, y: point.clientY },
          fromPoint: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        });
      }}
      selectionOnDrag={false}
      selectionKeyCode="Shift"
      panOnDrag={[0, 1]}
      multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      isValidConnection={(connection) =>
        !proposeConnection(
          connection.source!,
          connection.target!,
          nodes,
          edges,
          connectionPortData(connection.targetHandle),
        ).error
      }
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onPaneClick={handlePaneClick}
      minZoom={0.15}
      maxZoom={2}
      deleteKeyCode="Delete"
      proOptions={{ hideAttribution: true }}
    >
      <CanvasBackground />
      <CanvasEntryViewport />
      <GenerationTasks />
      {!shotId && <GraphDebugger />}
      {children}
      {draft && (
        <>
          <svg
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-10 h-full w-full overflow-visible"
          >
            <path
              d={
                getBezierPath({
                  sourceX: draft.fromPoint.x,
                  sourceY: draft.fromPoint.y,
                  targetX: draft.point.x,
                  targetY: draft.point.y,
                  sourcePosition: draft.direction === "input" ? Position.Left : Position.Right,
                  targetPosition: draft.direction === "input" ? Position.Right : Position.Left,
                })[0]
              }
              fill="none"
              stroke="#a1a1aa"
              strokeWidth={1.5}
            />
          </svg>
          <NodeConnectionMenu
            key={`${draft.nodeId}-${draft.direction}-${draft.point.x}-${draft.point.y}`}
            nodeId={draft.nodeId}
            type={draft.type}
            direction={draft.direction}
            handleId={draft.handleId}
            floatingPoint={draft.point}
            onClose={() => setDraft(null)}
          />
        </>
      )}
      <MiniMap
        className="!hidden lg:!block !rounded-xl !border-white/10"
        pannable
        zoomable
        nodeColor={(n) => {
          const t = (n as StoryFlowNode).type as StoryNodeType;
          return (
            {
              video: "#7b7b7d",
              choice: "#f59e0b",
              condition: "#8b5cf6",
              merge: "#22c55e",
              ending: "#ef4444",
              text: "#949496",
              image: "#10b981",
            }[t] ?? "#555"
          );
        }}
        maskColor="rgba(0,0,0,0.7)"
      />
    </ReactFlow>
  );
}
