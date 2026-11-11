import { audioConfig } from "@/lib/ai/model-config";
/**
 * TTS API — POST /api/ai/tts
 * OpenAI TTS (tts-1) → 返回音频 URL 或 base64 data URL
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { sceneId, text } = (await req.json().catch(() => ({}))) as {
    sceneId?: string;
    text?: string;
  };

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  let config: ReturnType<typeof audioConfig>;
  try {
    config = audioConfig();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const OPENAI_API_KEY = config.apiKey;

  // 无 key → 返回 Web Speech API 提示（客户端降级）
  if (!OPENAI_API_KEY) {
    return NextResponse.json({
      audioUrl: null,
      fallback: true,
      message: "AUDIO_API_KEY 未配置，请在客户端使用浏览器 TTS",
    });
  }

  try {
    const res = await fetch(`${config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: text.slice(0, 4096),
        voice: "nova", // 适合中文剧情的女声
        response_format: "mp3",
        speed: 1.0,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS error ${res.status}: ${err}`);
    }

    // 转成 base64 data URL，直接可以塞进 <audio src>
    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const audioUrl = `data:audio/mp3;base64,${base64}`;

    return NextResponse.json({ audioUrl, sceneId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
