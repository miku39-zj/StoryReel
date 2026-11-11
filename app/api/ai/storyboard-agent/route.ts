import { creationRoute } from "@/lib/ai/creation-route";
import { creationRequestSchema, generateCreation } from "@/lib/ai/creation-generation";
export const maxDuration = 660;
export const POST = creationRoute(creationRequestSchema, (input, provider, signal, onChunk) =>
  generateCreation("storyboard", input, provider, signal, onChunk),
);
