# Mobile Web UI

本文记录插件 `1.2.0` 的手机 / 折叠屏 Web UI 架构、宿主 DOM 契约、适配器维护方法，以及 OPPO Find N5 手工检查清单。目标是优化手机窄屏和展开态触控体验，同时保留宿主原生控件的状态与行为。

## 布局模式

Skin 在 `(max-width: 640px)` 或 `(any-pointer: coarse) and (max-width: 1366px)` 下启用。小于等于 `640px` 的宽度采用紧凑单栏；触控设备的宽屏 / 折叠屏展开态标记为 `expanded`，保留宿主的 `64px` 导航 rail，不再强制套用手机单栏。

| 状态 | 导航与聊天 | 侧栏 / 右栏 |
| --- | --- | --- |
| 紧凑手机（宽度 ≤ 640px） | 单栏聊天，使用导航 launcher 打开会话侧栏 | 侧栏浮层；右栏全屏浮层 |
| 触控展开态（宽度 > 640px 且 ≤ 1366px） | 保留原生 rail 和 header actions，聊天区使用剩余空间 | 可用宽度 ≥ 1040px 时侧栏停靠（目标宽度约 272px），更窄时以约 340px 浮层打开；右栏通常约占 52vw、最大 520px，原生全屏模式占满视口 |
| 桌面 | 保留宿主布局，不安装 mobile skin | 保留宿主布局 |

停靠阈值以 CSS 布局视口宽度计算。不同设备的系统栏、浏览器工具栏及方向变化会影响可用宽度；样式会使用 safe-area 和 VisualViewport 信息处理边缘与软键盘。

## 侧栏与键盘态

- 侧栏打开（浮层或停靠）时，面板入口以多列网格排列，logo 行、新会话按钮和设置行各自压缩；宿主写在侧栏根节点上的固定 `280px` 宽度改为跟随侧栏宽度。
- 视口高度不超过 `520px` 且软键盘打开时，隐藏会话标签、输入区上方的任务条和用量条，给消息区让出高度。

## 加载与生命周期

- `lib/client.js` 通过宿主的 `require.async('./client.mobile-skin.js')` 和 `require.async('./client.mobile-styles.js')` 并行加载两个同包 chunks，再调用 `installMobileSkin(MOBILE_CSS)`。
- 每个 chunk 通过 `__ModuleLoader__.load({ id: 'dsh-mobile-harness', chunk: 'client.<name>.js', factory })` 注册。资源由宿主依据插件 manifest 和当前 revision 解析；不要手拼资源 URL，也不要添加猜测的 CSS URL。
- `lib/client.mobile-skin.js` 管理匹配媒体查询、DOM 探测、面板状态、键盘与 VisualViewport、手势和清理；`lib/client.mobile-styles.js` 导出 `MOBILE_CSS`，由 skin 注入并在卸载时移除。
- effect 清理会处理加载竞态并调用 disposer。缺少 `require.async`、加载失败或关键 DOM 契约不满足时会发出短警告，不接管原生 UI。
- `package.json` 的 `files` 包含 `lib/**/*`，已覆盖两个 chunks；`MOBILE-UI.md` 随插件包分发。

## 宿主契约

我检查了本机安装包 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 中 `@deepseek-ai/dsh-desktop-runtime` `0.2.1-rc.5` 的模块加载器与 UI bundle。以下结论基于此宿主版本的源码；不代表所有后续版本都保持相同 DOM。

