# Local AI Next Edit

[English](README.md) | [简体中文](README-zh.md)

一个轻量级、诊断驱动的 VS Code 本地代码纠错扩展，复用你已经加载到 Ollama 中的模型。

Continue 继续负责普通 FIM 自动补全；Local AI Next Edit 负责修正已经存在的代码。两者使用同一个 `qwen2.5-coder:1.5b`，统一按 **Tab** 接受，并且不调用任何云端 API。

```text
普通代码补全                         已有代码纠错
VS Code → Continue → Ollama          VS Code → Local AI Next Edit → Ollama
                       └──────── 共用 qwen2.5-coder:1.5b ────────┘
```

## 它可以做什么

当你刚编辑过一行，并且 VS Code 在附近报告错误或警告时，扩展可以提出最小修改建议：

```diff
- inport numpy as np
+ import numpy as np

- import nimpy as np
+ import numpy as np

- pritn("hello")
+ print("hello")

- pkt.show()
+ plt.show()
```

按 **Tab** 接受纠错，按 **Esc** 拒绝。纠错建议出现时，它的 Tab 优先级高于普通补全；没有纠错建议时，Tab 仍然正常接受 Continue 的补全。

## 主要功能

- 重写已有代码，而不是把纠错误当作光标位置的 FIM 填空。
- 结合 VS Code diagnostics、最近一次修改和少量附近上下文判断。
- 拼写纠错优先于普通 autocomplete。
- 使用 debounce，并在用户继续输入时立即取消或废弃旧请求。
- 自动修改区域保持很小，拒绝无变化、过大或结构可疑的输出。
- 对上下文明显的标识符拼写错误使用快速路径，例如在附近反复出现 `plt` 时把 `pkt.show()` 修正为 `plt.show()`。
- 提供 inline replacement 预览，同时提供 **Apply Local AI rewrite** Quick Fix。
- 只使用稳定版 VS Code API，不依赖 proposed API。
- AI 建议必须由用户确认，扩展不会直接修改文件。

## 环境要求

- Visual Studio Code `1.136.0` 或更高版本
- Ollama 运行在本机 `http://localhost:11434`
- 已安装 `qwen2.5-coder:1.5b`：

```powershell
ollama pull qwen2.5-coder:1.5b
```

对于 Python，请安装并启用 Pylance 等诊断提供器。自动安全闸有意要求最近修改附近存在 Error 或 Warning。

## 安装

下载 [local-ai-next-edit-0.1.1.vsix](https://github.com/Morgan-Ruijie/local-ai-next-edit/raw/refs/heads/main/local-ai-next-edit-0.1.1.vsix)，然后在 VS Code 中：

1. 打开扩展视图。
2. 点击右上角 `...` 菜单。
3. 选择 **从 VSIX 安装...**，并选择下载的文件。

也可以使用终端安装：

```powershell
code --install-extension local-ai-next-edit-0.1.1.vsix
```

安装后重新加载 VS Code。

## 配置

默认设置：

```json
{
  "localNextEdit.enabled": true,
  "localNextEdit.ollamaUrl": "http://localhost:11434",
  "localNextEdit.model": "qwen2.5-coder:1.5b",
  "localNextEdit.debounceMs": 400,
  "localNextEdit.maxEditLines": 3,
  "localNextEdit.showInlinePreview": true,
  "localNextEdit.keepAlive": "30m"
}
```

只允许 Ollama 回环地址：`localhost`、`127.0.0.1` 和 `::1`。不需要 API key。

## 安全闸如何工作

只有同时满足以下条件时，自动纠错才会运行：

- 功能已启用；
- 当前文件没有被排除；
- 用户刚刚修改了光标附近的文本；
- 修改附近存在 Error 或 Warning diagnostic；
- 用户停止输入的时间超过配置的 debounce；
- 替换内容确实不同、足够小，并且结构合理。

安全闸可以避免小型本地模型持续猜测原本正确的代码，也避免每次击键都争用 Ollama，从而保持 Continue 自动补全流畅。

需要主动重试时，可以在命令面板运行 **Local Next Edit: Check Current Diagnostic**。请求和过滤原因会显示在 **Local AI Next Edit** 输出频道中。

## 与 Continue 共存

本扩展不会读取或修改 Continue 配置。VS Code 可以同时查询多个 inline completion provider；只有安全闸通过时，Local AI Next Edit 才返回纠错建议。普通 FIM autocomplete 仍由 Continue 负责。

两个扩展会复用 Ollama 中同一个 `qwen2.5-coder:1.5b`。默认 `keepAlive` 可以减少请求间卸载模型的情况。无需 GitHub Copilot。

## 隐私与安全

- 请求从 VS Code 直接发送到本机回环地址上的 Ollama。
- 不使用云端模型、遥测服务、API key 或远程项目索引。
- 只发送待编辑行、诊断文本和有限的附近上下文。
- 扩展拒绝非回环 Ollama 地址。
- 修改文件前必须由用户明确接受建议。

## 当前限制

- MVP 主要针对 Python 调优和测试，但实现本身没有写死 Python。
- 自动纠错依赖已安装语言工具提供的 diagnostics。
- 稳定版 inline replacement API 对单行替换最可靠，因此当前仍会拒绝多行模型输出。
- 小模型仍可能漏掉合理修正或生成不佳候选；安全过滤策略倾向于少提示，而不是冒险乱改。

## 开发与测试

```powershell
npm ci
npm test
npm run package
```

`npm test` 会编译 TypeScript 并运行单元测试。`npm run test:ollama` 可以对本机 Ollama 执行可选的真实模型测试。

## 后续计划

- 改进多个 diagnostics 重叠时的候选排序
- 增加更多语言专用的确定性拼写快速路径
- 在稳定版 VS Code API 可以可靠支持后加入多行 inline edit
- 增加轻量的接受/拒绝反馈控制

## 许可证

[MIT](LICENSE)

