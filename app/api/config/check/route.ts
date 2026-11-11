import { NextResponse } from "next/server";
import {
  textConfig,
  mediaConfig,
  imageProtocol,
  audioConfig,
  type ModelConfig,
} from "@/lib/ai/model-config";

/** Expose only readiness and the model override, never credentials or endpoint URLs. */
export async function GET() {
  const configured = (resolve: () => ModelConfig) => {
    try {
      return !!resolve().apiKey;
    } catch {
      return false;
    }
  };
  return NextResponse.json({
    videoModelOverride: process.env.VIDEO_MODEL?.trim() || null,
    openai: !!process.env.OPENAI_API_KEY,
    fal: !!process.env.FAL_API_KEY,
    text: configured(textConfig),
    image: configured(() => {
      imageProtocol();
      return mediaConfig("image");
    }),
    video: configured(() => mediaConfig("video")),
    audio: configured(audioConfig),
  });
}
