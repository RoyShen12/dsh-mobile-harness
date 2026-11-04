# DSH Mobile Harness

<p align="center">
  <b>把电脑上的 DeepSeek Harness，装进你的手机。</b><br/>
  扫码即连 · 浏览器就能用（App 可选）· 五个网络入口（含局域网 / 虚拟组网）· 设备逐台准入 · 一键自检
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-mobile-harness"><img alt="npm" src="https://img.shields.io/npm/v/dsh-mobile-harness?color=4c8dff" /></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-3ddc84" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Android%20App%20%7C%20Web%20(iOS%20%7C%20HarmonyOS)-3ddc84" />
  <img alt="dsh" src="https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A5%200.2.1--rc.3-6b5bff" />
</p>

![面板：一个开关 + 三张卡](assets/panel.png)

> 电脑端面板：一个总开关——连接 / 网络入口 / 设备准入。

**下载**：npm dsh-mobile-harness

---

## 功能

为DSH添加了远程控制功能，仅需使用浏览器，扫码即可体验随走随身的DSH。
在您不满足于网页版的体验时，可以选择下载我们的APK我们会不断更新我们的安卓客户端。
担心被别人连接电脑？不用担心，首次授权确认+设备管理+随机密码，保护您的连接安全。
- 我们提供五种入口，适用于不同人群:
- ①cloudflare(免注册、免费、最省事、代价是每次重启DSH需要重新扫码登录)
- ②外部隧道(内网穿透、需注册、可能付费、需实名，但好处是最稳定且重启DSH后保留原本的登录，无需再次扫码)
- ③Tailscale(手机电脑需额外软件，数据走的境外服务器，延迟高，不推荐，需注册)
- ④LAN(局域网/虚拟组网：同一 Wi-Fi，或皎月连、ZeroTier 这类组网，稳定、延迟最低，但距离受网络限制)
- ⑤仅本机(只监听 127.0.0.1，用于本机调试，手机连不上)

**手机不一定需要 App。** 使用浏览器(最好使用chrome)扫一下面板上的二维码、确认一次，就能接着用电脑上的同一个DSH。

***APK仍在开发，可能会有严重的兼容性问题，所以暂不推荐***

！！***请注意对于部分手机用户，例如红米/小米等，由于其系统的特殊性不推荐使用手机自带浏览器进行访问，实测QQ浏览器以及firefox、chrome都可以替代***！！

不是另开一个账号，是**同一台电脑、同一个会话**：上下文、工具、文件都还是电脑上那份。

### 文件传输

面板顶部有「文件传输」一栏：手机和电脑读写**同一个文件夹**，不用发微信、不用连数据线。

- 电脑上把文件拖进虚线框，或点一下选文件；手机上同理（相册、文档、压缩包都行）。
- 列表里可以「下载」到本机，也可以「删除」；同名文件自动加 `（1）`，绝不覆盖。
- 单个上限 200 MB（DSH 的网关本身允许 300 MB，留了余量）。
- 存放位置默认在插件自己的数据目录：`%USERPROFILE%\.dsh\remote-access\files`。
- **位置可以改**：点「选择…」在文件管理器里挑一个文件夹（也可以直接填路径，比如 `E:\共享`、同步盘），点「保存」即生效；清空就回到默认。换位置**不会搬运**旧文件。

### 电脑端 / 远程端

同一个页面，两种身份，控件会自动分开：

- **电脑本机**（直接开 DSH 面板）：开关、网络入口、一键自检、设备准入、界面模式（默认档 + 每台设备可单独覆盖）、文件池位置全都在。
- **手机 / 远程页面**（经网关转发进来的）：只留「文件传输」，其余本机设置一律隐藏；顶部一行说明告诉你为什么看不到。

判断依据是「请求有没有经过网关」，不是 IP —— 所以皎月连、SakuraFrp 那种从本机 127.0.0.1 转发进来的访问也会被正确认成远程端。

### 安全

