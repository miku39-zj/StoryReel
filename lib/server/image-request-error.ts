import { TerminalTaskError } from "@/lib/generation/lifecycle";

/** Classify transport rejection without persisting raw provider bodies or credentials. */
export async function imageRequestError(
  response: Response,
  hasReferences: boolean,
  multipart = false,
) {
  let diagnostic = "";
  try {
    const body = await response.json();
    const error = body?.error ?? body;
    diagnostic = [error?.code, error?.type, error?.message, body?.message]
      .filter((value) => typeof value === "string")
      .join(" ");
  } catch {
    // Non-JSON gateway errors still retain their HTTP status below.
  }
  const prefix = `图片服务请求失败（HTTP ${response.status}）`;
  if (
    /safety system|content[_ ](?:policy|filter)|safety_violations|responsibleai|审核.*拒绝/i.test(
      diagnostic,
    )
  ) {
    const reasons = [
      /self[-_ ]harm/i.test(diagnostic) ? "自伤" : "",
      /violence/i.test(diagnostic) ? "暴力" : "",
    ].filter(Boolean);
    return new TerminalTaskError(
      `${prefix}：内容安全审核拒绝${reasons.length ? `（${reasons.join("、")}）` : ""}。请检查镜头画面描述或联系服务商确认；重复提交相同内容仍可能被拒绝。`,
    );
  }
  if (response.status === 401 || response.status === 403)
    return new TerminalTaskError(
      `${prefix}：认证或访问权限不足，请检查 IMAGE_API_KEY 和模型权限。`,
    );
  if (response.status === 429)
    return new Error(`${prefix}：请求频率或额度受限，请稍后重试并检查服务商额度。`);
  if (hasReferences)
    return new Error(
      `${prefix}：请核对参考图与 /images/edits ${multipart ? "文件上传" : "JSON images"}协议，以及编辑模型和接口地址；未退回纯文生图。`,
    );
  return new Error(
    `${prefix}：${response.status === 400 ? "网关拒绝了生成请求，请核对提示词、模型及生成参数；此状态码不能单独判断为密钥问题。" : "请稍后重试或检查图片服务状态。"}`,
  );
}
