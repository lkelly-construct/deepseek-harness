# Agent Note: App preview card — a live running-app URL loads in the client

Status: implemented

[English](2026-08-18-web-app-preview-card.md) | 中文

## Problem

在 Harness 会话中构建应用的用户，在应用逐步成型时没有任何途径看到运行中的应用。已发布的最近预览——[html preview card](2026-08-17-web-html-preview-card.md)——只能渲染模型通过 `srcdoc` 提供的*静态 HTML 快照*；它无法展示实时开发服务器，因为后者的 HTML、脚本和资源都来自模型通过 bash 启动的服务器。渲染意图词汇表（[tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)）中没有一张卡片表明"此结果是实时的 localhost URL，请在沙箱化的 iframe 中加载"。Claude Code 通过在新窗口打开运行中的应用来回答这一问题；Harness 的 Web GUI 没有这样的实时应用界面。

## Decision

通过扩展已发布的客户端基础组件集，为渲染意图词汇表增加一张 result 侧的 `app-preview` 卡片——不必在 `ToolResultView` 联合类型上新增卡片：客户端通过新的 `appPreviewCardModel` 派生（与 `htmlPreviewCardModel` 平行）读取 `resultView` 中 `card === 'app-preview'` 的值，并绘制新的 `AppPreviewBlock` 基础组件。`AppPreviewBlock` 是 `HtmlPreviewBlock` 的实时应用对应物：一个 `<iframe src={url}>`——因为内容来自正在运行的服务器，所以用 `src` 而非 `srcdoc`——默认 `sandbox="allow-scripts allow-same-origin"`（运行中的应用需要同源访问以加载自身资源）、`referrerPolicy="no-referrer"`、可选的 `width` 视口宽度提示以及一个复制 URL 控件。与 HTML 卡片不同，这里默认开启 `allow-same-origin`，因为真实应用否则无法引用自身的脚本和样式；沙箱仍然是面向用户的最后一道防线，工具可以收窄它。

模型的流程是：先通过 bash 启动应用的开发服务器，从服务器输出中读取 `http://localhost:<port>` URL，再调用某个工具把该 URL 交给 `presentResult`，从而呈现 `app-preview` 卡片。已发布的 demo 实现是 `@deepseek-ai/dsh-tool-app-preview` 示例包：一个 host-only 的 `render_app_url` 工具，通过其 `presentResult` 将模型提供的 URL 带入卡片，由 `apps/cli` 依赖作为锚点，并在 web profile scope 及一个用户 preset 根目录（用于浏览器 demo）中注册。卡片是 result-only 的：待处理状态保持 `GenericCallView`，因为 URL 只在 `execute` 返回后才存在。通用回退会继续渲染面向模型的文本，因此不认识此卡片的客户端不受影响。

客户端接线遵循 [tool-card precedent](2026-07-30-web-read-card.md)：`appPreviewCardModel`、以 `render_app_url` 为 key 注册的 `AppPreviewRow` 键控 toolview、`GenericToolCard` 回退，以及两个渲染站点都会绘制该基础组件。新包与本工具会登记到 `scripts/gen-tool-catalog.ts` 的 `TOOL_PACKAGES` 以及重新生成的 `docs/tool-catalog.md` 中。

## Alternatives considered

**把运行中的应用放进现有 `HtmlPreviewBlock`，将其从 `srcdoc` 切换为 `src`。** 被否决：混用两张卡片会削弱 HTML 卡片的 `allow-scripts` 专有默认值（对不可信标记必须保持关闭 `allow-same-origin`），并模糊工具的意图。静态 HTML 快照与实时服务器 URL 是不同的信任面，应当使用不同的卡片。

**经由 E2B 沙箱路由。** 作为已发布路径被否决：E2B 包是一个 POC，且 app-preview 流程刻意保持开发服务器在本机（通过 bash 启动），因此呈现 URL 无需远程沙箱。将 E2B 端口转发进预览卡片仍可能是后续改进，而非本次改动。

**不经过工具调用，自动检测开发服务器并打开它。** 在此阶段被否决：呈现预览应当是显式、由模型启动的交接（与 HTML 卡片保持由工具驱动的模型可见理由一致），而且在多个进程同时监听时，对"当前"服务器的自动发现是有歧义的。

## Consequences

对其他所有工具而言，客户端界面默认保持通用。结果文本仍然是模型可见内容的唯一真相来源；`app-preview` 卡片像 `web` 一样是呈现层叠加，不具备该能力的 GUI 会回退到面向模型的文本。

运行中的应用预览依赖于 dev 服务器在 iframe 加载那一刻仍可从浏览器访问：工具只呈现该 URL，若服务器已停止，卡片会显示连接错误。本次改动不会启动、探测或保持服务器运行；那是模型通过 bash 负责的事项。

## Testing

单元套件覆盖 `render_app_url` 工具定义与 presenters（`tool-app-preview.spec.ts`）、不变量伴生包（`invariant.spec.ts`）、`AppPreviewBlock` 基础组件（`app-preview-block.client.spec.tsx`），以及 `appPreviewCardModel`/`AppPreviewRow`/`GenericToolCard` 回退渲染站点（`app-preview-card.client.spec.tsx`）。`gen-tool-catalog.spec.ts` 保证会启动新工具并提取其 schema。

## Related

- [tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)
- [2026-08-17-web-html-preview-card](2026-08-17-web-html-preview-card.md) —— 本卡片在其上扩展了实时 URL 变体
- [2026-07-30-web-read-card](2026-07-30-web-read-card.md) —— 本卡片遵循的 result-side 卡片先例