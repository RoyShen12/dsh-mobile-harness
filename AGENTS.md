# dsh-mobile-harness 项目规则

## 文档索引

- [README.md](README.md) — 插件功能、安装、网络入口与使用说明。
- [DEBUGGING.md](../../WorkRepos/dsh-plugins/docs/dsh-mobile-harness/DEBUGGING.md) — ego-browser 调试、ADB 真机调试与验收规则。
- [VERIFICATION.md](../../WorkRepos/dsh-plugins/docs/dsh-mobile-harness/VERIFICATION.md) — 验收范围、公开记录与记录要求。
- [SECURITY.md](SECURITY.md) — 安全模型与漏洞报告。
- [CHANGELOG.md](CHANGELOG.md) — 版本变更。
- [COMPATIBILITY-0.2.2-rc.1.md](COMPATIBILITY-0.2.2-rc.1.md) — DSH 0.2.2-rc.1 兼容性报告。
- [NETWORK-PERFORMANCE.md](NETWORK-PERFORMANCE.md) — 网络传输优化与测量。
- [plugins/dsh-mobile-harness/README.md](plugins/dsh-mobile-harness/README.md) — 插件包说明、Mobile Web UI 与 PWA。
- [plugins/dsh-mobile-harness/MOBILE-UI.md](plugins/dsh-mobile-harness/MOBILE-UI.md) — Mobile Web UI 实现、诊断与真机回归。
- [.agents/skills/deploy-dsh-plugin/SKILL.md](.agents/skills/deploy-dsh-plugin/SKILL.md) — 部署与热重载。
- [.agents/skills/foldable-android-webui-debug/SKILL.md](.agents/skills/foldable-android-webui-debug/SKILL.md) — 折叠屏安卓 Web UI 调试、ADB 与 CDP 细节。
- `docs/local-ego-browser.md` — 本机调试手册（未提交，含真实入口和设备信息）。

## 项目规则

- 调试与验收文档集中在 `../../WorkRepos/dsh-plugins/docs/dsh-mobile-harness/`；README 不写调试或验收内容。
- 插件重载会短暂断开远程连接；重启整个 DSH 前取得用户明确确认。
- 不为使插件生效而启动替代 server 或修改 DSH 安装目录。
- 公开文档使用通用 HTTPS 示例和相对路径，不写入真实域名、端口、设备标识或凭据。
- 真机检查未实际完成时必须标注未验证，不能根据 CSS 或 manifest 推断系统行为。
