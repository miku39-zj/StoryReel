import type { StoryEdgeData, StoryNodeType } from "./types";

export interface ConnectionNodeOption {
  label: string;
  type: StoryNodeType;
  data: StoryEdgeData;
}

const flowInputs: ConnectionNodeOption[] = [
  { label: "上一个视频片段", type: "video", data: { kind: "flow" } },
  { label: "剧情选择入口", type: "choice", data: { kind: "flow" } },
  { label: "条件入口", type: "condition", data: { kind: "flow" } },
  { label: "汇合入口", type: "merge", data: { kind: "flow" } },
];

/** Every rendered port offers node types that can form a valid connection. */
export function connectionNodeOptions(
  type: StoryNodeType,
  direction: "input" | "output",
): ConnectionNodeOption[] {
  if (direction === "input") {
    if (type === "video")
      return [
        { label: "文本提示词", type: "text", data: { kind: "context", inputRole: "prompt" } },
        {
          label: "参考图片",
          type: "image",
          data: { kind: "context", inputRole: "reference-image" },
        },
        { label: "首帧图片", type: "image", data: { kind: "context", inputRole: "first-frame" } },
        { label: "尾帧图片", type: "image", data: { kind: "context", inputRole: "last-frame" } },
        {
          label: "参考视频",
          type: "video",
          data: { kind: "context", inputRole: "reference-video" },
        },
        ...flowInputs,
      ];
    if (type === "image")
      return [
        { label: "文本提示词", type: "text", data: { kind: "context", inputRole: "prompt" } },
        {
          label: "参考图片",
          type: "image",
          data: { kind: "context", inputRole: "reference-image" },
        },
      ];
    return type === "text" ? [] : flowInputs;
  }
  if (type === "text")
    return [
      { label: "生成图片", type: "image", data: { kind: "context", inputRole: "prompt" } },
      { label: "生成视频", type: "video", data: { kind: "context", inputRole: "prompt" } },
    ];
  if (type === "image")
    return [
      {
        label: "作为参考图生成图片",
        type: "image",
        data: { kind: "context", inputRole: "reference-image" },
      },
      {
        label: "作为参考图生成视频",
        type: "video",
        data: { kind: "context", inputRole: "reference-image" },
      },
      {
        label: "作为首帧生成视频",
        type: "video",
        data: { kind: "context", inputRole: "first-frame" },
      },
    ];
  if (type === "ending") return [];
  const options: ConnectionNodeOption[] = [
    { label: "下一视频片段", type: "video", data: { kind: "flow" } },
    { label: "添加剧情选择", type: "choice", data: { kind: "flow" } },
    { label: "添加条件", type: "condition", data: { kind: "flow" } },
    { label: "添加汇合", type: "merge", data: { kind: "flow" } },
    { label: "添加结局", type: "ending", data: { kind: "flow" } },
  ];
  return type === "video"
    ? [
        {
          label: "作为参考视频",
          type: "video",
          data: { kind: "context", inputRole: "reference-video" },
        },
        ...options,
      ]
    : options;
}
