# DSH Mobile Harness（Android 壳）

把已经在手机上跑通的 DeepSeek Harness 远程网页，封装成一个可安装的 Android App。
基于 **Capacitor 6**（MIT 开源）构建，WebView 加载现有的远程入口，额外补了：

- 首启配置页：服务器地址 + 访问密码（保存在本机，可随时返回修改）；
- **扫码登录**：点「相机扫码」打开全屏取景框，把二维码放进去**自动识别**（不用按快门）；也可「从相册选择」截图；本地用 jsQR 解码，识别出**地址**（二维码不再含密码），识别后**自动填好本机记住的密码并登录**（第一次仍需手填一次并勾「记住地址和密码」）；
- 自动登录：App 原生 `POST {地址}/__verify` 校验密码（首次连接还要在电脑上核对 6 位配对码），成功后把会话 Cookie 写进 WebView；浏览器里打不开（没有 `?p=` 直通链接）；
- **自签证书自动放行**：仅对白名单入口继续加载，其他域名仍然拒绝；0.5.2 起白名单 = `frp-cat.com`、`*.frp-cat.com`、`*.ts.net`、`*.trycloudflare.com`、`*.cfargotunnel.com`、`localhost`、`127.0.0.1` 与私有 IPv4（`10.x` / `192.168.x` / `172.16–31.x`）；
- **手机协助（0.4.6 起，0.4.7 起自动重连，0.5.0 起能读屏点按钮）**：登录后挂着一条长轮询，让电脑上的 agent 通过 `phone` 工具读手机状态（电量/网络/锁屏/前台/版本），并在 **无障碍服务**开启后读屏、点按、输入、滚动、打开 App（支付/银行/密码管理器/系统设置被拦）；令牌只在内存，面板开关默认关闭；
- 返回键先网页后退、回到配置页再退出；
- 蓝色鲸鱼自适应图标（`#2F6BFF` 底 + 白鲸）+ 深色启动图 + 深色状态栏；
- 软键盘兼容：`windowSoftInputMode=adjustResize`、WebView 可聚焦 + 触摸时 `requestFocusFromTouch`、输入框聚焦自动滚动到键盘上方。

## 更新记录

