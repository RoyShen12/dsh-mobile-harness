# 第三方组件与许可 / Third-party notices

DSH Mobile Harness 主体代码以 MIT 许可发布（见 LICENSE）。下面是随仓库分发或运行时会用到的第三方组件。

## 随 App 打包

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 | `app/www/vendor/jsQR.js`，相机取景框与相册图片的二维码识别。Apache-2.0 全文见 https://www.apache.org/licenses/LICENSE-2.0 |
| [Capacitor](https://capacitorjs.com/)（core / android） | MIT | App 的 WebView 外壳与原生桥。 |
| [harness.svg](https://www.deepseek.com/) | 随 DSH 分发 | App 首页与面板里的 DSH 图标，仅作标识用途。 |

## 运行时下载，不随仓库分发

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| [cloudflared](https://github.com/cloudflare/cloudflared) | Apache-2.0 | 选择「Cloudflare」入口时，插件从 GitHub Releases 下载到 `~/.dsh/remote-access/bin/`，用 quick tunnel 暴露本机网关。 |

## 仅依赖、不打包

| 组件 | 许可 | 说明 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai) | 见上游 | 宿主程序。本仓库只是一个插件 + 一个客户端，不包含 DSH 本体。 |
| [Node.js](https://nodejs.org/) | MIT | 插件运行时。 |
| [Tailscale](https://tailscale.com/) | BSD-3-Clause / 商业 | 可选的网络入口，用户自行安装 `tailscale` 客户端。 |

## 参考过思路、没有使用代码的项目

- [dsh-Go](https://github.com/ccch1mneyyy/dsh-Go)（AGPL-3.0）：中继 + 指纹对码 + 诊断包的产品思路。**未复制任何代码**，只借鉴了「两端核对」这一交互设计。
- [dsh-pocket](https://github.com/shaobeichen/dsh-pocket)（GPL-2.0）：同赛道项目，用于对比功能与确认 Cloudflare 方案的可行性。**未复制任何代码**。