- 模块加载器为 plugin `require` 提供 `require.async('./client.<name>.js')`，要求文件名匹配 `client.*.js`，并检查 chunk 使用正确的 owner id 与 chunk 名注册。宿主基于 boot manifest 中的插件行、入口 bundle URL 与 revision 解析 sibling chunk。
- Shell frame 是三列 grid，带 inline `grid-template-columns`，以及 `[data-sidebar-collapsed]`、`[data-rightbar-collapsed]`、`[data-rightbar-fullscreen]` 等状态属性。右栏具有 `[data-rightbar-col]`；frame、sidebar、center 的 CSS Module 类名会随构建变化，当前类名只用于定位策略，不作为版本稳定 API。
- 右栏在宽度小于 `768px` 时自动进入 fullscreen presentation，宿主仍会渲染右栏，但 `track=false` 令 grid 最后一列保持 `0px`；此时 frame 同时带 `[data-rightbar-collapsed]` 与 `[data-rightbar-fullscreen]`。右栏状态不能只根据最后一列像素宽度判断，也需读取 fullscreen 属性。
- 当前宿主有真实收起按钮 `button[data-sidebar-right-toggle]`，中文 `aria-label` 为「收起右侧边栏」，英文为 `Collapse right sidebar`。它切换右栏 session store 的 `expanded`，随后 `RightbarSeat` 报告 `shown=false` 并调用 `ctx.layout.closeRightbar()`。`button[data-sidebar-right-mode]` 只切换 push / fullscreen presentation，不用作关闭动作。`ctx.layout.closeRightbar()` 是布局服务接口；适配器通过原生收起按钮操作，可同时更新右栏自己的持久化状态。
- 侧栏按钮使用动态 `aria-label` 表示「打开侧边栏 / 收起侧边栏」，新建会话按钮使用「新建会话」。会话是 `[role="treeitem"][data-row-key^="session:"]`，选中态由 `aria-selected` 表示，行内菜单是子按钮。
- 会话 header 含 `[data-conversation-header-leading]`、title row、`headerActions`、`headerUtilities`、tabs。Skin 保留并重排原生 `headerActions`，菜单仍由其原始按钮打开，保持 React 状态、ARIA 与 portal 定位。
- Chat scroll 使用 `[data-conversation-scroll]`；编辑器是 `[role="textbox"][aria-multiline="true"][contenteditable][data-composer-input]`，位于 `[data-composer-seat]`。宿主普通 Enter 会发送 / 排队，因此 mobile skin 在非 IME 组合时将普通 Enter 转成 Shift+Enter 换行；组合输入、Shift/Ctrl/Meta/Alt+Enter 保持宿主处理。
- 设置面板通过 `[role="dialog"]` 且直接子级包含 `<nav>` 识别；portal 菜单探测 `[role="menu"]`、`[role="listbox"]`、命名 tree 和带 `aria-label` 的列表。
- 主题由宿主的 `--dsw-alias-*`、`--dsw-specific-*` tokens 与 `data-ds-dark-theme` 状态驱动。不要用 `prefers-color-scheme` 推断当前 DSH 主题。

## DOM 适配器

适配器将宿主的真实结构映射到 `data-dru-part` token，样式优先使用这些语义标记。标记的选择器来自 `lib/client.mobile-skin.js`：

| 部分 | 选择器 / 语义钩子 | 用途 |
| --- | --- | --- |
| frame | `[class*="_frame"][style*="grid-template-columns"]`；`[data-rightbar-collapsed]`、`[data-rightbar-fullscreen]` | 三列 shell、inline 列宽和右栏 presentation 状态 |
| sidebar / center | `[class*="_sidebarCol"]` / `[class*="_centerCol"]` | 导航列与会话列 |
| rightbar | `[data-rightbar-col]` 或 `[class*="_rightbarCol"]` | 工具侧栏 |
| header | `header`；子节点使用 `[data-conversation-header-leading]` 与 `_headerActions`、`_headerUtilities`、`_titleRow`、`_tabs` 类片段 | 布局和原生操作入口 |
| composer / chat-scroll | `[data-composer-seat]` 或 `_composerSeat`；`[data-conversation-scroll]` | 输入区与消息滚动区 |
| session row | `[role="treeitem"][data-row-key^="session:"]` | 会话切换、关闭 drawer 与误触保护 |
| settings / menu | `[role="dialog"]` + 直接子 `<nav>`；菜单 ARIA role 与命名列表 | portal 内容布局 |

