# Agent Note: HTML preview card — sandboxed live rendering reaches the client

Status: implemented

[English](2026-08-17-web-html-preview-card.md) | 中文

## 问题

产生 HTML 的工具（页面原型、图表包装、报告模板）此前无法向用户展示渲染后的结果。线上的结果表面只有面向模型的文本；markdown 渲染器刻意不让原始 HTML 进入 DOM，因此不可信的 HTML 永远不会进入页面（[web-assistant-markdown](2026-07-23-web-assistant-markdown.md)）。用户在这样的 Harness 会话中编辑文件时看到的是标记，而不是页面。Claude Code 用生成 HTML 的实时预览来回答这个问题；Harness 的渲染意图词汇（[tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)）中没有一张卡片能表达"这个结果是 HTML，请在沙箱 iframe 中展示它"。

## 决策

向渲染意图联合类型新增一个仅结果侧的 `html-preview` 卡片。`ToolResultView` 增加 `HtmlPreviewResultView { card: 'html-preview'; title?; html; width?; sandbox? }`。它与 search/web/read 卡片一样仅存在于结果侧：因为 HTML 只有等到 `execute` 返回后才存在，所以等待中的状态保持为 `GenericCallView`。

视图在 `html` 中携带完整 HTML 源码。客户端通过新的 `HtmlPreviewBlock` 原语渲染它：一个 `<iframe srcdoc={html}>`——用 srcdoc，绝不使用 `innerHTML`——默认 `sandbox="allow-scripts"`（不含 `allow-same-origin`，因此预览脚本可以运行但不能触达父页面）、`referrerPolicy="no-referrer"`、可选的 `width` 视口提示，以及复制源码控件。工具可以通过传入 `sandbox`（例如静态页面传 `'none'`）来收窄沙箱，这与其它工具提供的展示字段采用同一信任模型：工具已经产生模型可见的内容，因此沙箱是用户的最后防线，而不是展示层的第一道防线。

客户端接线遵循 [tool-card 先例](2026-07-30-web-read-card.md)：`ui-tool` 中的 `htmlPreviewCardModel` 纯推导读取 `resultView.card === 'html-preview'` 并返回 `HtmlPreviewBlockProps`，两个渲染位——聊天工具行的展开主体（`ToolRow`）与详情面板（`ToolDetails`）——都绘制该原语。通用回退仍然渲染模型可见文本，因此不认识该卡片的客户端不受影响。

## 备选方案

**一个包裹浏览器进程的 bash 变体。** 已否决：用户希望在会话内看到预览，而不是新的操作系统窗口；而且由宿主页面托管的会话无法对派生出的浏览器进程做沙箱隔离。

**拦截助手消息中的 html 围栏。** 此阶段否决：这要求 markdown 管线从不信任的 HTML 中发出 DOM，而这正是 web 客户端刻意不做的事。工具结果是显式、可由模型启动的交接；拦截助手输出会在模型从未要求的地方强行套用预览。

## 权衡

客户端表面对其余所有工具保持默认通用。结果文本仍是模型可见内容的权威；新卡片与 `web` 一样是展示层叠加。

随附的现实化演示是 `@deepseek-ai/dsh-tool-html-preview` 示例包：一个仅宿主的 `render_html` 工具，通过其 `presentResult` 把模型提供的 HTML 带入卡片，挂载进 web profile 作用域（也进部署的用户 preset 根目录以供浏览器演示）。keyless web e2e `apps/web/tests/html-preview.e2e.ts` 在用户 preset 下种子化一个已结束的 `render_html` 回合，并断言沙箱化的 `srcdoc` iframe；同一 preset 上的真实模型回合在实时 GUI 里复现该卡片。

## 相关

- [tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)
- [2026-07-30-web-read-card](2026-07-30-web-read-card.md) — 本卡片遵循的结果侧卡片先例。