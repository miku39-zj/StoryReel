/** Pure graph traversal, following branchreel's state-machine/controller separation. */
import type {
  StoryFlowNode,
  StoryFlowEdge,
  ConditionNodeData,
  VideoNodeData,
  ChoiceNodeData,
  EndingNodeData,
  PlayerState,
  StoryVariables,
} from "./types";
import { applyVariables, evaluateCondition } from "./variables";
import type { RuntimeTrace } from "./types";
import { expandShotSequences } from "./shot-sequence";
import { storyEdges } from "./connections";

export class StoryRuntime {
  private trace: RuntimeTrace[] = [];
  private readonly nodes: Map<string, StoryFlowNode>;
  private readonly outEdges = new Map<string, StoryFlowEdge[]>();
  private readonly startNodeId: string;
  private currentNodeId: string;
  private path: string[];
  private variables: Record<string, unknown> = {};
  private readonly initialVariables: StoryVariables;

  constructor(
    nodes: StoryFlowNode[],
    edges: StoryFlowEdge[],
    startNodeId: string,
    initialVariables: StoryVariables = {},
  ) {
    this.initialVariables = { ...initialVariables };
    this.variables = { ...initialVariables };
    const sequence = expandShotSequences(nodes, storyEdges(nodes, edges));
    nodes = sequence.nodes;
    edges = sequence.edges;
    if (!nodes.length) throw new Error("StoryRuntime: graph has no nodes");
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    if (this.nodes.size !== nodes.length) throw new Error("StoryRuntime: duplicate node id");
    if (new Set(edges.map((e) => e.id)).size !== edges.length)
      throw new Error("StoryRuntime: duplicate edge id");
    for (const edge of storyEdges(nodes, edges)) {
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target))
        throw new Error(`StoryRuntime: edge "${edge.id}" references a missing node`);
      this.outEdges.set(edge.source, [...(this.outEdges.get(edge.source) ?? []), edge]);
    }
    if (!this.nodes.has(startNodeId))
      throw new Error(`StoryRuntime: start node "${startNodeId}" not found in graph`);
    this.startNodeId = startNodeId;
    this.currentNodeId = startNodeId;
    this.path = [startNodeId];
    if (["merge", "condition"].includes(this.current.data.nodeType)) {
      this.path = [];
      this.jumpTo(startNodeId);
    }
  }
  get current() {
    return this.nodes.get(this.currentNodeId)!;
  }
  get history(): readonly string[] {
    return this.path;
  }

  choose(edgeId: string): StoryFlowNode {
    const choice = this.getChoices().find((c) => c.edgeId === edgeId);
    if (!choice)
      throw new Error(`StoryRuntime: edge "${edgeId}" not found on node "${this.currentNodeId}"`);
    const viaChoice = this.choiceNode();
    const insertAt = this.path.length;
    const skippedChoice = viaChoice && viaChoice.id !== this.currentNodeId;
    const source = viaChoice?.id ?? this.currentNodeId;
    const edge = this.outEdges.get(source)!.find((e) => e.id === edgeId)!;
    const before = { ...this.variables },
      traceLength = this.trace.length;
    if (skippedChoice)
      this.variables = applyVariables(
        this.variables,
        this.outEdges.get(this.currentNodeId)?.[0]?.data,
      );
    let target: StoryFlowNode;
    try {
      target = this.follow(edge);
    } catch (error) {
      this.variables = before;
      this.trace.length = traceLength;
      throw error;
    }
    if (skippedChoice) this.path.splice(insertAt, 0, viaChoice.id);
    return target;
  }

  /** Traverses automatic nodes iteratively; failed traversal never mutates the path. */
  jumpTo(nodeId: string): StoryFlowNode {
    const before = { ...this.variables },
      traceLength = this.trace.length;
    const visited = new Set<string>();
    const traversed: string[] = [];
    try {
      while (true) {
        if (visited.has(nodeId)) throw new Error(`剧情存在自动跳转循环：${nodeId}`);
        visited.add(nodeId);
        const node = this.nodes.get(nodeId);
        if (!node) throw new Error(`StoryRuntime: node "${nodeId}" not found`);
        traversed.push(nodeId);
        if (node.data.nodeType === "merge") {
          const edges = this.outEdges.get(nodeId) ?? [];
          if (edges.length !== 1) throw new Error(`汇合节点 ${nodeId} 需要一条后续路线`);
          this.applyEdge(edges[0]);
          nodeId = edges[0].target;
        } else if (node.data.nodeType === "condition") {
          const edge = this.resolveCondition(node.data, nodeId);
          this.applyEdge(edge);
          nodeId = edge.target;
        } else {
          if (["text", "image"].includes(node.data.nodeType))
            throw new Error("素材节点不能用于播放");
          this.currentNodeId = nodeId;
          this.path.push(...traversed);
          return node;
        }
      }
    } catch (error) {
      this.variables = before;
      this.trace.length = traceLength;
      throw error;
    }
  }

  private applyEdge(edge: StoryFlowEdge) {
    this.variables = applyVariables(this.variables, edge.data);
    this.trace.push({
      nodeId: edge.source,
      edgeId: edge.id,
      message: edge.data?.choiceLabel || `前往 ${edge.target}`,
      variables: { ...this.variables },
    });
  }
  private follow(edge: StoryFlowEdge): StoryFlowNode {
    const before = { ...this.variables },
      traceLength = this.trace.length;
    this.applyEdge(edge);
    try {
      return this.jumpTo(edge.target);
    } catch (error) {
      this.variables = before;
      this.trace.length = traceLength;
      throw error;
    }
  }

  /** A single flow continuation plays immediately; a decision node waits for input. */
  advance(): StoryFlowNode {
    const edges = this.outEdges.get(this.currentNodeId) ?? [];
    if (this.current.data.nodeType === "video" && edges.length === 1) return this.follow(edges[0]);
    return this.current;
  }
  isTerminal(): boolean {
    return (
      this.current.data.nodeType === "ending" || !this.outEdges.get(this.currentNodeId)?.length
    );
  }
  private choiceNode(): StoryFlowNode | undefined {
    if (this.current.data.nodeType === "choice") return this.current;
    const edges = this.outEdges.get(this.currentNodeId) ?? [];
    const next = edges.length === 1 ? this.nodes.get(edges[0].target) : undefined;
    return next?.data.nodeType === "choice" ? next : undefined;
  }
  getChoices() {
    const source = this.choiceNode()?.id ?? this.currentNodeId;
    return (this.outEdges.get(source) ?? []).map((edge) => ({
      edgeId: edge.id,
      label:
        edge.data?.choiceLabel ??
        String(
          this.nodes.get(edge.target)?.data.title ||
            this.nodes.get(edge.target)?.data.label ||
            "继续故事",
        ),
      targetNodeId: edge.target,
    }));
  }
  choiceSettings(): { question?: string; timeoutSecs?: number } {
    const data = this.choiceNode()?.data as ChoiceNodeData | undefined;
    return { question: data?.question, timeoutSecs: data?.timeoutSecs };
  }
  preloadVideoUrls(): string[] {
    const urls = new Set<string>(),
      visited = new Set<string>();
    const queue = (this.outEdges.get(this.currentNodeId) ?? []).map((e) => e.target);
    for (let i = 0; i < queue.length && urls.size < 3; i++) {
      const id = queue[i];
      if (visited.has(id)) continue;
      visited.add(id);
      const node = this.nodes.get(id);
      if (node?.data.nodeType === "video") {
        if (node.data.videoUrl) urls.add(node.data.videoUrl);
      } else queue.push(...(this.outEdges.get(id) ?? []).map((e) => e.target));
    }
    return [...urls];
  }
  reset() {
    this.variables = { ...this.initialVariables };
    this.path = [];
    this.trace = [];
    this.jumpTo(this.startNodeId);
  }
  setVariable(key: string, value: unknown) {
    this.variables[key] = value;
  }
  snapshot(): Omit<PlayerState, "phase"> {
    const data = this.current.data;
    const video = data.nodeType === "video" ? (data as VideoNodeData) : null;
    return {
      currentNodeId: this.currentNodeId,
      currentVideoUrl: video?.videoUrl ?? null,
      currentAudioUrl: video?.audioUrl,
      currentVideoStart: 0,
      currentVideoEnd: video?.clipEnd,
      interactionAt: video?.interactionAt,
      choices: this.getChoices(),
      ending: data.nodeType === "ending" ? (data as EndingNodeData) : null,
      history: [...this.path],
      trace: [...this.trace],
      variables: { ...this.variables },
    };
  }
  private resolveCondition(data: ConditionNodeData, nodeId: string): StoryFlowEdge {
    const { matched, results } = evaluateCondition(data, this.variables);
    this.trace.push({
      nodeId,
      message: `${data.conditionMode === "any" ? "任一" : "全部"}条件：${results.map((r) => `${r.rule.variable}(${JSON.stringify(r.actual)}) ${r.rule.operator} ${JSON.stringify(r.rule.value)} → ${r.matched}`).join("；")}；走 ${matched} 路线`,
      variables: { ...this.variables },
    });
    const next = this.outEdges.get(nodeId)?.find((e) => e.data?.condition === String(matched));
    if (!next) throw new Error(`条件节点 ${nodeId} 缺少 ${matched} 路线`);
    return next;
  }
}
export const createRuntime = (
  nodes: StoryFlowNode[],
  edges: StoryFlowEdge[],
  startNodeId: string,
  initialVariables?: StoryVariables,
) => new StoryRuntime(nodes, edges, startNodeId, initialVariables);
