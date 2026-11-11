# 模型与服务配置

在项目根目录创建 `.env.local`，参考 `.env.local.example`。Web 和后台 Worker 均从这里读取；修改配置后需要重启两个进程。配置状态可在首页查看，目前通过文件配置，没有保存密钥的网页表单。

```dotenv
TEXT_PROVIDER=openai
TEXT_BASE_URL=https://text.example.com/v1
TEXT_API_KEY=文本服务密钥
TEXT_MODEL=文本模型名称

IMAGE_BASE_URL=https://image.example.com/fal
IMAGE_API_KEY=图片服务密钥
IMAGE_MODEL=fal-ai/flux/schnell

VIDEO_BASE_URL=https://video.example.com/fal
VIDEO_API_KEY=视频服务密钥
VIDEO_MODEL=seedance-2-0

AUDIO_BASE_URL=https://audio.example.com/v1
AUDIO_API_KEY=配音服务密钥
AUDIO_MODEL=tts-1
```

上面的 example.com 地址仅用于展示独立配置方式，需要替换成实际服务地址；官方地址和默认模型见模板。密钥仅在服务端读取，不使用 `NEXT_PUBLIC_` 前缀，不能提交 `.env.local`。

## 协议与 URL

| 能力 | 协议                                                                                                        | Base URL 的含义                                                                                                         | 模型的含义                                      |
| ---- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 文本 | `TEXT_PROVIDER=openai` 或 `deepseek` 使用 OpenAI 兼容 Chat Completions；`anthropic` 使用 Anthropic Messages | API 根地址，例如 `https://api.openai.com/v1` 或 `https://api.anthropic.com/v1`，不包含 `/chat/completions`、`/messages` | 请求体的模型名称                                |
| 图片 | `IMAGE_PROVIDER=fal` 使用 fal 队列；`openai` 使用 OpenAI 兼容 Images API，Bearer 认证                       | fal 为队列根地址；openai 支持 API 根地址或完整 `/images/generations` 地址                                               | fal 为模型端点路径；openai 为请求体中的模型名称 |
| 视频 | fal 兼容同步结果或队列接口，使用 Seedance 兼容请求参数                                                      | 与图片独立的队列根地址，默认 `https://queue.fal.run`                                                                    | Seedance 别名或兼容端点路径                     |
| 配音 | OpenAI 兼容 Speech，`Authorization: Bearer …`                                                               | API 根地址，实际请求追加 `/audio/speech`                                                                                | 请求体的配音模型名称                            |

图片支持 `IMAGE_PROVIDER=openai` 调用 `/images/generations`；未设置协议但地址以 `/images/generations` 结尾时也会识别为 openai，避免在完整地址后重复追加路径或模型。视频目前仍使用 fal/Seedance 协议，不支持任意视频模型的参数自动转换；fal 代理需将返回的 `status_url`、`response_url`、`cancel_url` 重写到配置的域名及路径前缀下。

视频支持别名 `seedance-2-0`、`seedance-1-0-lite`、`seedance-1-0-pro`，由系统根据输入映射文生视频或图生视频端点。自定义端点直接作为路径使用，仍发送 Seedance 请求字段。显式设置 `VIDEO_MODEL` 会覆盖画布节点默认模型；不设置时保留画布节点模型选择，逐镜默认 Seedance 2.0。

## 生效范围与兼容

配置统一用于剧本/分支/分镜 Agent、图片工具、视频工具、画布任务、逐镜生产和配音 API。文本、图片、视频、配音分别读取自己的 Key，不会因为文本 Key 已配置就被判定为图片或视频服务已配置。

保留旧配置作为回退：`FAL_API_KEY` 可供 fal 图片和视频使用，OpenAI 图片不会回退使用 fal Key；`OPENAI_API_KEY` 可供文本和配音使用。独立配置优先。未设置 `TEXT_PROVIDER` 和其他 `TEXT_*` 时，沿用 Anthropic > OpenAI > DeepSeek 的旧选择顺序；使用独立文本 Key、模型或地址时默认采用 OpenAI 兼容协议，Anthropic 应显式设置 `TEXT_PROVIDER=anthropic`。

已提交任务保存远端请求 ID 和轮询地址。改变模型不会重新提交已有任务；改变 Base URL 后，旧任务地址如果不再属于新地址的域名和路径前缀，将停止访问并报错。恢复这类任务需要恢复原服务地址及其对应 Key。正在运行中的请求使用它提交时解析的配置。

```bash
npm run dev
```

另一个终端启动后台生成：

```bash
npm run worker
```

## 文本节点的生成与错误排查

文字节点点击“生成草稿”后，前端将文字类型、创作要求、已有正文、上游引用与剧情上下文发送到 `POST /api/ai/node-text`。服务端使用 `TEXT_*` 配置，以流式请求直接调用文本服务，在服务端汇总成一份草稿，最长等待 90 秒，不经过图片/视频 Worker。结果先作为可编辑草稿显示，点击采用、替换或追加才写回节点。

`TEXT_PROVIDER=openai` 时，请求地址为 `TEXT_BASE_URL` 后追加 `/chat/completions`。例如 Base URL 为 `https://proxy.example.com/api/proxy/forward`，实际请求就是 `https://proxy.example.com/api/proxy/forward/chat/completions`。

模型正文不要求 JSON；外层 HTTP 响应需要符合所选协议。OpenAI 兼容响应应包含 `choices[0].message.content`。`Invalid JSON response` 既可能表示代理返回 HTML、SSE 或空内容，也可能表示返回了合法 JSON，但 JSON 的字段结构不符合协议，例如把完整响应包装进了 `data` 字段。仅看到这个错误不能认定 Key 未配置。

