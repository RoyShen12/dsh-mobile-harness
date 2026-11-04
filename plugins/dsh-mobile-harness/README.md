# DSH Mobile Harness

DeepSeek Harness 插件：把「远程访问」做成 DSH 里的一个开关。开关下面是一块小面板——网关、密码、一次性二维码、五个网络入口、逐台设备准入；连不上时还有一键自检。

**手机端不需要装 App。** 任何浏览器扫一下面板上的二维码、输一次密码，就能接着用电脑上的同一个会话；配套的 Android App（`app/`）是可选的，只多出相机扫码、密码记忆、下载落盘。

## 安装

```bash
dsh plugin --profile desktop add dsh-mobile-harness
```

或者从仓库装：

```bash
node scripts/install-plugin.mjs --profile desktop   # 写依赖 + bundle 条目，幂等
```

装完**重启 DSH**（退出托盘图标再打开），会话侧栏出现「远程」。

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
- 在线上限（0 = 不限，同一台手机开多个页面算 1 台）；待同意队列最多 3 个，5 分钟过期。
- 设备列表在线绿点置顶、离线灰灯排后；**移除 = 立刻断开 + 撤销信任**，拉黑 = 永久拒绝。
- 「全部下线」「清空记录」「诊断包」（白名单字段，不含密码 / session / 设备 token）。

## 面板

1. **连接** —— 二维码（一次性票据，10 分钟、扫一次失效，默认模糊点开显示）+ 状态 + 在线统计（设备 / 页面）+ 网址 + 密码（显示 / 复制 / 重置）+ 验证开关。
2. **网络入口** —— 五选一 + 外网地址（保存 / 自动检测）或 Cloudflare 隧道行（进度条 + 速度 + 剩余时间）。
3. **设备准入** —— 首次连接（需同意 / 免同意）、在线上限、待同意卡片（放大配对码 + 二次确认）、设备行（移除 / 拉黑 / 解除）。

开关、密码、设备信任、入口选择全部持久化，DSH 重启后自动恢复。

## 结构

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 宿主入口：生命周期 + 鉴权路由（status / toggle / password / external / devices / cloudflared / selfcheck） |
| `tools/diagnose.mjs` | 命令行自检：读状态文件 + 探端口 + 比对 SakuraFrp 隧道端口，只读 |
| `lib/service.js` | 状态机：启停、持久化、状态快照、密码轮换 |
| `lib/proxy.js` | 本机网关：`/__verify` + 配对码、Cookie 注入、Host/Origin 改写、WS 中继 |
| `lib/tailscale.js` | `tailscale status` / `serve` 封装 |
| `lib/state.js` | `~/.dsh/remote-access/plugin-state.json`（开关、密码、会话密钥、端口） |
| `lib/qr.js` + `lib/qr-encoder.cjs` | 内置 QR 编码器，宿主输出矩阵、客户端画 SVG |
| `lib/client.js` | 浏览器半边：侧栏图标 + 面板 UI + 配对弹窗 |
| `cordis.patch.yml` | 往 profile 插入一行宿主插件 |

## 设计约束

- 浏览器半边是纯 JS（只需要 `react`/`react-dom`），不依赖构建；
- 所有宿主路由走 `ctx.connection.fetch.register`，复用 DSH 的 owner 鉴权；
- 手机拿不到 DSH 的 owner Cookie：网关自己保管并注入；
- 网关只监听 `127.0.0.1`，靠隧道或 frp 对外；
- 与旧脚本 `start-dsh-remote.cmd` 状态目录分开（插件用 `plugin-state.json`），可共存但不要同时启用。

## 开发

- 纯 ESM，改完跑 `node --check lib/*.js`；
- 改 `lib/*.js` 后要同步到 `~/.dsh/profiles/<profile>/node_modules/dsh-mobile-harness/` 并**重启 DSH** 才生效；
- 手机协助（读屏 / 点按）已实现但默认隐藏：把 `lib/client.js` 里的 `SHOW_PHONE_ASSIST` 改成 `true` 即可放出。
