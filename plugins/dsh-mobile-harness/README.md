# DSH Mobile Harness

DeepSeek Harness 插件：把「远程访问」做成 DSH 里的一个开关。开关下面是一块小面板——网关、密码、一次性二维码、五个网络入口、逐台设备准入；连不上时还有一键自检。

**手机端不需要装 App。** 任何浏览器扫一下面板上的二维码、输一次密码，就能接着用电脑上的同一个会话；配套的 Android App（`app/`）是可选的，只多出相机扫码、密码记忆、下载落盘。

## Mobile Web UI

插件 `1.2.0` 将 Mobile Web UI 拆为宿主按需加载的 skin 与 CSS chunks。窄屏手机使用紧凑单栏；宽度不超过 `1366px` 的触控设备（含折叠屏展开态）保留 DSH 原生 `64px` 导航 rail，让聊天区利用展开宽度。侧栏在可用宽度达到 `1040px` 时停靠显示，空间较小时使用浮层；右侧工具栏会按手机或展开态宽度调整。

OPPO Find N5 展开态是手工检查目标，尚无本机实测结论。键盘、安全区、横屏、抽屉与右栏的行为及检查步骤见 [MOBILE-UI.md](MOBILE-UI.md)。

## 安装到主屏幕（PWA）

手机通过 **HTTPS + 受信任证书** 打开网关地址并完成设备准入后，可以直接安装到主屏幕：

- **Android / Chromium**：打开「远程 → 连接与设备」或「界面」，点击「安装到主屏幕」；也可用浏览器菜单的「安装应用 / 添加到主屏幕」。
- **iPhone / iPad**：在 Safari 点「分享 → 添加到主屏幕 → 添加」。
- 从主屏幕启动后使用独立窗口，沿用当前网关的登录和准入规则；如果系统为主屏幕应用使用独立存储，首次启动按页面提示重新登录配对。
- 需要联网且电脑上的 DSH 保持运行；断网导航显示重试页。Service Worker 只处理导航的网络失败，不缓存聊天、文件、API 或登录页面。
- 安装资源使用固定的 `/__pwa/` 路径，manifest 的启动地址为 `/`，不含二维码票据、密码或会话参数。域名或端口变化后需从新地址重新添加，建议使用稳定的 HTTPS 外部隧道。

## 安装

```bash
dsh plugin --profile desktop add dsh-mobile-harness
```

或者从仓库装：

```bash
node scripts/install-plugin.mjs --profile desktop   # 写依赖 + bundle 条目，幂等
```

通过当前 DSH 的 Plugin Manager 安装时，启用 HMR 的 profile 可立即加载，按安装结果的 `application` / `nextStep` 操作；会话侧栏出现「远程」。使用旧版宿主或仅在外部脚本中同步文件时，需触发插件重载或按提示重启。

## 使用

1. 侧栏「远程」→ 右上角开关打开。
2. 选网络入口（推荐**外部隧道**或 **Cloudflare**，见下）。
3. 手机扫码：等待页显示 6 位配对码 → 电脑面板「设备准入」核对同一串 → 点「允许」→「数字一致，允许」。

## 五个网络入口

| 入口 | 推荐度 | 说明 |
| --- | --- | --- |
| **局域网 / 虚拟组网** | ✅ **推荐（同网段）** | 手机和电脑同一个 Wi-Fi；或两端都连着皎月连 / ZeroTier / Radmin 这类虚拟组网。网关监听所有网卡，面板列出本机每个 IPv4，**点「用这个」可以把二维码钉在指定的那张网卡上**（例如皎月连的 `10.6.22.1`）；不出公网，延迟最低 |
| **SakuraFrp / 任意外部隧道** | ✅ 推荐（跨网） | 填外网地址（如 `https://frp-cat.com:12345/`）；「自动检测」会读 SakuraFrp 运行日志，并核对隧道本地端口和网关端口。地址稳定 |
| **Cloudflare 快速隧道** | ✅ 推荐（零准备） | 免账号：插件自己下 `cloudflared`（约 50 MB，带进度条）并建 quick tunnel；地址每次重启都变 |
| **仅本机** | 本机调试 | 仅回环监听，手机需通过 HTTPS 隧道接入 |
| **Tailscale** | ⚠️ 不推荐 | 能穿 NAT，但常走 DERP 中继，延迟明显偏高；只在内网直连时考虑 |
| **仅本机** | 🛠 调试用 | 只监听 `127.0.0.1`，手机连不上；本机排查时用 |

## 手机连不上？先自检

面板「网络入口」下面有个 **一键自检** 按钮：它按手机请求经过的顺序逐段检查（总开关 → 网关 → DSH 本体 → 隧道 → 外网地址 → 设备准入），每一项给出绿 / 黄 / 红，红色那行就是断点，下面灰字直接写改法。

命令行也能跑（只读，不绑端口、不改状态，DSH 没启动也能用）：

```bash
node tools/diagnose.mjs          # 彩色报告
node tools/diagnose.mjs --json   # 机器可读
```

