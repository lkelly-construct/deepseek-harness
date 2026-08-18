# @deepseek-ai/dsh-tool-html-preview

[English](README.md) | 中文

面向模型的 `render_html` 工具：一个透传式视图生成器，返回展示模型所提供 HTML 的 `html-preview` GUI 卡片。

## 功能

在 `ctx.tools` 上注册一个工具 `render_html({ html, title?, width?, sandbox? })`。该工具是纯粹的透传：`execute` 将模型的 `html` 源码以及可选的 `width`、`sandbox` 提示一并复制到规范视图值中，`presentResult` 返回携带该视图的 `html-preview` 卡片。渲染完全发生在客户端——现有的 `html-preview` GUI 卡片收到 `{ card: 'html-preview', html, width?, sandbox? }` 后，在沙箱化 `<iframe>` 中渲染 HTML（通过 `srcdoc` 传参，从不直接注入 DOM）。本工具只产出卡片视图，不包含任何渲染或 iframe 逻辑。

`width`（整数）是视口宽度提示（像素）；缺省时使用容器自然宽度。`sandbox`（字符串）收窄 iframe 指令；缺省时默认 `allow-scripts`。`title` 作为参数被接受，但不会进入视图或卡片。

## 契约

- **参数**：`html`（字符串，必填）、`title?`、`width?`（整数）、`sandbox?`（字符串）。
- **规范值**：`{ html, width?, sandbox? }`——`html` 源码直接进入视图；未定义的 `width`、`sandbox` 会被完全省略。
- **原生渲染器**：一段简洁文本 `` `Rendered <n> bytes of HTML to the preview card.` ``，指明所提供 HTML 的字节数。
- **卡片**：`presentResult` 从投影视图返回 `{ card: 'html-preview', html, width?, sandbox? }`，使具备能力的 GUI 显示实时预览；不具备该能力的 UI 会回退到面向模型的文本。
- **回放**：视图经 `output.presentationMeta` 投影到 `result.meta` 上，因此会话日志回放可以重建相同的卡片，而无需持久化规范值。

## 导出形状

函数／命名空间插件：导出 `name`/`inject`/`apply`，不提供默认导出。意外的 `export default` 会被 Loader 的 `unwrapExports` 折叠为默认导出，并导致 `inject` 丢失（参见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## 模型体验

### 工具 schema

#### 模型看到的内容

模型会看到生成的 `render_html` schema（[工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-html-preview)）。

#### Token 影响

工具可见的每个请求都有固定的 schema token 开销。模型提供的 `html` 参数也会保留在每个调用的参数中。

#### KV Cache 影响

只要定义和可见性不变，前缀就保持稳定。插件生命周期或 scope 限制可能会使从此 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

每个 `render_html` 调用都会在参数中保留完整 HTML 源码。成功时原样返回 `` `Rendered <n> bytes of HTML to the preview card.` ``。预览本身是 GUI 状态，而非第二条模型消息。

#### Token 影响

token 用量随每次调用提供的 HTML 源码增长，且这些参数会保留到压缩（compaction）。结果本身很小，且形状固定。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与暂缓事项

- **仅透传**——本 demo 工具不对转发的 HTML 做任何净化、转换或预览大小限制；对可能无特权宿主所渲染内容的强制约束，属于本包之后更完善的工具。
- **`title` 被接受但未使用**——该参数为模型声明，但 `presentResult` 尚未将其呈现在卡片上；接入 `HtmlPreviewResultView.title` 字段暂缓。
- **不包含沙箱／iframe 逻辑**——工具只返回卡片视图；渲染与 iframe 强制约束由客户端卡片负责，因此本包无法约束预览中执行的内容。
