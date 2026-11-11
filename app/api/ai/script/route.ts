import { creationRoute } from "@/lib/ai/creation-route";
import { storyRequestSchema, generateStory } from "@/lib/ai/story-generation";
export const maxDuration = 360;
export const POST = creationRoute(storyRequestSchema, (input, provider, signal, onChunk) =>
  generateStory(input, provider, signal, undefined, onChunk),
);
