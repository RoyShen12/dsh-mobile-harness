# DSH 0.2.2-rc.1 兼容性审查

## 结论与验证范围

插件 `1.2.0` 已以 mobile skin `2.2.0` 实现分代兼容：DSH `0.2.2-rc.1` 起采用官方原生响应式布局，停用旧 skin 的 DOM / CSS / 键盘 / 浮层接管，保留远程网关、准入、文件传输与 PWA。以下冲突记录解释旧 skin 在新版宿主退出的依据。

本轮对照官方 tag 源码实现兼容保护与定向测试，未升级或启动 `0.2.2-rc.1`。真机回归继续使用当前 `0.2.1-rc.5`（commit `d4db512`），设备为 OPPO Find N5 / PKH110；新版真实渲染、350px 外屏与全部输入法仍待升级后回归。

### 已实现

- Client 根据 boot release 的数字版本（含 rc 阈值）选择新版原生 UI，缺少有效 release 的自定义构建可通过后挂载的原生 drawer 标记识别并保留结果；自定义构建的有效版本标签应与源码相符。
- 原生分支不安装旧 skin / nav fold / listeners，诊断返回 `active:false, compatibility:native, hostVersion`；旧分支保留本轮折叠屏头部和键盘优化。
- 网关安全读取 JSON boot release，phone / tablet 档保留新版宿主 viewport；显式 compat 档继续使用 1280px 缩放画布。
- Host 获取真实 HTTP(S) 上游、兼容 IPv6 与具体地址，cookie bootstrap / HTTP / raw WS / selfcheck 统一传输；TLS 保持证书链与 DNS / IP SAN 身份校验。
- 声明 `@deepseek-ai/dsh-tools` peer，使本地外部 link 插件可由新版 resolver 获取宿主依赖。

### 已执行的针对性测试

- `node --test plugins/dsh-mobile-harness/tools/test-ui-compat.mjs`：版本阈值、Client / gateway 判据一致、新宿主零旧 DOM 接管、迟挂载原生 drawer、viewport 和 PWA metadata。
- `node plugins/dsh-mobile-harness/tools/test-upstream.mjs`：IPv4 / IPv6 / 实际网卡 HTTP，IPv4 / IPv6 HTTPS 的 cookie、HTTP、Origin / Host、自检、WebSocket echo；拒绝未受信和受信但错误 SAN 的证书。
- 修改 JS 的 `node --check` 与 `git diff --check`。
- Plugin Manager 重装返回 `application: applied`。Find N5 当前 `0.2.1-rc.5` 页面加载 skin `2.2.0`，网关 `enabled`，内屏 `691×730` / 外屏 `350×772` 均无页面横向溢出，外屏 drawer 打开 / 关闭正常；内屏键盘态 header 约 `46.9px`，composer 下边界位于 VisualViewport 内。已恢复设备原展开态与方向，未升级 DSH。

来源：[官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)。官方说明涵盖手机 / 平板、软键盘、导航与窄屏，以及会话列表触屏操作、菜单、设置等适配。以下源码链接均固定到该 release tag。

## 必须处理的冲突

### P1：导航抽屉展开状态已脱离 grid 列宽

官方在小于 `768px` 时使用原生 drawer，展开与收起都保持 grid 首列为 `0px`，通过 `data-sidebar-drawer` 和 `data-sidebar-collapsed` 表示状态，并分别管理 mask、sidebar 的 transform / visibility、中心区 inert。

插件 `lib/client.mobile-skin.js` 的 `sync()` 仍通过首列宽度 `>90px` 判断 drawer 展开，`lib/client.mobile-styles.js` 则以该结果控制 sidebar display 和列宽。

- Find N5 外屏 `350px`：旧 skin 继续隐藏 sidebar，宿主已经锁住中心区，出现遮罩下无可用导航的状态。
- 内屏 `691/763px`：官方采用零宽 drawer；旧 skin 强制 `64px` rail，并限制 sidebar 宽度，关闭时留空栏、打开时导航被挤窄。
- compact sidebar 的插件层级为 `12`，官方 mask 为 `70`、sidebar 为 `71`；仅修正展开状态仍会使旧 sidebar 落在遮罩下。

