# 预览你正在构建的应用

[English](app-preview.md) | 中文

Web UI 可以在沙箱化的窗口中实时渲染代理正在构建的应用。代理启动应用的开发服务器后，会把运行中的 `http://localhost:<port>` URL 以 `app-preview` 卡片的形式呈现在对话中。你可以查看运行中的应用并提出调整，代理再修改代码并重新呈现预览。

## 预览是什么

app-preview 卡片是一个加载运行中应用 dev 服务器 URL 的沙箱化 iframe（使用 `src`，而非静态快照）。它允许脚本与同源访问，使应用能够加载自身资源，但会阻止弹窗与顶层导航。URL 工具栏包含一个复制 URL 的控件。

这是静态 [HTML 预览卡片](../develop/basic/tool.md) 的实时应用对应物。页面原型与静态片段使用 HTML 预览；带脚本和资源的真实运行应用使用应用预览。

## 前置条件

- 已完成[模型配置与工作区设置](./index.md)。
- 一个带有可运行 dev 服务器的项目（例如 Vite 或 `npm run dev` 应用）。
- 一个挂载了 `render_app_url` 工具（`@deepseek-ai/dsh-tool-app-preview`）的 preset。

## 代理如何使用

1. 代理通过 bash 工具运行 dev 服务器。
2. 服务器打印 `http://localhost:<port>`；代理以该 URL 调用 `render_app_url`。
3. GUI 在沙箱化 iframe 中加载该 URL。你可以看到运行中的应用。
4. 你提出更改；代理编辑代码并再次调用 `render_app_url`（如果 dev 服务器热更新，已打开的 iframe 会自动刷新）。

该工具只呈现既有的 URL。它不会启动、探测或保持 dev 服务器运行——那是代理负责的事项。如果服务器不可达，卡片会显示连接错误。

## 在 preset 中配置工具

`@deepseek-ai/dsh-tool-app-preview` 包在 `ctx.tools` 上注册 `render_app_url` 工具。像挂载任何其他工具行一样，把它挂载到 agent preset 中：

```yaml
- id: tool-app-preview
  name: '@deepseek-ai/dsh-tool-app-preview'
```

关于 preset 如何挂载工具，参见[agent preset 配置](../develop/basic/config.md)。

## 安全

预览 iframe 是沙箱化的。默认的 `allow-scripts allow-same-origin` 允许真实应用引用自身的脚本与样式，但沙箱并非针对应用服务器的安全边界——应用自身代码会以加载该页面的进程的网络访问权运行。只加载你信任的应用。

## 已知限制

- 预览取决于 dev 服务器在 iframe 加载时是否可访问；它不会保持服务器运行。
- 未接入远程沙箱的端口转发（例如通过 E2B POC）；dev 服务器在本机运行。
- 该工具在呈现 URL 前不会校验其是否为 localhost 地址。