/** Transport only: progress is provisional; only the validated result is authoritative. */
export function creationStream(
  requestSignal: AbortSignal,
  generate: (signal: AbortSignal, onChunk: (text: string) => void) => Promise<unknown>,
  diagnose: (error: unknown) => { error: string },
) {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancelled.signal]);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      send({ type: "pending" });
      timer = setInterval(() => {
        if (!signal.aborted) send({ type: "pending" });
      }, 15000);
      void (async () => {
        try {
          const value = await generate(signal, (text) => {
            signal.throwIfAborted();
            send({ type: "text", text });
          });
          signal.throwIfAborted();
          send({ type: "result", value });
        } catch (error) {
          if (!signal.aborted) send({ type: "error", ...diagnose(error) });
        } finally {
          clearInterval(timer);
          if (!cancelled.signal.aborted) controller.close();
        }
      })();
    },
    cancel() {
      clearInterval(timer);
      cancelled.abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