证据：[columns.ts:20–25](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-layout/src/client/columns.ts#L20-L25)、[AppFrame.tsx:170–195](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-layout/src/client/AppFrame.tsx#L170-L195)、[AppFrame.tsx:298–334](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-layout/src/client/AppFrame.tsx#L298-L334)、[AppFrame.module.css:288–340](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-layout/src/client/AppFrame.module.css#L288-L340)。

迁移：新版保留官方 drawer / mask / inert / focus 管理，停用旧 skin 的 frame 列宽、rail、sidebar display / position 与自建浮层。增强代码若确需读取 drawer 状态，应结合上述两个官方属性。

### P1：导航 drawer 被误识别为设置弹窗

官方 sidebar 本体在 drawer 模式带 `role="dialog"`、`data-shortcut-modal="sidebar"`，并保留直接子 `nav.panelList`。插件 `syncPortals()` 以“dialog + 直接子 NAV”识别 settings，会把整个导航抽屉标记为 `settings-dialog`，把 logo、新会话、会话区、footer 当成 `settings-content`，随即套用旧设置全屏 / 双栏 CSS。

证据：[SidebarRoot.tsx:282–295](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L282-L295)、[SidebarRoot.tsx:379–410](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L379-L410)。

迁移：settings 使用明确的 `[data-shortcut-modal="settings"]` 标识；旧结构探测只留给旧宿主，同时排除 sidebar。整套旧 skin 退出时，该误标记路径一并停用。

### P1：设置弹窗已改为四个 grid seat

官方 settings 的直接子级为 `navTitle / nav / header / options`，由 grid 排列；小于 `768px` 原生提供全屏布局和横向导航。插件把所有非 nav 的直接子级统一当作内容包装，施加 flex、padding、overflow hidden：会同时改变标题、关闭按钮区和 options 滚动，破坏新版结构。

证据：[SettingsRoot.tsx:73–110](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-settings-general/src/client/SettingsRoot.tsx#L73-L110)、[SettingsRoot.module.css:95–108](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-settings-general/src/client/SettingsRoot.module.css#L95-L108)、[SettingsRoot.module.css:245–326](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-settings-general/src/client/SettingsRoot.module.css#L245-L326)。

迁移：新版保留官方 settings grid 与 options 自身滚动，停用插件旧 settings 重排。单独的触控增强需在新版布局上重新验证。

### P1：输入区 sticky 被插件覆盖

官方 active 会话的 `composerSeat` 使用 `position: sticky; bottom: 0; z-index: 9`，与滚动正文、composer overlay 及固定菜单 portal 配合。插件的 `[data-dru-part~="composer"]` 规则 specificity 更高，写入 `position: relative; z-index: 7`，会覆盖官方 sticky，输入区可能随长会话滚出可视区。插件对 scrollport 的 flex / overflow 也会改变官方滚动模型。

证据：[ConversationContent.tsx:179–201](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L179-L201)、[ConversationRoot.module.css:465–530](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css#L465-L530)。

迁移：新版退出旧 composer / chat-scroll 布局覆盖，优先保留官方 sticky、滚动锚定与 takeover 布局。

## 应拆除或重新评估的重复接管

### P2：导航入口、焦点和浮层键盘处理重叠

官方 `shell.leading` 已提供稳定 `[data-sidebar-opener]`；导航 drawer 使用 `useModalLayer` 管理 Escape、Tab 和返回焦点。插件另建 launcher、遮罩、focus/inert 与 history entry。旧 `findAction()` 只搜索 sidebar / rightbar / conversation header，也没有搜索新增 shell.leading。

证据：[HeaderLeadingControls.tsx:32–44](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-sidebar/src/client/HeaderLeadingControls.tsx#L32-L44)、[SidebarRoot.tsx:192–203](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L192-L203)、[useModalLayer.ts:46–107](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-primitives/src/useModalLayer.ts#L46-L107)。

迁移：新版仅保留一套 opener / modal owner。Android 返回和边缘手势按真机结果单独增强，避免复用旧浮层状态机。

### P2：菜单尺寸和软键盘策略重复

官方 `useAnchoredPosition` 已根据 VisualViewport 的宽高、offset 和 scale 跟踪菜单位置并设置最大尺寸；手机端减少自动聚焦，发送成功后把焦点交给非编辑控件。插件继续限制所有 menu/listbox 高度、固定整个 frame、修改 viewport meta、调用 scrollIntoView，可能改变官方菜单与光标避让效果。

证据：[useAnchoredPosition.ts:38–118](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-primitives/src/useAnchoredPosition.ts#L38-L118)、[InputBar.tsx:182–228](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx#L182-L228)、[view-binding.ts:12–27](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-conversation/src/client/input/editor/view-binding.ts#L12-L27)。

迁移：新宿主先使用官方 viewport / menu / focus 行为，按实际缺陷添加局部补丁。网关 `interactive-widget=resizes-content` 会影响浏览器键盘 resize 策略，应与原生 viewport 做 A/B 回归。

### P2：Enter 拦截会跳过新版命令菜单与 IME 处理

插件 document capture 把普通 Enter 改发 synthetic Shift+Enter。官方 keymap 对 Shift+Enter直接保留换行，随后才进行 IME 保护、命令菜单仲裁和提交。因此旧拦截会绕过原生的菜单 Enter 选中；在 compositionend 后的延迟 Enter 上，插件也缺少官方 recentlyComposing 保护。

证据：[keymap.ts:257–279](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-conversation/src/client/input/editor/keymap.ts#L257-L279)。

迁移：新版优先保留官方 keymap。若仍要求“手机 Enter 换行”，按输入法与命令菜单状态单独设计，避免 document 全局合成按键。

### P2：页面结构观察可能漏掉重新挂载

官方 center 内新增常驻 `mainPanel` 包装，页面在其内部替换。插件只观察 center 直接 childList；从全局面板切回聊天可能延迟 probe，直到 resize / focus 等其它事件触发。

证据：[AppFrame.tsx:45–50](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-layout/src/client/AppFrame.tsx#L45-L50)。

迁移：若保留局部 DOM 增强，只监听 mainPanel 的结构替换，避免对整个流式聊天树扫描。

## 仍可复用的部分

- **远程服务能力**：网关认证、设备准入、隧道、文件传输与可选手机协助独立于移动皮肤。本轮 Host 静态接口审查另行核对，实际升级后仍需连接回归。
- **PWA**：网关 `injectPwa()` 已去重并替换宿主 manifest / apple-touch-icon。官方原生 PWA metadata 与网关的 `/__pwa/` 资源可沿用现有替换路径；服务端不应同时注入两份 manifest。
- **Client module/chunks**：官方仍支持 `require.async()` 与 package-local chunks；本轮入口 revision 同步方案仍适用。
- **主题 token**：优先保留 token 引用及插件自己面板的 scoped CSS，避免保留针对宿主结构的高优先级覆盖。

CSS Module local 名与 `[hash]_[local]` 模式仍保留，旧选择器会继续命中。因此 `compatibility: ready` 仅说明旧 probe 找到了节点，对新版语义冲突缺乏识别。见 [tsdown.client.ts:871–881](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/tsdown.client.ts#L871-L881)。

## 额外 Host 兼容修复

### 外部 link 安装的宿主依赖

新版 resolver 对外部链接目录仅向声明的 peer 提供宿主包。插件 `phone-tool.js` 顶层导入 `@deepseek-ai/dsh-tools`，此前缺少 peer；新增声明覆盖当前宿主和 `0.2.2-rc.1`。该问题触发于外部 link 安装，默认 npm / tgz 的 profile 内物理副本另有解析路径。

证据：[resolver.ts:636–674](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/app-boot/src/profile-resolution/resolver.ts#L636-L674)。

### 非 loopback / IPv6 / HTTPS 上游

此前上游固定 `http://127.0.0.1:<port>`，遇具体接口监听、IPv6 或原生 TLS 会失败。现优先使用 `webServer.getOrigin()`，旧版缺少该方法时回退端口接口。IPv6 URL authority 与 socket host 分开处理；证书链保持 `rejectUnauthorized:true`，IP 使用 X.509 IP SAN 校验，DNS 使用标准主机名校验。自签 CA 需在 Node 启动前加入 `NODE_EXTRA_CA_CERTS`。

本机 Node `24.18.0` 的 raw TLS IPv6 身份校验出现 DNS 分支误判，因此以 `X509Certificate.checkIP()` 显式核验 IP SAN，未放宽信任链校验。定向测试同时覆盖错误 IP SAN 拒绝。

证据：[webserver:410–436](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/host/webserver/src/index.ts#L410-L436)、[TLS listener:562–575](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/host/webserver/src/index.ts#L562-L575)。

## 升级操作

1. 安装本次插件源码后再升级 DSH；新版手机页面应显示 `compatibility:native`，旧版应显示 `active:true, compatibility:ready`。
2. 默认使用自动 / 手机 / 平板档，保持真实宽度。兼容档继续提供显式 1280px 缩放兜底。
3. 保留网关与已授权设备，整包禁用会同时关闭远程服务。
4. 官方主验收最小宽度为 `390 CSS px`，Find N5 外屏约 `350px`，升级后优先检查该宽度。见 [官方 responsive skill](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/.agents/skills/dsh-responsive-ui/SKILL.md#L8-L16)。

## 升级后验收清单

- Find N5 外屏竖屏、内屏竖屏 / 横屏、折叠切换和分屏窗口；记录 CSS viewport。
- 导航打开 / 关闭、原生 mask、会话切换、全局面板切回、Escape / Android 返回；检查 inert 残留与焦点。
- 设置关闭按钮、横向导航和 options 滚动；工具右栏打开 / 关闭与全屏模式。
- 键盘打开后旋转 / 折叠、长草稿光标、长会话 composer sticky、发送后草稿与焦点。
- 中文候选确认、Enter / Shift+Enter、`/` 与 `@` 菜单、模型菜单、权限菜单；避免向现有运行会话发送测试文本。
- 网关配对、已有授权设备登录、HTTP / WebSocket、文件上传下载、PWA 启动；核对手机页面实际 host release 与皮肤分支。
