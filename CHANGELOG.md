# 更新记录

## 1.0.2 — 2026-10-31
- cloudflared 下载从 2 个地址扩到 8 个（官方 + ghfast.top / gh-proxy.com / ghproxy.net / hk.gh-proxy.com / github.moeyy.xyz / gh.llkk.cc / kkgithub），逐个试；支持环境变量 `DSH_CLOUDFLARED_URL` 指定自己的镜像（优先生效）。
- 下载中面板多一个「停止下载」按钮：不用再等 8 个地址各自超时。
- 程序就绪后多一个「删除」（点两次确认）：binary 损坏或下到一半时，删掉重下即可，不用去翻目录。
- 机器上已装 cloudflared（PATH 里能找到）就直接用，不再下载；面板会写明「用的是系统 PATH 里的 cloudflared」。
- 下载全部失败时，提示里直接给出目标路径与 `DSH_CLOUDFLARED_URL` 用法。

## 1.0.1 — 2026-10-31
- 面板「网络入口」把 Tailscale 排到最后，并直接标注「不推荐：走 DERP 中继时延迟高」；外部隧道与 Cloudflare 排前两位。
- 发布到 npm：`npm i dsh-mobile-harness`（或 `dsh plugin --profile desktop add dsh-mobile-harness`）。

## 1.0.0 — 2026-10-31

第一个公开发布：插件 `dsh-mobile-harness@1.0.0` + 可选的 Android App 1.0.0（versionCode 31，约 4 MB）。

**电脑端**
- DSH 里多一页「远程访问」：二维码（一次性票据）、密码、四种网络入口、设备准入，状态全部持久化。
- 入口推荐外部隧道（SakuraFrp / 任意外网地址）与 Cloudflare 快速隧道；Tailscale 可选，走中继时延迟偏高。

**手机端**
- 浏览器扫码即用，不需要装 App；窄屏皮肤自动生效。
- App（可选）：相机扫码、四个入口 chip、密码按地址记住、密码错了自动清掉、下载落盘。

**准入**
- 密码 → 6 位配对码两端核对 → 设备白名单；扫码本身不放行。
- 在线上限、待同意队列、在线绿点置顶 / 离线灰灯、移除 = 断开 + 撤销信任、拉黑、全部下线、诊断包（白名单字段）。

许可：MIT。
