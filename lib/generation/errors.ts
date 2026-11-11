/** Shared presentation of provider diagnostics, including previously persisted task errors. */
export function describeGenerationError(raw: string) {
  const code = "InputImageSensitiveContentDetected.PrivacyInformation";
  if (raw.includes(code))
    return {
      code,
      message: "视频服务拒绝了输入图片，认为图片可能包含真人。AI 生成的人物图也可能触发这项检测。",
      advice: "原图和连线已保留。请按服务商规则确认可用素材；重复提交同一图片仍可能被拒绝。",
      retryable: false,
    };
  return { message: raw, retryable: undefined };
}
