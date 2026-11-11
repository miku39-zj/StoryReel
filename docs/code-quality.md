# 代码格式与检查

Prettier 负责统一排版；ESLint 负责 Next.js、React Hooks 和 TypeScript 代码检查。
统一使用两空格缩进、双引号、分号、LF 换行，目标行宽为 100 字符。

| 命令                   | 用途                            |
| ---------------------- | ------------------------------- |
| `npm run format`       | 格式化源码、测试、配置和文档    |
| `npm run format:check` | 检查格式，不修改文件            |
| `npm run lint`         | 检查代码规范                    |
| `npm run lint:fix`     | 修复 ESLint 可自动处理的问题    |
| `npm run typecheck`    | 检查 TypeScript 类型            |
| `npm run check`        | 依次执行格式、ESLint 和类型检查 |
| `npm test`             | 运行单元测试                    |

VS Code / Cursor 安装工作区推荐的 ESLint、Prettier 扩展后，保存时会自动格式化并执行 ESLint 修复。
生成文件、运行时数据、图片、依赖和环境配置不参与格式化。
CommonJS 测试允许使用 `require`；其余代码沿用 Next.js 和 TypeScript 推荐规则。
ESLint 采用零告警门槛，告警或错误都会导致检查失败。

提交前运行 `npm run check`，涉及逻辑修改时再运行 `npm test`。
