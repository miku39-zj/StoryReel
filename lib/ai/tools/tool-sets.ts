/**
 * Tool Sets — 按 task profile 注册对应工具
 *
 * 用法：buildRegistry(task).injectDeps({ imageProvider, videoProvider })
 */

import { ToolRegistry } from "./registry";
import type { TaskProfile } from "./registry";
import { storyTools } from "./story-tools";
import { mediaTools } from "./media-tools";
import { createImageProvider } from "../providers/image-provider";
import { createVideoProvider } from "../providers/video-provider";

export function buildRegistry(task: TaskProfile): ToolRegistry {
  const registry = new ToolRegistry().setProfile(task);

  switch (task) {
    case "story":
      storyTools.forEach((t) => registry.register(t));
      break;
    case "visual":
      registry.register(mediaTools.find((t) => t.name === "generate_image")!);
      break;
    case "video":
      registry.register(mediaTools.find((t) => t.name === "submit_video_job")!);
      registry.register(mediaTools.find((t) => t.name === "poll_video_job")!);
      break;
    // branch / validate — pure text, no tools needed
  }

  // Inject providers
  registry.injectDeps({
    imageProvider: task === "visual" ? createImageProvider() : undefined,
    videoProvider: task === "video" ? createVideoProvider() : undefined,
  });

  return registry;
}
