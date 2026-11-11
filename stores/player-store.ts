import { create } from "zustand";
import { StoryRuntime } from "@/lib/story/runtime";
import type { StoryFlowNode, StoryFlowEdge, PlayerState, StoryVariables } from "@/lib/story/types";

interface PlayerStore extends PlayerState {
  runtime: StoryRuntime | null;
  error: string | null;
  question?: string;
  timeoutSecs?: number;
  revision: number;
  init: (
    nodes: StoryFlowNode[],
    edges: StoryFlowEdge[],
    startNodeId: string,
    initialVariables?: StoryVariables,
  ) => void;
  play: () => void;
  pause: () => void;
  onInteractionPoint: (expectedRevision?: number) => void;
  choose: (edgeId: string) => void;
  reset: () => void;
  destroy: () => void;
}
const empty = {
  phase: "idle" as const,
  currentNodeId: null,
  currentVideoUrl: null,
  currentVideoStart: 0,
  currentAudioUrl: undefined,
  currentVideoEnd: undefined,
  interactionAt: undefined,
  choices: [],
  ending: null,
  history: [],
  variables: {},
  trace: [],
  error: null,
  question: undefined,
  timeoutSecs: undefined,
};

export const usePlayerStore = create<PlayerStore>((set, get) => {
  const sync = (runtime: StoryRuntime) => {
    const snapshot = runtime.snapshot();
    const phase = snapshot.ending
      ? "ended"
      : runtime.current.data.nodeType === "choice"
        ? "awaiting"
        : "playing";
    set({
      ...snapshot,
      ...runtime.choiceSettings(),
      phase,
      error: null,
      revision: get().revision + 1,
    });
  };
  const failed = (error: unknown) =>
    set({ phase: "error", error: (error as Error).message, choices: [] });
  return {
    ...empty,
    runtime: null,
    revision: 0,
    init: (nodes, edges, startNodeId, initialVariables) => {
      try {
        const runtime = new StoryRuntime(nodes, edges, startNodeId, initialVariables);
        set({ ...empty, runtime });
        sync(runtime);
      } catch (error) {
        set({ ...empty, runtime: null });
        failed(error);
      }
    },
    play: () => {
      if (get().phase === "awaiting" && !get().choices.length) set({ phase: "playing" });
    },
    pause: () => {
      if (get().phase === "playing") set({ phase: "awaiting", choices: [] });
    },
    onInteractionPoint: (expectedRevision) => {
      const { runtime, phase, revision } = get();
      if (
        !runtime ||
        phase !== "playing" ||
        (expectedRevision !== undefined && expectedRevision !== revision)
      )
        return;
      try {
        if (runtime.isTerminal()) {
          if (runtime.current.data.nodeType !== "ending")
            throw new Error("这条剧情尚未连接到结局，请返回画布完善");
          sync(runtime);
          return;
        }
        const before = runtime.current.id;
        const next = runtime.advance();
        if (next.id === before)
          set({ phase: "awaiting", choices: runtime.getChoices(), ...runtime.choiceSettings() });
        else sync(runtime);
      } catch (error) {
        failed(error);
      }
    },
    choose: (edgeId) => {
      const { runtime, phase } = get();
      if (!runtime || phase !== "awaiting") return;
      try {
        runtime.choose(edgeId);
        sync(runtime);
      } catch (error) {
        failed(error);
      }
    },
    reset: () => {
      const { runtime } = get();
      if (runtime) {
        runtime.reset();
        sync(runtime);
      }
    },
    destroy: () => set({ ...empty, runtime: null, revision: get().revision + 1 }),
  };
});
