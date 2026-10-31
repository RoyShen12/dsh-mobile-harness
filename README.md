# DSH Mobile Harness

<p align="center">
  <b>把电脑上的 DeepSeek Harness，装进你的手机。</b><br/>
  原生 Android App · 扫码即连 · 四条网络入口 · 设备逐台准入
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-4c8dff" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-3ddc84" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Android%20%7C%20Web-3ddc84" />
  <img alt="dsh" src="https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A5%200.2.1--rc.3-6b5bff" />
</p>

![面板：一个开关 + 三张卡](assets/panel.png)

> 电脑端面板：一个总开关，下面三张卡——连接 / 网络入口 / 设备准入。左：开着；中：关着；右：Cloudflare 隧道正在下载、建立。

---

## 这是什么

DSH Mobile Harness 由两部分组成：

| 部分 | 是什么 | 放在哪 |
| --- | --- | --- |
| **插件** | 在 DSH 里加一页「远程访问」：网关、密码、二维码、隧道、设备准入 | `plugins/dsh-mobile-harness` |
| **App** | 一个 4 MB 的 Android 壳：扫码、登录、生活页、下载 | `app/` |

打开开关之后，你在电脑上跑的这个 DSH 会话——上下文、工具、文件、待办——手机上就能接着用。不是另开一个账号，是**同一台电脑、同一个会话**。

## 为什么又做一遍

