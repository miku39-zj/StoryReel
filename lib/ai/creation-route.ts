import type { z } from "zod";
import { createTextProvider, type TextProvider } from "./providers/text-provider";
import { textGenerationError } from "./text-error";
import { creationStream } from "./creation-stream";

/** Shared HTTP lifecycle. Generation callbacks own task prompts and domain validation. */
export function creationRoute<Schema extends z.ZodTypeAny>(
  schema: Schema,
  generate: (
    input: z.output<Schema>,
    provider: TextProvider,
    signal: AbortSignal,
    onChunk?: (text: string) => void,
  ) => Promise<unknown>,
) {
  return async (request: Request) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return Response.json(
        { error: "创作资料无效", details: parsed.error.flatten() },
        { status: 400 },
      );
    let provider: TextProvider | undefined;
    try {
      provider = createTextProvider();
      if (provider.id === "mock")
        return Response.json({ error: "请先配置文本生成服务" }, { status: 503 });
      const configuredProvider = provider;
      if (request.headers.get("accept")?.includes("application/x-ndjson")) {
        return creationStream(
          request.signal,
          (signal, onChunk) => generate(parsed.data, configuredProvider, signal, onChunk),
          (error) => textGenerationError(error, configuredProvider),
        );
      }
      const value = await generate(parsed.data, configuredProvider, request.signal);
      return new Response(JSON.stringify(value), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (error) {
      return Response.json(textGenerationError(error, provider), { status: 502 });
    }
  };
}