- 网关只监听 `127.0.0.1`，不监听 `0.0.0.0`、不做端口映射。
- 三层准入：密码 → 6 位配对码两端核对 → 设备白名单。
- **扫码不等于放行**：扫完落地的是等待页，页面上那串配对码要和你电脑面板上的一致，点了「允许」才真正进站。
- 移除 = 立刻断开 + 撤销信任，下次要重新配对；拉黑 = 永久拒绝。
- 诊断包是白名单字段，不含密码、session、设备 token。细节见 [SECURITY.md](SECURITY.md)。

## 快速开始

### 0. 你需要

- 一台跑着 DSH 的电脑（Windows / macOS / Linux；本项目在 Windows 11 上开发与实测）
- DSH ≥ 0.2.1-rc.3，Node ≥ 22
- 一个浏览器（手机、平板、另一台电脑都行）；想用相机扫码再准备一台 Android 8.0+

### 1. 装插件

**方式 A：npm（最快）**

```bash
dsh plugin --profile desktop add dsh-mobile-harness
```

**方式 B：一键脚本（从仓库）**

```bash
git clone https://github.com/afeack/dsh-mobile-harness.git
cd dsh-mobile-harness
node scripts/install-plugin.mjs --profile desktop   # 换成你的 profile 名字
cd ~/.dsh/profiles/desktop && pnpm install
```

脚本会往 profile 的 `package.json` 里写一条依赖和一个 bundle 条目，重复跑是幂等的。

**方式 C：手动改 profile**

profile 在 `~/.dsh/profiles/<名字>`（Windows 是 `%USERPROFILE%\.dsh\profiles\<名字>`），改两处：

```json
{
  "dependencies": {
    "dsh-mobile-harness": "^1.0.2"
  },
  "dsh": { "profile": { "bundles": ["...", "dsh-mobile-harness"] } }
}
```

`dsh.profile.bundles` 里必须有包名，否则 DSH 不会去加载它。改完在 profile 目录里 `pnpm install`。

**方式 D：离线 tgz**

