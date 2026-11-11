import { omit } from "@/lib/omit";
import type { StoryProject, StoryFlowNode, StoryFlowEdge } from "@/lib/story/types";
import { nanoid } from "nanoid";
export interface GraphFragment {
  nodes: StoryFlowNode[];
  edges: StoryFlowEdge[];
}
export function copyFragment(project: StoryProject, ids: string[]): GraphFragment {
  const selected = new Set(ids);
  return structuredClone({
    nodes: project.nodes.filter((n) => selected.has(n.id)),
    edges: project.edges.filter((e) => selected.has(e.source) && selected.has(e.target)),
  });
}
export function pasteFragment(fragment: GraphFragment, offset = 48): GraphFragment {
  const ids = new Map(fragment.nodes.map((n) => [n.id, `${n.type}_${nanoid(8)}`]));
  return {
    nodes: fragment.nodes.map((n) => {
      const data = omit(n.data, [
        "generationJobId",
        "generationFingerprint",
        "generationVersions",
        "generationError",
      ]);
      return {
        ...structuredClone(n),
        id: ids.get(n.id)!,
        selected: true,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        data: { ...data, generationStatus: "idle" },
      } as StoryFlowNode;
    }),
    edges: fragment.edges.map((e) => ({
      ...structuredClone(e),
      id: `edge_${nanoid(8)}`,
      source: ids.get(e.source)!,
      target: ids.get(e.target)!,
      selected: false,
    })),
  };
}
/** Stable layered layout. Cycles are placed in a final column rather than looping. */
export function layoutGraph(nodes: StoryFlowNode[], edges: StoryFlowEdge[]): StoryFlowNode[] {
  const degree = new Map(nodes.map((n) => [n.id, 0])),
    level = new Map<string, number>();
  for (const e of edges)
    if (degree.has(e.source) && degree.has(e.target))
      degree.set(e.target, degree.get(e.target)! + 1);
  const queue = nodes.filter((n) => degree.get(n.id) === 0).map((n) => n.id);
  queue.forEach((id) => level.set(id, 0));
  for (let i = 0; i < queue.length; i++)
    for (const e of edges.filter((e) => e.source === queue[i] && degree.has(e.target))) {
      level.set(e.target, Math.max(level.get(e.target) ?? 0, (level.get(e.source) ?? 0) + 1));
      degree.set(e.target, degree.get(e.target)! - 1);
      if (degree.get(e.target) === 0) queue.push(e.target);
    }
  const done = new Set(queue),
    last = Math.max(0, ...level.values()) + 1,
    rows = new Map<number, number>();
  return nodes.map((n) => {
    const column = done.has(n.id) ? (level.get(n.id) ?? 0) : last,
      row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { ...n, position: { x: column * 360, y: row * 300 } };
  });
}
export interface ReviewFinding {
  nodeId: string;
  message: string;
}
export function reviewStory(project: StoryProject): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const flow = project.edges.filter((e) => e.data?.kind !== "context");
  for (const node of project.nodes) {
    const out = flow.filter((e) => e.source === node.id);
    if (node.type === "choice") {
      const labels = out.map((e) => e.data?.choiceLabel?.trim()).filter(Boolean);
      if (new Set(labels).size < labels.length)
        findings.push({ nodeId: node.id, message: "存在重复选项名称，观众难以区分。" });
      if (
        out.length > 1 &&
        new Set(out.map((e) => e.target)).size === 1 &&
        !out.some(
          (e) =>
            Object.keys(e.data?.setVariables ?? {}).length || e.data?.variableOperations?.length,
        )
      )
        findings.push({
          nodeId: node.id,
          message: "所有选项进入同一节点且不改变变量，当前选择没有实际区别。",
        });
      if (!String(node.data.question ?? "").trim())
        findings.push({ nodeId: node.id, message: "还没有填写选择问题。" });
    }
    if (node.type === "ending" && !String(node.data.description ?? "").trim())
      findings.push({ nodeId: node.id, message: "结局缺少说明，可补充玩家选择带来的结果。" });
  }
  return findings;
}