典型输出：

```
 ✓ 总开关：已打开
 ✗ 隧道本地端口：隧道转发到 64701，但系统禁止绑定这个端口（EACCES）；网关在 64900
     → 把 SakuraFrp 里这条隧道的「本地端口」改成 64900，保存即恢复，不用重启 DSH
```

## 设备准入

- 三层：密码 → 6 位配对码两端核对 → 设备白名单。**扫码本身不放行**，浏览器和 App 走同一套 `admitDevice()`。
- 在线上限按活跃登录会话计数（0 = 不限，同一会话多开页面共享额度），覆盖 App、脚本与浏览器；待同意队列最多 3 个，5 分钟过期。
- 设备列表在线绿点置顶、离线灰灯排后；移除会断开并撤销该标识的信任，拉黑会拒绝该设备标识。失窃处置使用全部下线与密码重置。
- 「全部下线」「清空记录」「诊断包」（白名单字段，不含密码 / session / 设备 token）。

## 面板

1. **连接** —— 二维码（fragment 中的一次性票据，10 分钟、成功准入后失效，默认模糊点开显示）+ 状态 + 在线统计（设备 / 页面）+ 网址 + 密码（本机按需显示 / 复制 / 重置，30 秒后清除）。密码验证始终开启。
2. **网络入口** —— 五选一 + 外网地址（保存 / 自动检测）或 Cloudflare 隧道行（进度条 + 速度 + 剩余时间）。
3. **设备准入** —— 首次连接（需同意 / 免同意）、在线上限、待同意卡片（放大配对码 + 二次确认）、设备行（移除 / 拉黑 / 解除）。

管理接口仅在本机 DSH 连接可用，网关拒绝转发。状态快照隐藏明文密码与真实设备标识。密码重置立即撤销全部会话、设备信任、审批认证证明与手机令牌。

开关、密码、设备信任、入口选择持久化，DSH 重启后按保存的配置恢复。已有明文公网入口需要改为 HTTPS；旧版免密码配置会恢复为强制认证。

## 结构

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 宿主入口：生命周期 + 鉴权路由（status / toggle / password / external / devices / cloudflared / selfcheck） |
| `tools/diagnose.mjs` | 命令行自检：读状态文件 + 探端口 + 比对 SakuraFrp 隧道端口，只读 |
| `lib/service.js` | 状态机：启停、持久化、状态快照、密码轮换 |
| `lib/proxy.js` | 本机网关：`/__verify` + 配对码、Cookie 注入、Host/Origin 改写、WS 中继 |
| `lib/pwa.js` + `lib/pwa/` | 网关 PWA：manifest、安装图标、浏览器安装状态与无缓存离线重试页 |
| `lib/tailscale.js` | `tailscale status` / `serve` 封装 |
| `lib/state.js` | `~/.dsh/remote-access/plugin-state.json`（开关、密码、会话密钥、端口） |
| `lib/qr.js` + `lib/qr-encoder.cjs` | 内置 QR 编码器，宿主输出矩阵、客户端画 SVG |
| `lib/client.js` | 浏览器入口：侧栏图标、面板 UI、配对弹窗及 Mobile Web UI chunks 的按需加载 |
| `lib/client.mobile-skin.js` | Mobile Web UI：DOM 适配、布局 / 面板 / 键盘交互和诊断状态 |
| `lib/client.mobile-styles.js` | Mobile Web UI：响应式样式、主题 token、安全区与触控布局 |
| `MOBILE-UI.md` | 宿主 DOM 契约、适配器维护说明与 OPPO Find N5 手工检查清单 |
| `cordis.patch.yml` | 往 profile 插入一行宿主插件 |

## 设计约束

- 浏览器半边是纯 JS（只需要 `react`/`react-dom`），不依赖构建；Mobile Web UI 使用宿主支持的 `client.*.js` package-local chunks；
- 所有宿主路由走 `ctx.connection.fetch.register`，复用 DSH 的 owner 鉴权；
- 手机拿不到 DSH 的 owner Cookie：网关自己保管并注入；
- 网关只监听 `127.0.0.1`，靠隧道或 frp 对外；
- 与旧脚本 `start-dsh-remote.cmd` 状态目录分开（插件用 `plugin-state.json`），可共存但不要同时启用。

## 开发

- 纯 ESM，改完跑 `node --check lib/*.js`；
- 推荐通过 Plugin Manager 更新 / 重装，并依据 `application` / `nextStep` 确认生效。当前 DSH HMR 会在 profile 重组时比较已加载文件并替换变化模块，支持插件级热重载；网关重载时远程连接会短暂断开。外部脚本仅同步 / 重链文件未必触发重组，需另行触发插件重载；只有宿主未启用 HMR 或明确返回 `restart-required` 时再安排进程重启；
- 手机协助 UI 默认隐藏，底层路由与 `phone` 工具仍注册；执行还需本机开启协助、有效设备令牌及 Android 无障碍授权。`SHOW_PHONE_ASSIST` 只控制面板展示。