运行时以必需的 `frame`、`center`、`sidebar` 和可解析的 inline grid 列定义作为关键 probe。缺失时，诊断状态为 `partial`，不启用 launcher / panel overlay，并在延迟后输出简短警告。可选子节点缺失时，skin 仍可按可用结构工作。由插件新增的 `data-dru-part` token 会被跟踪并在 disposer 中移除，保留宿主及其他插件的属性。

MutationObserver 在 shell 尚未挂载时短暂观察 body 子树；识别到 frame 后，观察范围缩至 frame、其祖先结构、center 与 portal。变更通过 `requestAnimationFrame` 合并。frame 状态订阅需覆盖右栏属性变化：fullscreen 自动浮层可能不会改变 inline grid track。新宿主版本需核对真实结构、ARIA、inline grid 值及 portal 位置，再调整适配器；不要依赖菜单类名或 hash class。

## 行为与诊断

- VisualViewport `resize` / `scroll` 与窗口方向变化会更新 `--dru-vh`、`--dru-vtop`、`--dru-kb`，编辑器聚焦后滚入可见区域。CSS 使用 `env(safe-area-inset-*)` 适配边缘与 home indicator。
- 打开 drawer / rightbar 时会锁住底层对话交互、管理焦点并添加 history entry；Escape 或浏览器 / Android 返回关闭浮层。会话切换关闭侧栏浮层。
- 从屏幕左缘开始的触控水平滑动可以打开导航；导航内左滑可关闭。编辑器、代码、表格、dialog、menu 与缩放状态会排除在边缘手势之外。
- `window.__dshMobileSkin.getState()` 返回 skin 版本、layout、compatibility、missing、keyboardOpen、overlay、syncCount 和 viewport 尺寸。它不包含会话正文、凭据或设备身份信息。`refresh()` 可要求适配器重新同步。
- 维护时优先保留宿主原生按钮与 ARIA 交互；遇到 DOM 不匹配先检查 `getState().missing` 和浏览器控制台警告，不要用镜像按钮或固定 hash 菜单类绕过契约。

## OPPO Find N5 手工检查

以下是待执行检查清单，不代表已完成 OPPO Find N5 真机验证。建议先在浏览器开发者工具用代表性 viewport 检查布局，再在设备上完成整套操作。

- [ ] 折叠态竖屏：聊天保持单栏；导航 launcher、顶部标题、原生 action、tabs 与输入框不重叠；安全区留白正确。
- [ ] 折叠态横屏：skin 仍启用；侧栏与右栏可以打开、关闭，消息区和 composer 保留可用高度。
- [ ] 展开态竖屏与横屏：保留 `64px` rail；聊天列没有被侧栏或 rightbar 挤压；宽度达到阈值时侧栏停靠，低于阈值时以浮层打开。
- [ ] 展开态右栏：宽度与视口比例合理、内容独立滚动、关闭按钮可触达，不遮挡 composer 的关键操作。
- [ ] 软键盘：聚焦编辑器后输入区上移且光标可见；竖 / 横屏键盘打开、关闭多次后布局恢复；safe-area 底部和系统导航手势区域没有遮挡发送按钮。
- [ ] 输入：普通 Enter 换行；中文拼音等 IME 组合确认期间不误发送；Shift+Enter、快捷发送组合保持预期。
- [ ] 面板操作：点击菜单、切换会话、点击遮罩、Escape、Android 返回逐项检查；导航边缘手势不会拦截代码块、表格或文本选择。
- [ ] 调试控制台检查 `window.__dshMobileSkin.getState()`：目标布局、兼容状态、缺失 probe、键盘和 overlay 状态符合当前视口；页面没有重复 observer / console 警告。

升级宿主或调整 selector 后，重复此清单并记录宿主版本、设备方向与失败项。只有实际完成 Find N5 设备检查后，才能将结果标为真机验证。