文字节点现已使用 `stream: true` 消费 SSE 响应；浏览器仍接收完整的 `{text}` JSON 草稿。流中错误、取消或缺少正常结束标记时不返回半截成功结果，也不自动重新提交请求。

文字节点的错误响应现在包含中文说明和 `details`：所选协议、模型、实际请求地址、上游状态码和响应类型。不会返回上游响应正文、请求提示词或密钥。排查时在浏览器 Network 中选择 `/api/ai/node-text`，查看 Response；`/api/canvas/jobs` 的 `workerOnline` 不表示文本模型连接状态。

## 共享文本生成模块

所有生产文本入口统一通过 `lib/ai/text-generation.ts` 调用 SDK，避免各入口分别决定流式与非流式协议：

- `streamTextGeneration` 提供经过检查的完整事件流，并保留工具调用、响应消息和 Token 用量。它统一启用 SSE，关闭 SDK 隐式重试，检查取消与正常结束标记；格式错误和流中错误会向调用方抛出。
- `generateTextDraft` 收集同一个受检查的事件流，返回完整正文和用量。它不解析业务 JSON、不修改项目，也不创建 HTTP 响应。
- `creation-generation.ts` 和故事工具负责提示词以及完整输出的结构、引用和业务校验。大纲工具将 Zod Schema 写入创作要求，并在收齐结果后再次校验，不依赖非流式 `generateObject`。
- Route Handler 负责请求校验与响应格式，使用 `text-error.ts` 格式化模型接口错误。剧本、分支、分镜和场景提示词在结果收齐并校验后返回纯文本；文字节点返回 `{text}` JSON；Agent 保留自己的 SSE 事件协议。
- Agent 使用同一受检查的事件流，继续负责工具执行、循环防护和显式重试策略；文本或工具执行一旦开始，不会因后续流错误重新提交该次模型请求。尚未产生结果的可重试错误沿用原有有限重试规则。

调用方仍负责各自的时间预算与项目应用规则。前端不需要解析模型供应商的原始 SSE，也不会将提前断流的 JSON 当作已完成结果应用。场景提示词接口会先收齐完整正文再返回，响应类型仍为 `text/plain`。

## OpenAI 兼容图片与项目范围 Worker

```dotenv
IMAGE_PROVIDER=openai
IMAGE_BASE_URL=https://image.example.com/v1/images/generations
IMAGE_API_KEY=图片服务密钥
IMAGE_MODEL=服务支持的图片模型
```

`lib/server/openai-image.ts` 负责协议请求和结果解码，同时供逐镜生产、画布节点和图片 Agent 工具复用。队列、租约、版本提交与文件落盘仍由现有模块负责。适配器兼容 `data[0].b64_json` 与 `data[0].url`，格式依据 [OpenAI Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)。图片请求不自动重试。

OpenAI 兼容图片是同步请求：排队任务可跨刷新和进程重启恢复；请求已提交但进程中断、且服务未提供可查询任务 ID 时，不会自动重新提交以免重复计费。界面保留原任务和错误供人工确认。fal 异步任务仍根据保存的外部任务 ID 继续轮询。

使用 `npm run worker -- --project PROJECT_ID --once` 可只处理指定项目的一次任务，去掉 `--once` 则持续处理该项目。项目范围 Worker 使用独立心跳，不会将其他项目标成后台在线；不指定项目则沿用全局 Worker 行为。

## 通用视频网关

`VIDEO_BASE_URL` 填完整创建地址，例如 `http://aigateway.prod.qima-inc.com/yz/v1/videos/generations`，`VIDEO_MODEL` 使用网关对外模型名，例如 `doubao-seedance-2-5`。认证使用 `Authorization: Bearer VIDEO_API_KEY`；密钥不放请求体、浏览器响应或任务账本中。

协议依据：[AI Gateway 视频生成服务接入文档](https://qima.feishu.cn/wiki/ZEA6wyv1iiCMdAkbGdWcMv6UnR3)。

- 图片输入：`materialList` 中每项包含 `type:"image"`、`role:"first_frame"` / `"last_frame"` / `"reference_image"`、`value`、`mimeType`。本地 `/api/media/:id` 在提交时由共享素材解析模块转换为 Data URL，不把 localhost 地址交给上游。
- 首尾帧模式使用 `generationMode:"first_last_frame"`；Seedance 2.5 首帧和首尾帧自动使用 `aspectRatio:"adaptive"`，保持首帧比例。
- 创建回执 `success:true`、`code:200`、`data.taskId` 只表示接收任务。原 taskId 持久化后，每 15 秒向同一网关 `/yz/v1/videos/tasks/query` POST `{taskId}`；查询按文档不携带密钥。
- `PENDING/RUNNING` 继续等待；`SUCCESS` 读取 `videos[0].url`（兼容 `videoUrl`、`outputParams[0].videoUrl`），保存为应用本地媒体后才写成功版本。`FAILED/UNKNOWN` 为终态，停止轮询，不自动重新提交。
- 旧版本保留的 taskId 可以直接恢复查询，无需重新生成；任务查询地址必须匹配当前配置的网关。

`lib/server/gateway-video.ts` 负责参数转换和提交/查询协议，画布与逐镜任务共用。租约、幂等、版本、文件存储和结果回填继续由现有任务与素材模块负责。旧的 fal 直连接口不能用于通用网关，应通过后台任务入口使用。

真实首尾帧验收中，网关已识别本地图片转换后的 Data URL；当前两张人物图被上游以 `InputImageSensitiveContentDetected.PrivacyInformation` 拒绝。此类拒绝保留失败记录和原图，不写成功视频版本，也不自动更换模型、修改图片或重提。即使图片由 AI 生成，上游仍可能判定为真人面孔；此时需要由业务方按服务商规则确认可用素材。