[dsh-pocket](https://github.com/shaobeichen/dsh-pocket) 已经把「浏览器里扫码看 DSH」做得很好了（2.6k star）。Mobile Harness 想解决的是另外几个问题：

| | dsh-pocket | DSH Mobile Harness |
| --- | --- | --- |
| 手机端形态 | 浏览器 / WebView | **原生 APK**（4 MB）+ 浏览器 |
| 接入方式 | 局域网 / Cloudflare 公网 | **Tailscale / SakuraFrp / Cloudflare 快速隧道 / 仅本机** |
| 首次连接 | 密码 | 密码 + **6 位配对码两端核对** |
| 谁可以连 | — | **设备准入：在线上限、待同意队列、移除 / 拉黑** |
| 反向控制 | — | 读屏 + 点按（已实现，1.0 默认隐藏） |
| 许可 | GPL-2.0 | MIT |

只列差异，没有贬低的意思。dsh-pocket 的命名隧道、公网判定这些细节写得很扎实，值得学。

## 功能

### 电脑端面板

- **连接卡**：二维码（一次性登录链接，10 分钟有效，扫一次失效；默认模糊，点开显示，10 秒后自动模糊）+ 状态 + 在线统计（按「设备 + 页面」）+ 网址 + 密码（显示 / 复制 / 重置）+ 验证开关。
- **网络入口卡**：四种入口一键切换。Tailscale 自动读 `*.ts.net`；SakuraFrp 可手填外网地址，也能从运行日志自动检测；Cloudflare 免账号，一键下载 cloudflared（带进度条、速度、剩余时间）并自动建立 quick tunnel。
- **设备准入卡**：首次连接「需同意 / 免同意」、在线上限（0 = 不限，同手机多开算 1 台）、待同意队列、设备列表（在线绿点置顶、离线灰灯）、移除 / 拉黑 / 解除，「全部下线」「清空记录」「诊断包」。
- 开关、密码、设备信任、隧道选择全部持久化，DSH 重启后自动恢复。

### 手机端

- 相机扫码取景框自动识别（也支持从相册选图），识别后自动填地址、自动登录。
- 四个入口 chip（Tailscale / SakuraFrp / Cloudflare / 本机），粘贴地址自动高亮对应入口。
- 密码按地址记住；密码错了自动清掉并提示重填，不会拿旧密码一直撞。
- 「生活」页：文件池 / 待办 / 速记，和电脑共用一份数据（需要 `dsh-life-helper` 插件）。
- 下载钩子：电脑面板上点「下载」，文件直接落到手机。

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
- 一台 Android 8.0+ 手机，或者任何浏览器

### 1. 装插件

```bash
git clone https://github.com/<你的账号>/dsh-mobile-harness.git
cd dsh-mobile-harness
node scripts/install-plugin.mjs --profile desktop   # 换成你的 profile 名字
```

脚本会往 `~/.dsh/profiles/<profile>/package.json` 里写一条依赖和一个 bundle 条目，然后照着它打印的提示做：

```bash
cd ~/.dsh/profiles/desktop && pnpm install
```

不想跑脚本就手动改，两处：

```json
{
  "dependencies": {
    "dsh-mobile-harness": "file:/绝对路径/dsh-mobile-harness/plugins/dsh-mobile-harness"
  },
  "dsh": { "profile": { "bundles": ["...", "dsh-mobile-harness"] } }
}
```

### 2. 重启 DSH

退出托盘图标，重新打开。会话侧栏会出现「远程」入口，点进去是「远程访问」面板。

### 3. 打开开关，手机接入

1. 面板右上角把总开关打开。
2. 选一个网络入口（见下一节），拿到网址。
3. 手机上装 APK：[Releases](../../releases)，或仓库里的 `app/dist/dsh-mobile-harness-1.0.0.apk`。
4. 扫面板上的二维码 —— 手机上会出现一串 6 位配对码，电脑面板的待同意卡片上是同一串；核对一致，点「允许」，再点「数字一致，允许」。
5. 手机自动进站，之后下拉就能继续用。

## 四个入口怎么选

| 入口 | 要准备什么 | 适合 | 注意 |
| --- | --- | --- | --- |
| **Tailscale** | 电脑和手机都装 Tailscale，登录同一账号 | 长期自用、跨网络、点对点 | 最稳；要求两端都开着 Tailscale |
| **SakuraFrp / 外部隧道** | 已有 frp 隧道，填外网地址（如 `https://frp-cat.com:12345/`） | 已经有隧道的人 | 地址要和隧道对得上；「自动检测」会去读 SakuraFrp 的运行日志 |
| **Cloudflare 快速隧道** | 什么都不用准备 | 临时试一下 | 免账号；地址每次重启都变；首次要下载约 50 MB 的 cloudflared |
| **仅本机** | 手机和电脑同一个 Wi-Fi | 局域网内、最安全 | 出了局域网就连不上 |

第一次建议先用「仅本机」跑通扫码和配对码，再切到公网入口。

## 常见问题

**手机上一直转圈 / 打不开？**
先确认入口选对了，地址带不带尾斜杠都试试；公网入口要等隧道状态变成「已连接」。自签证书（64702 端口）第一次会提示不受信任，点「高级 → 继续前往」。

**扫码后停在「等待同意」？**
这是设计。去电脑面板「设备准入」，核对那串 6 位数字，一致再点「允许」。

**忘了网关密码？**
面板上「重置密码」。重置后所有已连接设备都要重新输密码。

**面板里找不到「远程」？**
插件没装好或 DSH 没重启。检查 profile 的 `package.json` 里有没有依赖和 bundle 条目，然后重启。

**Cloudflare 下载失败？**
网络问题。可以手动下载 `cloudflared-windows-amd64.exe`，改名 `cloudflared.exe` 放到 `~/.dsh/remote-access/bin/`，再点一次「连接」。

**电脑重启后手机连不上了？**
Cloudflare 快速隧道每次重启都会换地址，重新扫码即可；Tailscale 和 SakuraFrp 的地址是稳定的。

**手机上「生活」页是空的？**
需要电脑上装了 `dsh-life-helper` 插件；文件池是电脑和手机共用的同一个池子。

**能同时连几台？**
「在线上限」控制，默认 3，0 表示不限。同一台手机开多个页面算 1 台。

**密码、二维码会不会被写进日志？**
诊断包是白名单导出，不含密码与 token；面板上的二维码只含一次性票据，不含密码。

## 目录结构

```
plugins/dsh-mobile-harness/     插件：网关、准入、二维码、隧道、面板 UI
  lib/proxy.js             网关（Cookie、会话、扫码票据、等待页）
  lib/registry.js          设备与信任、待同意队列、配对码
  lib/service.js           开关、快照、诊断包
  lib/cloudflared.js       Cloudflare quick tunnel
  lib/tailscale.js         Tailscale 探测
  lib/phone-tool.js        手机协助（读屏 / 点按）
  lib/client.js            面板 UI（React）
app/                       Android 客户端（Capacitor 6）
  www/index.html           登录页、扫码、生活页、手机协助
  android/app/src/main/java/com/dsh/remote/   原生桥、轮询、无障碍服务
scripts/install-plugin.mjs 安装脚本
assets/                    README 截图
```

## 从源码构建

插件是纯 ESM，不需要编译：

```bash
node --check plugins/dsh-mobile-harness/lib/*.js
```

App 需要 JDK 17 + Android SDK 34：

```bash
cd app
npm install
npx cap sync android
cd android
ANDROID_HOME=<你的 SDK> JAVA_HOME=<你的 JDK17> ./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

## 状态与路线图

- **1.0.0（2026-10-31）**：四条入口、扫码 + 配对码、设备准入、生活页、下载钩子。
- **手机协助（P2）**：读屏、点按、输入、滚动、开 App 都已实现，但界面在 1.0 里默认隐藏，等验收后再放出来。需要系统无障碍服务；支付 / 银行 / 系统设置类界面一律拒绝。
- **P3**：通知、音量、勿扰、手电、亮度、深链打开 App。
- **npm**：`dsh-mobile-harness` 这个名字在 npm 上已被别的包占用，所以 1.0 走 GitHub 安装；之后可能换个名字发布。

## 开发笔记

开发过程中的中文记录（交接指南、设备准入实施计划、验收清单、方案对比）目前还留在本地，没进这个仓库——里面混着本机路径和真实的隧道地址，需要先脱敏。等清理完会作为 `docs/` 补进来；在那之前，代码和本 README 是唯一准绳。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai)：宿主。
- [dsh-pocket](https://github.com/shaobeichen/dsh-pocket)：同赛道对手，对比与灵感来源。
- [dsh-Go](https://github.com/ccch1mneyyy/dsh-Go)：配对码这个交互是从它的「两端核对」偷师的（只抄了思路，没有代码）。
- [jsQR](https://github.com/cozmo/jsQR)、[Capacitor](https://capacitorjs.com/)、[cloudflared](https://github.com/cloudflare/cloudflared)。

## License

[MIT](LICENSE)。第三方组件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

---

## English

**DSH Mobile Harness** brings your desktop [DeepSeek Harness](https://github.com/deepseek-ai) session to your phone: a DSH plugin (gateway, QR pairing, tunnel, device admission) plus a small native Android app (Capacitor, 4 MB).

- Four network entries: Tailscale, SakuraFrp / external tunnel, Cloudflare quick tunnel (auto-downloads `cloudflared`), LAN only.
- Pairing: password → 6-digit code shown on both ends → device allow-list. Scanning a QR never grants access by itself.
- Admission control: online limit, pending queue, remove / block devices, kick-all.
- Works in any browser too, with a mobile skin.

Install (plugin):

```bash
git clone https://github.com/<you>/dsh-mobile-harness.git
cd dsh-mobile-harness
node scripts/install-plugin.mjs --profile desktop
cd ~/.dsh/profiles/desktop && pnpm install   # then restart DSH
```

APK: `app/dist/dsh-mobile-harness-1.0.0.apk` (or the Releases page). License: MIT. See [SECURITY.md](SECURITY.md) before exposing the gateway to the public internet.
