---
name: deploy-dsh-plugin
description: "把 dsh-mobile-harness 的工作区部署到本机 DSH desktop profile 并重启 DeepSeek Harness 时使用，包含 pnpm file: 重链、宿主缓存、进程校验和重启失败处理。"
---

# 部署 DSH 插件并重启

只在用户明确要求部署并重启时执行。重启会中断正在运行的会话。

## 流程

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
- 宿主在启动时固化插件 chunk 的 rev。文件拷完不重启，前端仍加载旧代码。
- 主进程和 DSH host 子进程共用同一个可执行文件，`pgrep -x` 会返回多个 PID；按完整路径匹配，退出时确认全部消失。
- `rsync --delete` 的目标是 `~/.dsh/plugins/dsh-mobile-harness`，不要指向 profile 的 `node_modules` 或仓库目录。
- 脚本拒绝 `~/.dsh` 之外的 `DSH_HOME`，改路径时先确认这是预期行为。
- 使用 quick tunnel 时重启后地址会变；需要远程访问就先取新地址，再让手机刷新。
- 部署目录没有自动备份。要回滚就切回已知可用的提交，重新跑一遍部署。