从 [插件 1.0.2 release](https://github.com/afeack/dsh-mobile-harness/releases/tag/plugin-v1.0.2) 下 `dsh-mobile-harness-1.0.2.tgz`（内容和 npm 包一致），解开到 `<profile>/node_modules/dsh-mobile-harness/`，再把 `dsh-mobile-harness` 写进 `dsh.profile.bundles`；或者 `pnpm add file:./dsh-mobile-harness-1.0.2.tgz`。内网 / 连不上 npm 时用这条。

### 2. 重启 DSH

退出托盘图标，重新打开。会话侧栏会出现「远程」入口，点进去是「远程访问」面板。

### 3. 选择你的方式、打开开关

面板右上角把总开关打开，再选一个网络入口（见下一节），拿到网址。

### 4. 手机接入

> **小米 / 红米等用户注意**：系统自带浏览器和部分定制 WebView 会把页面里的点击同步拦掉，表现为「按钮点不到、界面不同步」。换 **QQ 浏览器** 或 **Chrome** 打开同一网址即可，插件本身不用改。


**A. 浏览器（先试这个）**

1. 手机浏览器打开面板上的网址，或者直接扫面板上的二维码。
2. 浏览器停在等待页，页面上有一串 6 位配对码。
3. 电脑面板「设备准入」里出现同一串数字 —— 核对一致，点「允许」，再点「数字一致，允许」。
4. 手机上自动进站，之后直接刷新就能继续用。

**B. 装 App（不推荐）**

1. 装 [App 1.0.0 release](https://github.com/afeack/dsh-mobile-harness/releases/tag/v1.0.0) 里的 `dsh-mobile-harness-1.0.0.apk`（或仓库里的 `app/dist/dsh-mobile-harness-1.0.0.apk`）。iOS / 鸿蒙没有 App，用浏览器即可。
2. 打开 App → 相机扫码（或从相册选图）→ 同样核对 6 位配对码。
3. 勾「记住地址和密码」，以后换地址也能自动填。

## 五个入口怎么选

| 入口 | 推荐度 | 要准备什么 | 说明 |
| --- | --- | --- | --- |
| **SakuraFrp / 任意外部隧道** | ✅ **推荐** | 已有一条 frp 隧道，填外网地址（如 `https://frp-cat.com:12345/`） | 地址稳定，延迟低；「自动检测」会去读 SakuraFrp 的运行日志 |
| **Cloudflare 快速隧道** | ✅ **推荐（零准备）** | 什么都不用 | 免账号、一键建隧道；地址每次重启都变，换地址要重新扫码；首次要下约 50 MB 的 cloudflared |
| **局域网 / 虚拟组网** | ✅ **推荐（同网段）** | 手机和电脑同一个 Wi-Fi；或两端都连着皎月连 / ZeroTier 这类虚拟组网 | 网关监听所有网卡，面板列出本机每个 IPv4；**点地址后面的「用这个」可以指定二维码用哪一张网卡**（比如皎月连给的 `10.6.22.1`），选定后二维码立刻改地址、不用重连。不出公网，延迟最低。Windows 首次会弹防火墙，要允许 |
| **仅本机** | 调试用 | 无 | 只监听 127.0.0.1，手机连不上，用来在本机验证面板 |
| **Tailscale** | ⚠️ **不推荐** | 两端都装 Tailscale、登录同一账号 | 能穿透 NAT，但流量常走 DERP 中继，延迟明显偏高；只在内网直连（同一局域网 / 同一 VPC）时才顺 |

**为什么 Tailscale 排最后**：它解决的是「没有公网入口也能连上」，代价是节点绕行——手机到电脑可能先绕到境外中继再回来，打字、翻页都能感觉到卡。**有公网入口就用外部隧道，没有就开 Cloudflare**；Tailscale 留给「内网直连 + 不想开公网」的场景。

第一次接入建议先用「局域网 / 虚拟组网」把扫码和配对码跑通（同一 Wi-Fi 下最快），再切到公网入口。

### 用皎月连 / ZeroTier 连进来

**皎月连/樱花（映射模式，最省事）**
1. 樱花sakura：
  ①首先确保自己已经下载且准备好sakuraLauncher
  ②创建隧道，选择延迟较低的节点
  ③注意https协议需要选择“自动”，端口设置为插件中提示设置的端口![alt text]({89A2D559-B583-450D-8459-1678AB7EA28B}.png)
  ![alt text]({63E2D3D1-0AE9-4011-9AA1-C71570969AD1}.png)
  ④启动远程，扫码即可连接

2. 皎月连：
  ①手机端和电脑端都下载皎月连
  ②选择“服务端”，填写局域网ip 127.0.0.1 以及本地端口（在插件中提示的端口）
  ③手机选择连接电脑
  ④启动远程，扫码即可连接

**皎月连 / ZeroTier（组网模式，给虚拟 IP）**

1. 两端都连上同一个虚拟网络。
2. 插件「网络入口」选「局域网 / 虚拟组网」，在地址列表里找到 natpierce（皎月连）或 ZeroTier 那张网卡，启用它。
3. 启动远程，扫码即可连接

两种方式延迟最低。连不上先确认两端都显示「已连接」，再看 Windows 防火墙有没有放行那个网关端口。

## 常见问题

**手机上按钮点不到、界面不同步？（小米 / 红米多见）**
系统自带浏览器和部分定制 WebView 会拦掉点击同步，不是插件的问题。换 QQ 浏览器或 Chrome 打开同一网址；APK 同理，能换浏览器就用浏览器。如果只能用系统浏览器，去「界面」把本机模式切成「兼容」再刷新试试。

**一定要装 App 吗？**
不用。浏览器扫码就能用，App 只是把相机扫码、密码记忆、下载落盘这几件事做得更顺。

**手机上一直转圈 / 打不开？**
先确认入口选对了，地址带不带尾斜杠都试试；公网入口要等隧道状态变成「已连接」。自签证书（64702 端口）第一次会提示不受信任，点「高级 → 继续前往」。

**连不上，但不知道断在哪一段？**
面板「网络入口」下面有个 **一键自检**：按手机请求经过的顺序逐段过（总开关 → 网关 → DSH 本体 → 隧道 → 外网地址 → 设备准入），绿的通过、黄的注意、红的就是断点，红下面那行灰字写着怎么改。命令行也能跑（只读，不绑端口、不改状态）：

**选了「局域网 / 虚拟组网」，手机还是打不开？**
按顺序排一下：①电脑面板上「本机地址」列出好几个时，逐个试；②同一个 Wi-Fi 却不通，多半是路由器开了 AP 隔离（访客网络常见），换主网络；③Windows 防火墙第一次会弹窗，选「允许访问」——没弹就手动加一条入站规则，放行面板上显示的网关端口（当前实例是 64900，不是固定的 64701）；④用皎月连 / ZeroTier，先确认手机和电脑都显示「已连接」并且在同一虚拟网段；⑤群里那台机器如果开着 VPN，局域网的包可能被路由走掉，先关掉再试。

**地址太多，不知道二维码用的是哪一条？**
面板「网络入口 → 本机地址」每条后面有「用这个」：点它就等于告诉插件“二维码和登录地址都钉在这张网卡上”，点完二维码立刻换地址、不用重连。装皎月连时那张网卡叫 `natpierce`（地址形如 `10.6.22.1`），装在手机上用客户端连上电脑后，手机浏览器打开这个地址就能进。选过之后网卡掉线（拔网线、虚拟组网断了），插件会临时回退到最优地址并在面板上说明，网卡回来后自动回到你选的那条。

**扫码后停在「等待同意」？**
这是设计。去电脑面板「设备准入」，核对那串 6 位数字，一致再点「允许」。

**忘了网关密码？**
面板上「重置密码」。重置后所有已连接设备都要重新输密码。

**面板里找不到「远程」？**
插件没装好或 DSH 没重启。检查 profile 的 `package.json` 里有没有依赖和 bundle 条目，然后重启。

**Cloudflare 下载失败？**
插件会依次试 8 个地址（官方 + 7 个镜像），全都不通才会报错。三条退路，任选一条：

1. **自己的镜像**：设环境变量 `DSH_CLOUDFLARED_URL` 指向你能连的地址，下次点下载会先试它。
2. **手动放置**：下载 [cloudflared-windows-amd64.exe](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe)，改名 `cloudflared.exe`，放到 `~/.dsh/remote-access/bin/`（Windows 是 `C:\Users\<你>\.dsh\remote-access\bin\`），面板会显示「程序已就绪」。
3. **本来就有**：只要 `PATH` 里能找到 `cloudflared`，插件直接用它，不再下载。

下载卡住时面板上有「停止下载」；下坏了（文件损坏、下到一半）用「删除」（点两次确认），删掉重下即可。

**电脑重启后手机连不上了？**
Cloudflare 快速隧道每次重启都会换地址，重新扫码即可；外部隧道和 Tailscale 的地址是稳定的。

**能同时连几台？**
「在线上限」控制，默认 3，0 表示不限。同一台手机用不同浏览器或app开多个页面算多台。

**密码、二维码会不会被写进日志？**
诊断包是白名单导出，不含密码与 token；面板上的二维码只含一次性票据，不含密码。

## 目录结构

```
plugins/dsh-mobile-harness/     插件：网关、准入、二维码、隧道、面板 UI
  lib/proxy.js             网关（Cookie、会话、扫码票据、等待页）
  lib/registry.js          设备与信任、待同意队列、配对码
  lib/service.js           开关、快照、自检、诊断包
  lib/files.js             文件池（上传 / 列表 / 下载 / 删除，可自定义目录）
  lib/picker.js            系统文件夹选择框（Electron 对话框 / PowerShell 兜底）
  lib/lan.js               局域网网卡排序与选择
  tools/diagnose.mjs       命令行自检（只读：状态文件 + 端口 + 隧道端口比对）
  lib/cloudflared.js       Cloudflare quick tunnel
  lib/tailscale.js         Tailscale 探测
  lib/phone-tool.js        手机协助（读屏 / 点按）
  lib/client.js            面板 UI（React）
app/                       Android 客户端（Capacitor 6，可选）
  www/index.html           登录页、扫码、手机协助
  android/app/src/main/java/com/dsh/remote/   原生桥、轮询、无障碍服务
scripts/install-plugin.mjs 安装脚本
assets/                    README 截图
```
## 状态与路线图

- **1.0.0（2026-10-31）**：四条入口、扫码 + 配对码、设备准入、下载钩子；浏览器与 App 两条路都能用。
- **1.1.0（2026-11-04）**：新增第五个入口「局域网 / 虚拟组网」（监听 0.0.0.0 + 列出本机 IPv4，适配皎月连 / ZeroTier）；手机 UA 自动注入桌面宽度 viewport 修窄屏挤压；**一键自检**（面板按钮 + `tools/diagnose.mjs`）把「连不上」定位到具体一段；外部隧道自动核对 SakuraFrp 隧道端口与网关端口；**独立文件池**（不依赖 life-helper，位置可改、可弹原生选择框）与**电脑端 / 远程端分离**（远程页面只留文件传输，本机设置连 API 一起拒）。
- **1.2.0（2026-11-04）**：**虚拟组网** —— 皎月连 / ZeroTier 可以直接连，面板能指定用哪张网卡，README 补了映射模式与组网模式两种教程；**手机 UI 兼容** —— 每台设备独立选界面模式（手机端也有「界面」页签，只改自己那一档）、侧栏「功能入口」可一键收起给工作区让高度、远程端隐藏总开关并提示「请在 host 端查看」，小米 / 红米请用 QQ 浏览器或 Chrome；**文件传输** —— 手机和电脑互传，不依赖 life-helper，位置可改；面板顶部分栏按「连接与设备 / 文件传输 / 界面」分类，最右侧显示版本与更新徽标。
- **手机协助（P2）**：读屏、点按、输入、滚动、开 App 都已实现，但界面在 1.0 里默认隐藏，等验收后再放出来。需要系统无障碍服务；支付 / 银行 / 系统设置类界面一律拒绝。
- **P3**：通知、音量、勿扰、手电、亮度、深链打开 App。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai)：宿主。
- [jsQR](https://github.com/cozmo/jsQR)、[Capacitor](https://capacitorjs.com/)、[cloudflared](https://github.com/cloudflare/cloudflared)。

## License

[MIT](LICENSE)。第三方组件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

---

## English

**DSH Mobile Harness** brings your desktop [DeepSeek Harness](https://github.com/deepseek-ai) session to your phone. A DSH plugin adds a gateway with a password, a one-time QR ticket, five network entries (including LAN / virtual-LAN), per-device admission control, and a one-click self-check that names the broken hop when a phone cannot connect.

**No app required.** Any browser can scan the QR code, type the password, and continue the same desktop session. The 4 MB Android app is optional: camera scanning, remembered passwords, download-to-phone. **The native app is Android-only for now** — on iOS / iPadOS and HarmonyOS, just use the built-in browser (same gateway, same admission control, add to home screen as a PWA).

- Four network entries: external tunnel (SakuraFrp) and Cloudflare quick tunnel are recommended; LAN-only for local use; Tailscale works but usually relays traffic and adds latency.
- Pairing: password → 6-digit code shown on both ends → device allow-list. Scanning a QR never grants access by itself.
- Admission control: online limit, pending queue, remove / block devices, kick-all.

Install (plugin):

```bash
dsh plugin --profile desktop add dsh-mobile-harness
# or from source:
git clone https://github.com/afeack/dsh-mobile-harness.git
cd dsh-mobile-harness
node scripts/install-plugin.mjs --profile desktop
cd ~/.dsh/profiles/desktop && pnpm install
```

Downloads are split by component: plugin tarball in [plugin-v1.0.2](https://github.com/afeack/dsh-mobile-harness/releases/tag/plugin-v1.0.2), APK in [v1.0.0](https://github.com/afeack/dsh-mobile-harness/releases/tag/v1.0.0). License: MIT. See [SECURITY.md](SECURITY.md) before exposing the gateway to the public internet.
