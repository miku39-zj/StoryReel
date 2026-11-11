import { creationRoute } from "@/lib/ai/creation-route";
import { creationRequestSchema, generateCreation } from "@/lib/ai/creation-generation";
export const maxDuration = 360;
export const POST = creationRoute(creationRequestSchema, (input, provider, signal, onChunk) =>
  generateCreation("branch", input, provider, signal, onChunk),
);
