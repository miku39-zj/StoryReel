import sharp from "sharp";
import { imageRequestError } from "./image-request-error";
import { providerMediaUrl } from "./provider-media";
import { readProviderJSON } from "./provider-json";
import {
  imageEndpoint,
  imageEditEndpoint,
  mediaConfig,
  type ModelConfig,
} from "@/lib/ai/model-config";
import type { GenerationResult } from "./generation-provider";
import { TerminalTaskError } from "@/lib/generation/lifecycle";

// Includes the gateway's 330-second edit window and the result download.
export const OPENAI_IMAGE_LEASE_MS = 480_000;

async function zodeEditRequest(
  prompt: string,
  images: { image_url: string }[],
  config: ModelConfig,
) {
  const references = images.map(({ image_url }, index) => {
    const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image_url);
    if (!match) {
      throw new TerminalTaskError(
        `第 ${index + 1} 张参考图需要上传到项目素材库后再使用，图片编辑接口要求上传图片文件。`,
      );
    }
    return { bytes: imageBytes(match[3]), mime: match[1], extension: match[2] };
  });
  let [file] = references;
  if (references.length > 1) {
    const tile = 768;
    const background = "#222222";
    const panels = await Promise.all(
      references.map(async ({ bytes }, index) => ({
        input: await sharp(bytes, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(tile, tile, { fit: "contain", background })
          .png()
          .toBuffer(),
        left: (index % 2) * tile,
        top: Math.floor(index / 2) * tile,
      })),
    );
    const bytes = await sharp({
      create: {
        width: tile * 2,
        height: tile * Math.ceil(references.length / 2),
        channels: 3,
        background,
      },
    })
      .composite(panels)
      .png()
      .toBuffer();
    file = { bytes, mime: "image/png", extension: "png" };
    prompt += `\nThe uploaded image is a reference sheet with ${references.length} panels, numbered left to right and then top to bottom in the order listed above. Use these as character and environment references. Render one continuous cinematic shot, with no panels, borders, or reference labels in the output.`;
  }
  const form = new FormData();
  form.set("model", process.env.IMAGE_EDIT_MODEL?.trim() || "gpt-image-2.5-flare");
  form.set("prompt", prompt);
  form.set("n", "1");
  form.set("size", "1024x1024");
  form.set(
    "image",
    new Blob([new Uint8Array(file.bytes)], { type: file.mime }),
    `reference.${file.extension}`,
  );
  return { headers: { "X-Api-Key": config.apiKey }, body: form };
}

function imageBytes(encoded: string) {
  if (encoded.length > 80 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new Error("图片服务返回了无效或过大的 Base64 图片");
  const bytes = Buffer.from(encoded, "base64");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!png && !jpg && !webp) throw new Error("图片服务返回的内容不是 PNG、JPEG 或 WebP 图片");
  return bytes;
}
/** Protocol adapter only: job state, versioning and durable file storage belong to its callers. */
export async function generateOpenAIImage(
  prompt: string,
  options: { signal?: AbortSignal; aspectRatio?: string; referenceImageUrls?: string[] } = {},
  config: ModelConfig = mediaConfig("image"),
): Promise<Extract<GenerationResult, { state: "done" }>> {
  if (!config.apiKey) throw new Error("请配置 IMAGE_API_KEY");
  const references = options.referenceImageUrls ?? [];
  if (references.length > 4) throw new Error("图片生成最多使用 4 张参考图");
  const images = await Promise.all(
    references.map(async (value) => {
      const resolved = String(await providerMediaUrl(value));
      if (resolved.startsWith("data:") && !/^data:image\/(png|jpeg|webp);base64,/.test(resolved))
        throw new Error("参考素材必须是 PNG、JPEG 或 WebP 图片");
      if (resolved.length > 20 * 1024 * 1024) throw new Error("单张参考图超过接口 20 MB 编码限制");
      if (!/^https?:\/\//.test(resolved) && !resolved.startsWith("data:image/"))
        throw new Error("参考图片地址无效");
      return { image_url: resolved };
    }),
  );
  const endpoint = images.length ? imageEditEndpoint(config) : imageEndpoint(config);
  const zodeEdit = images.length > 0 && new URL(endpoint).origin === "https://zode.qa.qima-inc.com";
  const composition = options.aspectRatio
    ? `${prompt}\nComposition aspect ratio: ${options.aspectRatio}.`
    : prompt;
  const request = zodeEdit
    ? await zodeEditRequest(composition, images, config)
    : {
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: images.length
            ? process.env.IMAGE_EDIT_MODEL?.trim() || config.model
            : config.model,
          ...(images.length ? { images } : {}),
          prompt: composition,
          n: 1,
          stream: false,
        }),
      };
  const response = await fetch(endpoint, {
    ...request,
    method: "POST",
    signal: AbortSignal.any([
      AbortSignal.timeout(zodeEdit ? 330_000 : 180_000),
      ...(options.signal ? [options.signal] : []),
    ]),
    redirect: "error",
  }).catch((error: unknown) => {
    if (options.signal?.aborted) throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error("图片服务响应超时，请确认上游结果后再重试。");
    throw new Error("无法连接图片服务，请检查网关地址和网络连接。", { cause: error });
  });
  if (!response.ok) throw await imageRequestError(response, images.length > 0, zodeEdit);
  const data = await readProviderJSON(response);
  const image = data.data?.[0];
  if (typeof image?.b64_json === "string" && image.b64_json)
    return {
      state: "done",
      bytes: imageBytes(image.b64_json),
      extension: "png",
      provider: "openai",
    };
  if (typeof image?.url === "string" && /^https?:\/\//.test(image.url))
    return { state: "done", url: image.url, extension: "png", provider: "openai" };
  throw new Error("图片服务未返回 data[0].b64_json 或 data[0].url");
}