- **1.0.0**：**公开发布版**——品牌改为 **DSH Mobile Harness**（桌面图标名、首页标题、无障碍服务名、相机/设置里的应用名同步改），App 与插件版本号统一到 1.0.0（versionCode **31**）。功能与 0.5.7 一致，这一版只做发布准备：根目录 README / LICENSE（MIT）/ SECURITY / THIRD-PARTY-NOTICES / .gitignore、安装脚本 `scripts/install-plugin.mjs`、APK 改名 `dsh-mobile-harness-1.0.0.apk`。
- **0.5.7**：**漏重启电脑也不会再被冤枉成「密码不正确」**。0.5.6 的票据换会话要电脑上的插件 0.8.2 才认；只装 APK 不重启 DSH 时，旧网关把票据那次请求当密码错（回 `code:"password"`），手机上就弹「密码不正确」。现在 `__dshConnectResult` 认出这种「票据尝试 + 密码错」的组合：手机记着密码就**丢掉票据、用记住的密码自动重试一次**（旧协议本来就能进），没记着就明说「电脑上的 DSH 还没重启（网关还不认扫码票据）：去电脑上退出 DSH 再重新打开，或在下面手填一次密码。」，并且**不**把记住的密码标成错的。versionCode **30** / 0.5.7。配套：插件 0.8.3 起面板「连接」卡底部会写「插件 0.8.3」，重启有没有生效一眼可见。
- **0.5.6**：**扫码不再需要密码**——二维码里从来没有密码，只有一个 24 字符的一次性票据（`?t=`，10 分钟、扫一次即焚，截图外发也只能用一次）。以前 App 把整个 query 丢掉、只留地址，扫码只能靠手机记住的密码，所以密码被清过就永远空着（0.5.4 之后尤其明显）。现在 `completeScan()` 把票据交给原生 `DshApp.connect(base, pw, ticket)`，网关（插件 0.8.2）用 `consumeTicket()` 换会话，密码框空着也能直接登录；记住的密码仍会一起发，老网关照旧走密码。票据用过/过期会提示「这张二维码已经用过了（或超过 10 分钟）：回电脑面板重新扫一张」，且**不会**清掉记住的密码、也不会把它判成错的。versionCode **29** / 0.5.6。注意：插件也要更新到 0.8.2 并重启 DSH，只装 APK 不重启的话旧网关不认识 `ticket` 字段。
- **0.5.5**：**修 0.5.4 的回归「扫码后密码又不自动填了」**——0.5.4 要求「存密码的地址和扫码地址完全一致」才复用，Cloudflare 免费隧道每次重启换域名、换入口、地址写法不同都会被判成「别人的密码」，于是密码框空着，等于把自动填充又关掉了。现在改成**一台手机一份密码**：`savedPasswordFor()` 只在该地址命中 `dsh.pwStale`（已被网关判过密码错）时返回空，其余一律返回记住的那份；`storedBase()` 删除；`completeScan()` 有密码就填 + 260ms 后自动登录。401 仍自动清掉两处存储并提示「记住的密码已经清掉了」。versionCode **28** / 0.5.5。
- **0.5.4**：**密码按地址记 + 失败即清除（只改 App，插件没动，不用重启 DSH）**——根因是密码只有一份、没记它属于哪个地址，换电脑或电脑上改过密码后重新扫码仍拿旧密码去登录，网关回 401，用户只能手动删密码。现在 `app/www/index.html` 里加了一套按 base 索引的凭据助手：`baseKey()`（补 `https://` / 补尾 `/`，取小写 `origin + path`）、`storedBase()`（`dsh.pwBase` → `dsh.url` → 原生 `loadCredentials().url`，兼容旧版）、`savedPasswordFor()`（不同源或命中 `dsh.pwStale` 就返回空）、`forgetPassword()`（localStorage + 原生 `saveCredentials(base, '', true, false)` 一起清）、`markPasswordStale()`；`completeScan()` 改成「有本地址的密码才自动填并自动登录，地址变了就清空密码框」，`__dshConnectResult('password')` 报密码错时自动清掉并提示「记住的密码已经清掉了」。versionCode **27** / 0.5.4。
- **0.5.3**：**登录页三处修复（只改 App，插件没动，不用重启 DSH）**——① **取景框自动扫码**：删掉「拍照扫码」的文件输入，改成「相机扫码」（`getUserMedia` 全屏 `.scanner` 面板，中间方框 + 四角蓝线 + 外圈遮罩挖洞）与「从相册选择」；`scanTick` 每 120ms 只解画面中心 `min(vw,vh)*0.72` 的正方形（缩到 640×640）交给 jsQR（`inversionAttempts: 'attemptBoth'`），**识别到就自动关框并登录**，不用按任何按钮；取消 / 切后台都会 `getTracks().stop()` 释放相机；权限被拒 / 无相机 / 被占用各有中文提示。② **扫码自动填密码**：新增 `completeScan()`，先取 `savedPassword()`（localStorage 优先、回落原生 `DshApp.loadCredentials()`），有密码就 260ms 后自动 `connect()`，没有才 focus 密码框并提示「先手填一次」；`MainActivity.AppSettingsBridge` 新增 `loadCredentials()` / `saveCredentials()`，`verifyAndLoad()` 的 200 与 202 分支都调 `rememberCredentials()`，WebView 存储被清也不再丢密码；补 `setDomStorageEnabled(true)` 与 `setMediaPlaybackRequiresUserGesture(false)`。③ **勾选框左对齐**：`.row` 从继承的 `flex-direction:column` 改成 `row` + `justify-content:flex-start`，`.row input{flex:none;margin:0}`。另加 `android.permission.CAMERA`（运行时授权由 Capacitor 的 `BridgeWebChromeClient.onPermissionRequest` 申请）。versionCode **26** / 0.5.3。
- **0.5.2**：**入口不再只有 frp/ts.net，首页能选四种入口**——`MainActivity.isTunnelHost()` 重写：除原有 `frp-cat.com` / `*.ts.net` / `localhost` 外，放行 **`*.trycloudflare.com`**、**`*.cfargotunnel.com`** 与私有 IPv4（新增 `isPrivateIpv4()`，手写 4 段解析判 `10.x` / `192.168.x` / `172.16–31.x`；`DevicePoller` 复用同一函数，设备通道也一起放开）；`verifyAndLoad` 的 catch 把 `host not allowed` 映射成新 outcome `host`。首页卡片上方新增四个入口 chip（**Tailscale / SakuraFrp / Cloudflare / 局域网**）：`MODES` 表 + `detectMode()` / `paintModes()` / `pickMode()`，**点 chip 只改 placeholder 与高亮、绝不改写输入框**，粘贴地址时自动高亮对应入口；连不上白名单域名时报「这个地址不在 App 支持的入口里：只支持 Tailscale(*.ts.net)、SakuraFrp(frp-cat.com)、Cloudflare(*.trycloudflare.com) 和局域网地址。」versionCode **25** / 0.5.2。
- **0.5.1**：**把「让电脑看屏幕、点按钮」卡先藏起来（版式与连接逻辑没变）**——`app/www/index.html` 里那张 P2 卡片加上 `hidden`，并在样式表补 `[hidden] { display: none !important; }`（`.card` 是 `display:flex`，会盖掉 `hidden` 属性，没这条规则卡片照样显示）。无障碍服务、`DevicePoller`、`AgentGuard` 代码全部保留，验收时去掉 `hidden` 即可恢复入口；此时走系统「设置 → 无障碍 → 已下载的服务 → DSH 远程」启用。versionCode **24**，与插件 dsh-mobile-harness **0.7.0** 配套（面板重排、手机协助段隐藏）。
- **0.5.0**：**读屏与操作（P2「手机是手」）**——App 新增无障碍服务 `DshAgentService`：电脑上的 agent 先 `screen` 拿一份界面快照（最多 60 项，每项带编号 `[n]`、文本、是否可点/可输入），再用编号 `tap` / `long_press` / `type` / `scroll`，或 `key`（返回/桌面/任务/通知）、`open_app`（按应用名或包名）。安全设计：快照 **60 秒过期**、编号或 `snapshot_id` 对不上一律拒绝（绝不"猜着点"）；**跳过 App 自己页面**（防止配对码/密码被念回模型）；密码框显示 `••••`；支付/银行/密码管理器/系统设置整包黑名单，含「转账/付款/验证码/免密」等字样的按钮需用户本人确认。首页新增「让电脑看屏幕、点按钮」卡：一键打开系统无障碍设置、查看服务是否已开启。需配合插件 **dsh-mobile-harness 0.5.0**（`phone` 工具 8 个 action）；插件改动需重启 DSH，**无障碍服务需在手机上手动开启**。详见 `docs/设备准入-验收清单.md` 第 7 节。
- **0.4.7**：**通道自愈（重启电脑端不再让手机静默掉线）**——电脑上的 DSH 一重启，网关里的设备令牌就全没了（只驻内存），旧版本手机只会收到 401 然后安静停掉轮询，只有"网页重新加载"才会再去申请令牌；而远程页一直开着、WebView 不会重载，于是一整晚都显示"手机不在线"。现在：401 → 停轮询 → 自动重新申请令牌，间隔 **15s → 30s → 60s → 120s → 300s 封顶**，拿到令牌立即清零；App 从后台回到前台（`onResume`）立刻再试一次；只在通道没起来时才发请求，正常在线时零额外开销（比原有的 25 秒长轮询还轻）。需配合插件 **dsh-mobile-harness 0.4.1**（只是把"设备已授权但通道没连上"的报错改准确，不重启也能用）。详见 `docs/设备准入-验收清单.md` 第 6 节 35–37 条。
- **0.4.6**：**手机协助（P1「手机是手」）**——App 新增 `DevicePoller`：登录成功后向网关取设备令牌（`POST /__device/token`，只存内存，不落盘、不打日志），然后一直挂着一条长轮询（`POST /__device/poll`，25 秒），收到 `status` 命令就回传电量/充电、网络类型、屏幕是否亮着/锁屏、自己是否在前台、App 版本、Android SDK，再 `POST /__device/result` 交回结果。令牌失效（401，被移除/拉黑/全部下线）立刻停轮询；开关关掉（403）退避 30 秒后自动恢复。新增 `ACCESS_NETWORK_STATE` 权限（读网络类型，不弹任何授权框）。需配合插件 **dsh-mobile-harness 0.4.0**（面板「设备准入 → 手机协助」开关，默认关）；插件改动需重启 DSH。详见 `docs/设备准入-验收清单.md` 第 6 节。
- **0.4.5**：**「下载记录」搬进文件传输**——右下角那个常显的半透明胶囊删掉了（聊天时一直挡着），改成「生活 → 文件 → 文件池」卡片标题右侧的一枚普通按钮（和「刷新」并排）；切到聊天页不会再冒出来，离开生活页按钮自然消失。需要插件 **dsh-life-helper 0.5.2** 提供挂载点 `[data-dsh-dl-mount]`（插件没重启时 hook 会退而把按钮塞进「文件池」标题栏，仍可用）。下载拦截、落盘目录、安装 APK 的行为不变。
- **0.4.4**：**二维码不再含密码 + 配对卡变弹窗**——二维码/链接里删掉 `?p=<密码>`（截图外发也进不来，浏览器直接访问只会看到 403 提示「Access is granted from the DSH Remote app.」）；扫码只识别地址，密码仍需手填。电脑侧待同意的配对卡改成 **DSH 窗口最上层的弹窗**（`shell.overlay`）：不用进「远程」面板，正中间显示 6 位配对码，可「稍后」2 分钟、「拒绝」或「允许 → 数字一致，允许」。需配合插件 **dsh-mobile-harness 0.3.0**，插件改动需重启 DSH。
- **0.4.3**：**首次连接配对码**——新设备等待电脑同意时，手机「等待电脑确认」页显示 **6 位配对码**（30px 等宽大字，如 `482 913`），电脑「远程 → 设备准入」待同意卡片显示同一串；肉眼核对一致后点「允许」→「数字一致，允许」二次确认才放行，网关校验不一致会提示「配对码不一致：请核对手机屏幕上显示的数字」且请求保持等待。需配合插件 **dsh-mobile-harness 0.2.0**（`/__verify` 202 载荷新增 `pairCode`），插件改动需重启 DSH。详见 `docs/设备准入-验收清单.md` 第 1a 节。
- **0.4.2**：**下载记录常显**——生活面板重做为单页（原来的 5 个 tab 合并成「文件」一个模块），「下载记录」胶囊不再依赖 `?life=1`，任何页面右下角都显示；App 侧无其他行为变化。需配合插件 **dsh-life-helper 0.2.2**（单文件池 + 生活页模块 tab）使用，插件改动需重启 DSH。详见 `docs/文件池-验收清单.md`。
- **0.4.1**：**下载修复 + 下载记录**——WebView 原先没有下载通道，点生活助手的「下载」没有任何反应。现在每页注入 `www/download-hook.js`：捕获 `<a download>` / `/api/life-helper.file` 点击 → 页面内用自身 Cookie `fetch`（HttpOnly 会话 Cookie 也能带上）→ base64 分块交给原生 → 写入手机 `下载/DSH/`（Android 10+ 走 MediaStore，无需存储权限）；完成/失败都有 Toast。生活助手页右下角新增「下载记录」悬浮入口，可查看历史、点按打开（APK 会交给系统安装器）、长按删除（连同手机里的文件）、清空记录；另加系统 `DownloadManager` 兜底（`window.open`/blob 等页面钩子接不到的场景）。
- **0.4.0**：**设备准入**——首次连接需在电脑面板点「允许」：手机显示「等待电脑确认」覆盖页（含设备标签与倒计时），原生每 2 秒轮询 `POST /__verify/status`，批准后自动进入，拒绝/超时/超限/拉黑原地提示；网关新增设备状态机（pending/trusted/revoked/blocked）、最大在线设备数、失败限流（5 次/设备、20 次/全局 → 429）、「移除」=断开+撤销信任。配套插件面板新增「设备准入」区（首次连接开关、在线上限、待同意卡片、绿灯置顶/灰灯离线）。
- **0.3.11**：**稳定设备身份**——App 生成安装 ID（SharedPreferences，卸载才变），原生登录带 `X-DSH-Client-Id`，网关用 HMAC 派生稳定 deviceId：即使 Cookie/WebView 数据丢失，也识别为同一台设备；同时修复原生复制 `Set-Cookie` 时丢掉 Max-Age/Expires 导致设备 Cookie 变成会话 Cookie、App 重启即丢失的问题（这是"越登越多设备"的主因）。
- **0.3.10**：**区分 App 与网页**——App 原生登录带 `X-DSH-Client: app` 与版本头（WebView UA 也追加 `DSHRemote/<版本>`），网关为每条会话记录客户端类型与版本；面板设备行显示 `App · Android · Chrome v0.3.10` 或 `网页 · Windows · Chrome`，黑名单条目同样标注来源。
- **0.3.9**：**设备去重**——App 原生校验密码时携带已保存的 `dsh-device` 设备 Cookie，重新登录复用同一设备身份（不再每次生成新设备）；面板按设备聚合显示（同一台设备只占一行，内部保留历史会话），「踢下线」会断开该设备所有会话；新增「清空记录」用于清理历史/重复设备（同时清空黑名单）。
- **0.3.8**：**设备管理（类微信安全登录）**——每次输密码/扫码登录都会登记一条设备会话（设备类型/UA、创建时间、最近活跃、是否在线）；电脑「远程」面板新增「设备管理」：可对单台设备「踢下线」（立即断开其 WebSocket 并要求重新输密码）、「拉黑」（该设备永久禁止登录，可解除）、「全部下线」；被踢/被拉黑后 App 收到 403 会自动回到连接配置页重新登录，拉黑设备会显示"已被拉黑"提示。
- **0.3.7**：**登录重构（无二级界面）**——密码校验改为 App 内原生完成：App 向 `POST {地址}/__verify` 发送 JSON 密码，网关只返回 `{"ok":true/false}`，不渲染任何页面；成功后原生把会话 Cookie 写入 WebView 并直接加载 DSH；失败时配置页原地显示错误、不跳转。扫码二维码携带地址+密码，识别后自动走同一流程直接进入。浏览器直接访问无 Cookie 时返回 403 纯文本（无登录表单），带正确 `?p=` 的链接静默设 Cookie 后 302（仍无界面）。
- **0.3.6**：**密码登录彻底移除**——网关不再有密码页/`/__login`（一律 302 回首页），无论状态如何都不会出现第二层登录；App 配置页去掉「访问密码」「不带密码打开」，只保留地址 + 扫码 + 保持登录；插件面板移除密码相关行，二维码只编码地址（扫码直接进入）。访问控制改为"仅凭外网地址"。
- **0.3.5**：登录界面彻底下线（密码保护关闭时 `/__login` 直接 302 回首页，历史里的旧登录页也无法再登录）；App 从本地配置页跳到远程 UI 后**清空 WebView 历史**，返回键不会再跳回登录/配置页。
- **0.3.4**：登录持久化——配置页新增「保持登录」，保存后下次启动直接进入 DSH、不再显示配置页；返回键行为重做：聊天内返回只做网页后退、根页面返回不再跳回配置页（第一次提示、连续第二次才打开连接设置）；插件「远程」面板新增「重新配置连接」（通过 `DshApp.openSettings()` JS 接口打开本地配置页）。
- **0.3.3**：修复小鲸鱼被永久隐藏（改为只在聊天输入框获得焦点时隐藏、失焦立即恢复）；会话行只保留末尾「…」菜单（归档/固定按钮隐藏、时间让出尾部）；自适应图标改用 PNG 前景，兼容 OriginOS/iQOO 等 OEM 启动器（旧机建议卸载重装以刷新图标缓存）；网关对上游 401/403 自动刷新 DSH 会话并重放一次 GET（宿主代码，需重启 DSH 生效）。
- **0.3.2**：会话列表不再误触重命名（屏蔽双击、标题不可点），每行的「…」操作按钮在手机上常显；视口声明 `interactive-widget=resizes-content`，软键盘弹出时布局随键盘缩放，修复"输入框被顶上去了但点击判定还在原地"的问题（配置页同步声明）。
- **0.3.1**：修复配置页输入框"乱跳/选区丢失/重复输入"（去掉聚焦平滑滚动与每次触摸的 `requestFocusFromTouch`）；聊天输入框普通 Enter 改为换行（转发 Shift+Enter 给 Lexical 编辑器，发送用发送按钮，中文输入法候选确认不受影响）；软键盘打开时自动隐藏右下角小鲸鱼，避免遮挡输入框和发送按钮。
- **0.3.0**：新增扫码登录（拍照 / 从相册选择），jsQR 本地解码，自动填充并进入；配置页提示与布局优化。
- **0.2.0**：修复输入框无法输入（软键盘不弹出/输入无效）；图标改为亮蓝底白鲸，重做自适应/圆形/旧版/启动图/配置页 logo；配置页输入聚焦自动滚动。
- **0.1.0**：首个可安装包（Capacitor 壳、配置页、自动登录、证书白名单、返回键处理）。

