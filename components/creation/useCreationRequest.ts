"use client";
import { useCallback, useEffect, useRef } from "react";
import { readCreationJSON } from "@/lib/ai/creation-response";

/** Own the request lifetime; domain validation and applying a draft stay with the caller. */
export function useCreationRequest() {
  const active = useRef<AbortController | null>(null);
  const cancel = useCallback(() => active.current?.abort(), []);
  useEffect(() => cancel, [cancel]);
  const request = useCallback(
    async (url: string, input: unknown, onChunk?: (text: string) => void) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        const output = await readCreationJSON(response, onChunk);
        controller.signal.throwIfAborted();
        return output;
      } catch (error) {
        if (controller.signal.aborted) throw new DOMException("已取消生成", "AbortError");
        throw error;
      } finally {
        if (active.current === controller) active.current = null;
      }
    },
    [],
  );
  return { request, cancel };
}
