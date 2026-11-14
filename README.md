# StoryReel · AI 短剧创作工作台

StoryReel 将故事创意变成可编辑的剧本、视频片段和播放路线。你可以制作一集短剧、按集制作连续剧，或让观众通过选择进入不同剧情。

| 作品类型   | 创作与交付                                                       |
| ---------- | ---------------------------------------------------------------- |
| 单集短剧   | 在一集内讲完故事，按顺序制作片段并导出 MP4。                     |
| 多集连续剧 | 规划全剧和分集剧本，按集组织镜头、检查跨集承接并导出 MP4。       |
| 互动剧     | 在分集剧本里设计选择、条件、汇合和结局，调试路线后发布观看链接。 |

## 本地启动

需要 **Node.js 22.13 或以上**和 npm。导出 MP4 还需要将 `ffmpeg` 和 `ffprobe` 加入 `PATH`。

```bash
git clone https://github.com/miku39-zj/StoryReel.git
cd StoryReel
npm ci
cp .env.local.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。开发命令同时启动 Web 和生成 Worker。

在 `.env.local` 加入 `STORYREEL_GENERATION_MODE=mock` 并重启，可用模拟素材验证图片、视频和配音的任务流程。AI 生成剧本、分支和分镜仍需要文本服务配置。切换到真实素材生成时，移除模拟模式配置并填写相应服务的凭据。

## 创作流程

1. **故事与剧本**。选择作品类型，填写故事创意、题材和风格。多集作品按场景分配集号，互动剧可定义选择及其目标片段。
2. **角色与场景**。生成或导入参考图，为后续画面提供统一的角色外观和场景布局。
3. **分镜与生成**。设计画面、动作和运镜。单击剧情画布上的视频卡打开对应的独立画布，连接文字和图片。可使用首尾帧或多张参考图。跨集接拍时，可截取上一段视频的剪辑出点作为下一段首帧。
4. **预览与交付**。检查播放顺序、素材和互动路线。线性剧导出 MP4，互动剧发布观看链接。

## 生成服务

在 [环境变量模板](.env.local.example) 中，文本、图片、视频和配音的配置各自独立。配置变更后需重启 Web 和 Worker。

| 能力                 | 环境变量前缀 | 接口                                               |
| -------------------- | ------------ | -------------------------------------------------- |
| 剧本、分支、分镜     | `TEXT_`      | OpenAI 兼容 Chat Completions 或 Anthropic Messages |
| 角色、场景、关键画面 | `IMAGE_`     | fal 队列或 OpenAI 兼容 Images API                  |
| 视频片段             | `VIDEO_`     | fal 队列或仓库支持的 Seedance 兼容接口             |
| 配音                 | `AUDIO_`     | OpenAI 兼容 Speech API                             |

密钥保存在服务端的 `.env.local`。Base URL、模型标识、图片编辑和旧配置兼容方式见[模型配置文档](docs/model-configuration.md)。

## 生产运行与数据

生产环境需设置 `STORYREEL_EDITOR_USER` 和 `STORYREEL_EDITOR_PASSWORD`。对外访问时使用 HTTPS。已发布的互动剧观看页允许匿名访问。

```bash
npm run build
npm run start
```

另开终端运行 `npm run worker`。两个进程使用同一个 `STORYREEL_DATA_DIR`，默认是项目下的 `.storyreel/`。SQLite 保存项目、发布记录和任务状态，生成及上传的媒体存放在同一目录下的 `media/`。备份时先停止两个进程，再复制整个数据目录。

## 开发与验证

```bash
npm run typecheck
npm run lint
npm test
```

安装 Playwright Chromium 后，运行 `npm run test:production` 可用临时数据库和模拟服务验证生成任务、素材版本与播放流程。也可通过 `CHROME_PATH` 指定本机 Chrome。运行 `npm run test:e2e` 前需先启动本地开发服务。

项目使用 Next.js、React、TypeScript、React Flow、Zustand 和 SQLite。更多实现细节见[画布工作流](docs/canvas-workflow.md)、[生成架构](docs/generation-architecture.md)和 [AI Agent 架构](docs/ai-agent-architecture.md)。

## 许可证

本仓库已公开。当前尚未附带开源许可证，使用、修改和再分发的授权以仓库所有者明确授予的权限为准。