## 安装

1. 把 `dist/dsh-mobile-harness-1.0.0.apk` 传到手机（微信文件传输 / 网盘 / USB 均可；也可以让 DSH 把 APK 放进文件池，在手机侧栏「生活 → 文件」点「下载」）；
2. 点击安装，系统提示"未知来源"时允许即可（debug 签名，仅供自用）；
3. 首次打开：先选入口（顶部四个 chip：Tailscale / SakuraFrp / Cloudflare / 局域网），地址默认 `https://frp-cat.com:12345/`；Cloudflare 入口粘 `https://xxx.trycloudflare.com/`，局域网粘 `http://192.168.x.x:64701/`；也可直接「相机扫码」（0.5.3 起：点一下打开取景框，对准就自动识别，首次会弹相机权限）或「从相册选择」导入电脑面板上的二维码（0.8.1 起扫码也要在电脑上核对配对码）；
4. 以后从桌面图标直接进入；需要改地址/密码时，按返回键回到配置页。想在扫码后**自动登录**：手填一次密码并勾上「记住地址和密码」→ 之后扫码会自动填密码并直接登录（0.5.3 起密码同时存原生一份，WebView 数据被清也不会丢；**0.5.5 起密码是一台手机一份**——扫哪个地址（含 Cloudflare 每次换的域名）都会自动填上并直接登录；登录报密码错会自动清掉那份，再扫同一地址不自动填、扫别的地址仍自动填，不用手删）； **0.5.6 起扫码连密码都不需要**：二维码只带一次性票据，网关认票就放行（首次连接仍要在电脑上核对配对码）；票据过期/用过会提示重扫，不会清掉记住的密码。
5. **要用「读屏 + 点按」**（App 0.5.0+，**0.5.1 起卡片默认隐藏，P2 暂缓验收**）：手机「设置 → 无障碍 → 已下载的服务 → DSH Mobile Harness（让电脑看屏幕、点按钮）」→ 开启；要恢复首页那张卡，把 `app/www/index.html` 里的 `hidden` 去掉重新 `cap sync` + 构建。不用时随时在系统设置里关掉。

