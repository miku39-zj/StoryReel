import { NextRequest } from "next/server";

import { buildConfiguredVideoRequest as buildSeedanceRequest } from "@/lib/server/video-request";
import { mediaConfig, providerUrl, modelUrl } from "@/lib/ai/model-config";
import { resolveProviderMedia } from "@/lib/server/provider-media";

export const runtime = "nodejs";

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let config: ReturnType<typeof mediaConfig>;
  let request: ReturnType<typeof buildSeedanceRequest>;
  try {
    config = mediaConfig("video");
    request = buildSeedanceRequest(await resolveProviderMedia(body));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "生成参数无效" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const FAL_API_KEY = config.apiKey;

  if (!FAL_API_KEY)
    return Response.json(
      { error: "请配置 VIDEO_API_KEY（兼容 FAL_API_KEY）后生成视频" },
      { status: 503 },
    );

  const falEndpoint = request.endpoint;
  const falRequestBody = request.input;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(sse({ type: "progress", message: "Submitting to fal.ai…" })),
        );

        const submitRes = await fetch(modelUrl(config, falEndpoint), {
          method: "POST",
          headers: {
            Authorization: `Key ${FAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(falRequestBody),
        });

        if (!submitRes.ok) {
          const errText = await submitRes.text();
          controller.enqueue(
            encoder.encode(sse({ type: "error", message: `fal.ai submit failed: ${errText}` })),
          );
          controller.close();
          return;
        }

        const submitData: {
          request_id?: string;
          status?: string;
          status_url?: string;
          response_url?: string;
        } = await submitRes.json();
        const requestId = submitData.request_id;

        if (!requestId) {
          // Synchronous response
          const submitAny = submitData as Record<string, unknown>;
          const videoUrl =
            (submitAny.video as Record<string, unknown> | undefined)?.url ?? submitAny.video_url;
          if (videoUrl) {
            controller.enqueue(encoder.encode(sse({ type: "result", videoUrl: String(videoUrl) })));
          } else {
            controller.enqueue(
              encoder.encode(sse({ type: "error", message: "No video URL in response" })),
            );
          }
          controller.enqueue(encoder.encode(sse({ type: "done" })));
          controller.close();
          return;
        }

        // Poll for result
        const statusBase = `${modelUrl(config, falEndpoint)}/requests/${encodeURIComponent(requestId)}`;
        const statusUrl = providerUrl(submitData.status_url ?? `${statusBase}/status`, config);
        const resultUrl = providerUrl(submitData.response_url ?? statusBase, config);
        let attempts = 0;
        while (attempts < 60) {
          await new Promise((r) => setTimeout(r, 3000));
          attempts++;

          const statusRes = await fetch(statusUrl, {
            headers: { Authorization: `Key ${FAL_API_KEY}` },
          });
          if (!statusRes.ok) {
            controller.enqueue(
              encoder.encode(sse({ type: "progress", message: `Polling… (attempt ${attempts})` })),
            );
            continue;
          }

          const statusData: { status?: string } = await statusRes.json();
          const status = statusData.status;

          controller.enqueue(
            encoder.encode(sse({ type: "progress", message: `Status: ${status}` })),
          );

          if (status === "COMPLETED") {
            const resultRes = await fetch(resultUrl, {
              headers: { Authorization: `Key ${FAL_API_KEY}` },
            });
            const resultData = await resultRes.json();
            const resultAny = resultData as Record<string, unknown>;
            const videoUrl =
              (resultAny.video as Record<string, unknown> | undefined)?.url ?? resultAny.video_url;
            if (videoUrl) {
              controller.enqueue(
                encoder.encode(sse({ type: "result", videoUrl: String(videoUrl) })),
              );
            } else {
              controller.enqueue(
                encoder.encode(sse({ type: "error", message: "Completed but no videoUrl found" })),
              );
            }
            break;
          }

          if (status === "FAILED" || status === "CANCELLED") {
            controller.enqueue(
              encoder.encode(
                sse({ type: "error", message: `Generation ${status?.toLowerCase()}` }),
              ),
            );
            break;
          }
        }

        if (attempts >= 60) {
          controller.enqueue(
            encoder.encode(sse({ type: "error", message: "Generation timed out" })),
          );
        }

        controller.enqueue(encoder.encode(sse({ type: "done" })));
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sse({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
        controller.enqueue(encoder.encode(sse({ type: "done" })));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
