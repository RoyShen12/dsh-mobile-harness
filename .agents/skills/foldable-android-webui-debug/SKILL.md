---
name: foldable-android-webui-debug
description: 在折叠屏安卓真机上调试 DSH Web UI 时使用，涵盖内屏/外屏切换、Chrome DevTools 远程调试、插件更新与热加载限制、adb 输入坐标和系统手势冲突等易错点。
---

# 折叠屏安卓 Web UI 调试

目标是拿到真机真实渲染结果并能快速改样式验证，避免把浏览器外壳、系统手势或构建缓存造成的假象当成前端 bug。

## 基本流程

1. 改完仓库代码并本地验证后，先读 `../deploy-dsh-plugin/SKILL.md`，取得本次插件重载许可后通过 Plugin Manager 重装，依据 `application` 判断是否生效。仅在管理器要求重启且用户明确允许时重启 DSH。
2. 手机刷新页面，确认 `window.__dshMobileSkin.getState()` 的版本、`compatibility: ready` 和注入样式均匹配本次改动。只改 sibling chunks 时需同步更新 `lib/client.js` 的版本注释以推进入口 revision；旧 immutable URL 可能命中浏览器缓存，可用 `device.mjs reload` 绕过一次缓存。
3. 折叠/展开切换后刷新一次页面。页面是在另一块屏的尺寸下加载的，不刷新会拿到过期的布局状态。
4. 用 `scripts/device.mjs` 读状态、截图、按选择器点击；不要手算坐标。

## 关键限制

- 插件前端 sibling chunks 的 rev 跟随 Client 入口；只改 chunks 会继续使用旧 immutable URL。同步推进入口后通过 Plugin Manager 重装，并核对真机实际版本。外部脚本同步流程见部署技能。
- 重启线上 DSH 前需要用户明确同意。重启后手机页面必须刷新。
- 页面的 `innerHeight` 不含 Chrome 工具栏，`adb input` 用的是整块屏幕的物理坐标。坐标必须用 `screen.height * devicePixelRatio - innerHeight * devicePixelRatio` 换算；写死某个方向的高度在折叠或旋转后必错。
- `adb input` 默认发往默认显示。折叠后先确认哪块屏是 `state=ON`，必要时用 `input -d`。
- Android 返回手势占用屏幕最左约 30px。从更靠里（约 60px 起）开始测边缘滑动，否则手势会被系统吃掉，甚至把 Chrome 页面退出。
- `input keyevent 4` 在没有可关闭浮层时会退历史，可能直接关掉标签页。测试关闭逻辑优先点界面元素，并先记录 `history.length`。
- 浏览器接管横向平移后，`pointermove` 会变成 `pointercancel`。手势实现用非被动的 touch 事件，不要依赖 pointer 序列。
- 连续用 `am start -a VIEW` 打开同一地址会不断新增标签页。切页用 CDP `Page.navigate`，测试完清理自己开的标签。
- `adb screencap` 会把 Chrome 的查找栏、系统浮层一起拍进去，偶尔还有合成残影。判断页面本身有没有溢出，用 CDP `Page.captureScreenshot` 对比，两者不一致时先怀疑截图链路。

## 选择器与样式

- host 使用 CSS Modules，hash 类名会随构建变化。运行时 `data-dru-part` 标记是首选锚点；必须用类名时只匹配稳定片段。
- `[class*="_newSession"]` 会同时匹配 `_newSessionLabel`、`_newSessionContent` 等子元素。需要只命中按钮时加 `button` 或更精确的父级限定。
- 宿主会给 shell 写内联 `grid-template-columns`，也会给侧栏根节点写内联 `width`。只看计算样式会漏掉这些来源。
- 右栏在视口小于 768px 时是零宽 track 的全屏模式，必须读 `data-rightbar-fullscreen`，不能只按最后一列像素判断。
- host 的部分面板使用 content-box。给容器设 `width:100%` 前先设 `box-sizing: border-box`，否则窄屏会横向溢出十几到几十像素。
- 真机上 `matchMedia('(hover: none)')` 与 `any-pointer: fine` 可能同时为真，不要只用 hover 查询区分触屏。

## 截图与验证

至少覆盖四种状态（CSS px）：外屏竖屏约 350×716、展开竖屏约 691×634、展开横屏约 763×562、停靠宽度 ≥1040。

每轮检查：横向溢出、头部按钮右边界、侧栏固定区占比、会话区可用高度、输入框是否被键盘遮挡、返回键与边缘滑动、设置弹窗宽度。

用 CDP 注入新 CSS 可以临时验收样式；JS 逻辑改动需要走 Plugin Manager 重装并刷新页面。`0.2.2-rc.1` 起原生分支诊断为 `active:false, compatibility:native`，旧版分支应为 `active:true, compatibility:ready`。

## 脚本

`scripts/device.mjs` 读取设备、建立 9222 转发并复用现有标签页。以下命令在仓库根目录执行。

```bash
node .agents/skills/foldable-android-webui-debug/scripts/device.mjs state
node .agents/skills/foldable-android-webui-debug/scripts/device.mjs reload # 绕过一次浏览器缓存
node .agents/skills/foldable-android-webui-debug/scripts/device.mjs eval 'window.__dshMobileSkin.getState()'
node .agents/skills/foldable-android-webui-debug/scripts/device.mjs shot /tmp/s.png
node .agents/skills/foldable-android-webui-debug/scripts/device.mjs tap 'button[aria-label="打开侧边栏"]'
```

设备序列号用 `ANDROID_SERIAL` 指定；默认为 `adb devices` 中第一台在线设备。