## 构建（Windows）

前置：JDK 17、Android SDK（platform 34 / build-tools 34）、Node 20+。

```powershell
# SDK 安装位置（本项目使用）：E:\Android\Sdk
$env:ANDROID_HOME='E:\Android\Sdk'
$env:JAVA_HOME='C:\Program Files\Java\jdk-17'
$env:GRADLE_USER_HOME='E:\Android\gradle-home'

cd app
npm install            # 已装过可跳过
npx cap sync android   # 改完 www/ 或 capacitor.config.json 后需要跑
cd android
.\gradlew.bat assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

已针对国内网络配置：

- `gradle-wrapper.properties` 使用腾讯云 Gradle 镜像；
- `android/build.gradle` 增加阿里云 Maven 镜像；
- `local.properties` 指向 `E:/Android/Sdk`（换机器请改）。

图标/启动图生成：`python app/tools/make-icons.py`（用无头 Chrome 渲染鲸鱼 SVG，再用 Pillow 合成各密度资源）。

## 换域名/换隧道时

两处白名单要一起改：

1. `capacitor.config.json` → `server.allowNavigation`（决定是否留在 App 内打开）；
2. `android/app/src/main/java/com/dsh/remote/MainActivity.java` → `isTunnelHost()`（决定是否放行自签证书）。

改完执行 `npx cap sync android` + 重新 `assembleDebug`。

## 已知限制 / 后续

- debug 签名，不可上架；正式分发需要生成 release keystore 并配置 `signingConfigs`；
- 没有离线壳和推送通知（后续可加 Capacitor 插件：`@capacitor/local-notifications` / 服务端 WS 转发）；
- 地址栏随服务器变化：SakuraFrp 换节点后如果域名/端口变了，需要手动更新地址；
- 若以后拿到受信任 HTTPS（自有域名 + Cloudflare/Caddy），可以去掉 SSL 放行逻辑并改做 PWA/TWA。

