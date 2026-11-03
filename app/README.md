# DSH Mobile Harness（Android 壳）

把已经在手机上跑通的 DeepSeek Harness 远程网页，封装成一个可安装的 Android App。
基于 **Capacitor 6**（MIT 开源）构建，WebView 加载现有的远程入口，额外补了：

- 首启配置页：服务器地址 + 访问密码（保存在本机，可随时返回修改）；
- **扫码登录**：点「相机扫码」打开全屏取景框，把二维码放进去**自动识别**（不用按快门）；也可「从相册选择」截图；本地用 jsQR 解码地址与 `#t=` 一次性票据，票据通过原生 `POST` 兑换，不进入请求 URL；记住密码后也可用密码登录；
- 自动登录：App 原生 `POST {地址}/__verify` 校验密码（首次连接还要在电脑上核对 6 位配对码），成功后把会话 Cookie 写进 WebView；浏览器里打不开（没有 `?p=` 直通链接）；
- **TLS 校验**：HTTPS 使用 Android 系统证书链与主机名校验；自签或证书错误会拒绝连接。局域网入口支持私有 IPv4 的 HTTP；公共入口必须使用有效 HTTPS；
- **手机协助（0.4.6 起，0.4.7 起自动重连，0.5.0 起能读屏点按钮）**：登录后挂着一条长轮询，让电脑上的 agent 通过 `phone` 工具读手机状态（电量/网络/锁屏/前台/版本），并在 **无障碍服务**开启后读屏、点按、输入、滚动、打开 App；已知金融与系统应用包名、部分风险文字有双端护栏，覆盖有限；令牌有时限，面板开关默认关闭；
- 返回键先网页后退、回到配置页再退出；
- 蓝色鲸鱼自适应图标（`#2F6BFF` 底 + 白鲸）+ 深色启动图 + 深色状态栏；
- 软键盘兼容：`windowSoftInputMode=adjustResize`、WebView 可聚焦 + 触摸时 `requestFocusFromTouch`、输入框聚焦自动滚动到键盘上方。

## 更新记录

- **1.0.0**：**公开发布版**——品牌改为 **DSH Mobile Harness**（桌面图标名、首页标题、无障碍服务名同步），App 与插件版本号统一到 1.0.0，versionCode **31**。功能与 0.5.7 一致，这一版只做发布准备。
- **1.0.1**：TLS 证书错误立即拒绝；设备令牌绑定安装标识并设置有效期；手机操作按最近快照与当前应用执行护栏；扫码票据使用 URL fragment 后由原生 POST 兑换。versionCode **32**。旧 APK 1.0.0 不包含这些安全修复，建议升级。

## 安装

1. 把 `dist/dsh-mobile-harness-1.0.1.apk` 传到手机（微信文件传输 / 网盘 / USB 均可；也可以让 DSH 通过文件传输直接发到手机）；
2. 点击安装，系统提示"未知来源"时允许即可（debug 签名，仅供自用）；
3. 首次打开：先选入口（顶部四个 chip：Tailscale / SakuraFrp / Cloudflare / 局域网），地址默认 `https://frp-cat.com:12345/`；Cloudflare 入口粘 `https://xxx.trycloudflare.com/`，局域网粘 `http://192.168.x.x:64701/`；HTTPS 入口必须通过 Android 系统证书验证。自签或证书错误会拒绝；也可用「相机扫码」或「从相册选择」导入电脑面板的二维码（扫码仍需在电脑上核对配对码）；
4. 以后从桌面图标直接进入；需要改地址/密码时，按返回键回到配置页。勾选「记住地址和密码」后，后续扫码会自动填密码；二维码票据保存在 fragment 并由 App 本地解析，再通过原生 POST 兑换。票据过期或已使用时重新扫码；
5. **要用「读屏 + 点按」**：手机「设置 → 无障碍 → 已下载的服务 → DSH Mobile Harness」→ 开启。App 首页的手机协助卡片默认隐藏；桌面端插件仍会注册 `phone` 工具，只有面板打开「手机协助」时才执行操作。不用时随时在系统设置里关闭。

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
2. `android/app/src/main/java/com/dsh/remote/MainActivity.java` → `isTunnelHost()`（允许页面导航的 host）；HTTPS 证书仍由 Android 系统验证。

改完执行 `npx cap sync android` + 重新 `assembleDebug`。

## 已知限制 / 后续

- debug 签名，不可上架；正式分发需要生成 release keystore 并配置 `signingConfigs`；
- 没有离线壳和推送通知（后续可加 Capacitor 插件：`@capacitor/local-notifications` / 服务端 WS 转发）；
- 地址栏随服务器变化：SakuraFrp 换节点后如果域名/端口变了，需要手动更新地址；
- 自签 HTTPS 入口暂不受支持；公网隧道请使用 Android 系统信任的证书，局域网可使用私有 IPv4 的 HTTP。

