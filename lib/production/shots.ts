import { z } from "zod";

/** A shared keyframe between consecutive shots. Same ID on both sides means one image, one generation. */
export const keyframeSchema = z.object({
  id: z.string().min(1).max(160),
  /** Human-readable description used as image generation prompt for this frame. */
  description: z.string().min(1),
  /** ID of the selected AssetVersion (image) for this keyframe. Set once image is approved. */
  imageVersionId: z.string().optional(),
  /** Resolved URL of the selected image version. Populated from the asset store at runtime. */
  imageUrl: z.string().optional(),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

export const shotSchema = z.object({
  shotId: z.string().min(1).max(160),
  sceneId: z.string().min(1),
  shotIndex: z.number().int().min(0),
  frameType: z.enum(["远景", "中景", "近景", "特写", "全景"]),
  cameraMove: z.string(),
  lighting: z.string(),
  visualStyle: z.string().optional(),
  characterNames: z.array(z.string().min(1)).max(20).optional(),
  characterDescriptions: z.array(z.string()).optional(),
  speaker: z.string().optional(),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).optional(),
  action: z.string(),
  dialogue: z.string().optional(),
  duration: z.number().positive().max(10),
  imagePrompt: z.string().trim().min(1),
  referenceNodeIds: z.array(z.string().min(1)).max(4).optional(),
  referenceImages: z
    .array(
      z.object({
        nodeId: z.string(),
        url: z.string(),
        description: z.string(),
        revision: z.string(),
      }),
    )
    .max(4)
    .optional(),
  /** Keyframe ID for the opening frame of this shot. Shared with previous shot's lastFrameId for continuity. */
  firstFrameId: z.string().optional(),
  /** Keyframe ID for the closing frame of this shot. Shared with next shot's firstFrameId for continuity. */
  lastFrameId: z.string().optional(),
});
export type StoryboardShot = z.infer<typeof shotSchema>;

/** Legacy mirrors keep the same identity on every reload; AI output reuses matching existing IDs. */
export function normalizeShots(input: unknown, previous: StoryboardShot[] = []): StoryboardShot[] {
  if (!Array.isArray(input)) throw new Error("分镜必须是镜头列表");
  const shots = input.map((raw) => {
    const value = raw as Partial<StoryboardShot>;
    const existing = previous.find(
      (s) => s.sceneId === value.sceneId && s.shotIndex === value.shotIndex,
    );
    return shotSchema.parse({
      ...value,
      referenceNodeIds: value.referenceNodeIds ?? existing?.referenceNodeIds,
      shotId: value.shotId ?? existing?.shotId ?? `shot_${value.sceneId}_${value.shotIndex}`,
    });
  });
  if (
    new Set(shots.map((s) => s.shotId)).size !== shots.length ||
    new Set(shots.map((s) => `${s.sceneId}:${s.shotIndex}`)).size !== shots.length
  )
    throw new Error("镜头 ID 或场景镜号重复");
  return shots;
}
/**
 * Revision hash covering all shot fields. Legacy callers that don't distinguish
 * asset types continue to use this; prefer the three typed helpers below.
 */
export function shotRevision(shot: StoryboardShot): string {
  const fields: unknown[] = [
    shot.shotId,
    shot.sceneId,
    shot.imagePrompt,
    shot.action,
    shot.cameraMove,
    shot.lighting,
    shot.duration,
    shot.dialogue ?? "",
    shot.frameType,
  ];
  // Preserve revisions of previously generated assets when no new continuity fields exist.
  if (shot.visualStyle || shot.characterDescriptions?.length || shot.speaker || shot.voice)
    fields.push(shot.visualStyle, shot.characterDescriptions, shot.speaker, shot.voice);
  if (shot.referenceImages?.length) fields.push(shot.referenceImages);
  return JSON.stringify(fields);
}

/**
 * Revision hash for the keyframe image (first/only frame).
 * Changes when visual content changes; ignores dialogue, action timing and frame IDs.
 */
export function imageRevision(shot: StoryboardShot): string {
  return JSON.stringify([
    shot.shotId,
    shot.sceneId,
    shot.imagePrompt,
    shot.frameType,
    shot.lighting,
    shot.visualStyle ?? "",
    shot.characterDescriptions ?? [],
    shot.referenceImages ?? [],
  ]);
}

/**
 * Revision hash for the video clip.
 * Changes when frame IDs, action, timing or camera move change.
 * Uses legacy shotRevision when no keyframe IDs are present (backward compat).
 */
export function videoRevision(shot: StoryboardShot): string {
  if (!shot.firstFrameId && !shot.lastFrameId) return shotRevision(shot);
  return JSON.stringify([
    shot.shotId,
    shot.sceneId,
    shot.firstFrameId ?? null,
    shot.lastFrameId ?? null,
    shot.action,
    shot.cameraMove,
    shot.duration,
    shot.frameType,
    shot.lighting,
    shot.visualStyle ?? "",
    shot.characterDescriptions ?? [],
  ]);
}

/**
 * Revision hash for the voiceover clip.
 * Changes only when dialogue text, speaker or voice setting change.
 */
export function audioRevision(shot: StoryboardShot): string {
  return JSON.stringify([
    shot.shotId,
    shot.sceneId,
    shot.dialogue ?? "",
    shot.speaker ?? "",
    shot.voice ?? "",
  ]);
}
export function shotPrompt(shot: StoryboardShot) {
  const references = (shot.referenceImages ?? [])
    .map((image, index) => `Reference ${index + 1}: ${image.description}`)
    .join("\n");
  return [
    "Render one cinematic opening frame. Use the starting pose and composition described below.",
    shot.imagePrompt,
    `Upcoming action (context for the opening pose): ${shot.action}`,
    references,
    `Visual style: ${shot.visualStyle ?? "cinematic"}`,
    `Cast (only characters present in this shot): ${(shot.characterDescriptions ?? []).join("; ")}`,
    `Framing: ${shot.frameType}. Lighting: ${shot.lighting}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function shotVideoPrompt(shot: StoryboardShot, hasLastFrame: boolean) {
  return [
    "Generate one continuous shot. Start from the supplied opening image and preserve character identity, costume, props and scene geometry.",
    `Action in order: ${shot.action}`,
    `Camera: ${shot.frameType}, ${shot.cameraMove}. Lighting: ${shot.lighting}.`,
    hasLastFrame
      ? "Finish at the supplied end frame. Build a continuous transition from the opening pose to the ending pose."
      : "Finish on the visible result of the action without changing scenes.",
  ].join("\n");
}

/** Stable role voice, shared by every shot in a project. Explicit voice overrides remain possible. */
export function shotVoice(shot: StoryboardShot): string {
  if (shot.voice) return shot.voice;
  if (!shot.speaker || shot.speaker === "旁白") return "nova";
  const voices = ["alloy", "echo", "fable", "onyx", "shimmer"];
  const hash = Array.from(shot.speaker).reduce((sum, char) => sum + char.codePointAt(0)!, 0);
  return voices[hash % voices.length];
}
