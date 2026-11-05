---
name: deploy-dsh-plugin
description: "部署 dsh-mobile-harness 到本机 DSH profile 时使用，优先 Plugin Manager 热重载，并保留显式重启的旧脚本流程。"
---

# 部署 DSH 插件与热重载

用户要求部署时使用。插件重载会短暂断开远程连接；重启整个 DSH 会中断正在运行的会话，执行前另行取得明确确认。

## 当前 DSH 的插件级热重载

- 当前 DSH 的 Plugin Manager 与 HMR 支持在 profile 重组时检测并替换已安装插件的变化模块；`dsh-mobile-harness` 没有必须重启整个 DSH 的特殊要求。
- 优先通过 Plugin Manager 的更新 / 重装完成部署，以操作结果的 `application`、`nextStep`、`restartReason` 及实际页面验证判断是否生效。重装现有包若返回 `already-installed`，按管理器支持的先移除再安装流程处理。
- 插件重载会关闭并重新打开远程网关，远程连接短暂中断；执行前取得用户对这次部署 / 重载的许可。
- 下方是外部脚本同步后显式重启的旧流程，仅在用户明确选择这种方式、宿主未启用 HMR 或管理器返回 `restart-required` 时使用。

## 外部脚本同步与重启流程

1. 在仓库根目录确认改动范围，避免把无关的未提交文件带进安装：

   ```bash
   git status --short
   scripts/update-plugin.sh --check
   ```

2. 同步并校验。脚本会 rsync 工作区、删掉 profile 里的旧链接、重跑 pnpm、逐字节比对并做语法检查：

   ```bash
   scripts/update-plugin.sh
   ```

   其他 profile 用 `--profile <name>`，其他 DSH_HOME 用 `--dsh-home <dir>`。脚本同步的是工作区，不是 HEAD。

3. 重启应用。先确认完整退出，再打开；只执行 `open -a` 会聚焦旧实例：

   ```bash
   osascript -e 'quit app id "com.deepseek.dsh"'
   for _ in {1..30}; do
     pgrep -f '^/Applications/DeepSeek Harness\.app/Contents/MacOS/DeepSeek Harness' >/dev/null || break
     sleep 0.5
   done
   pgrep -f '^/Applications/DeepSeek Harness\.app/Contents/MacOS/DeepSeek Harness' >/dev/null && {
     echo 'still running: quit from the tray, then retry' >&2; exit 1
   }
   open -a '/Applications/DeepSeek Harness.app'
   ```

   进程一直在就说明有弹窗或退出被阻塞，去托盘手动退出，不要直接 `kill -9`。

4. 验证新进程和安装版本：

   ```bash
   pgrep -fl '^/Applications/DeepSeek Harness\.app/Contents/MacOS/DeepSeek Harness'
   node -p "require(process.env.HOME + '/.dsh/profiles/desktop/node_modules/dsh-mobile-harness/package.json').version"
   ```

   手机端刷新后确认 `window.__dshMobileSkin.getState()` 为 `ready`，并检查页面加载的是本次改动。

## 踩坑

- pnpm 认为未变化的 `file:` 目录 spec 已安装，只 rsync 不会更新 `node_modules` 里的副本。必须删掉 `profiles/<name>/node_modules/dsh-mobile-harness` 再 `pnpm install`；`update-plugin.sh` 已处理。
- 单纯复制文件不保证触发 Client revision 更新；需要一次宿主支持的插件重载 / profile 重组，刷新远程页并确认本次代码已加载。进程重启是该旧脚本流程采用的方式。
- 主进程和 DSH host 子进程共用同一个可执行文件，`pgrep -x` 会返回多个 PID；按完整路径匹配，退出时确认全部消失。
- `rsync --delete` 的目标是 `~/.dsh/plugins/dsh-mobile-harness`，不要指向 profile 的 `node_modules` 或仓库目录。
- 脚本拒绝 `~/.dsh` 之外的 `DSH_HOME`，改路径时先确认这是预期行为。
- 使用 quick tunnel 时重启后地址会变；需要远程访问就先取新地址，再让手机刷新。
- 部署目录没有自动备份。要回滚就切回已知可用的提交，重新跑一遍部署。
