# 网络传输优化

手机通过公网隧道访问 DSH 时，真正受限的是上行带宽和移动网络下的请求次数。这一轮优化把**传输体积**和**空闲轮询**分开处理，所有数据来自 Find N5（PKH110，Chrome 156）+ Chrome DevTools Protocol 实测。

## 已实现

### 1. HTTP 正文压缩（网关 br / gzip 兜底）

- 新增 `lib/compress.js`：按 `Accept-Encoding` 的 q 值协商，优先 `br`，其次 `gzip`；`*` 映射为兼容性最好的 gzip。
- 网关对可压缩响应进行流式压缩：`text/*`（`text/event-stream` 除外）、`application/json`、JavaScript、XML、`image/svg+xml`、wasm。
- 跳过：SSE、图片/字体/音频/视频、zip/gzip/pdf 等已压缩格式、已有 `content-encoding`、`206`/`content-range`、`cache-control: no-transform`、`HEAD`、`204/304`。
- 小于 1 KB 的响应保持 identity；压缩后不比原文小的也回退 identity。
- 压缩响应删除 `content-length`、保留并弱化 `ETag`、追加 `Vary: Accept-Encoding`；转发 `If-None-Match` 时剥掉 `W/` 前缀，保证压缩后仍能命中宿主的 304。
- HTML 导航先注入 viewport / PWA 标签，再压缩。
- 宿主侧：profile 的 `webserver` 配置补回压缩字段（profile patch 的 `config` 是整对象替换，原先只写了 `host`/`port`，把 base bundle 的 gzip 配置覆盖掉了）：

  ```yaml
  - id: webserver
    config:
      host: 127.0.0.1
      port: !!js ctx.webStartup.port ?? 19387
      tls: !!js ctx.webStartup.tls
      compression: gzip
      compressionLevel: 1
      compressionThresholdBytes: 1024
  ```

  桌面直连页面由宿主压缩；手机网关对接受压缩的客户端统一向上游请求 identity，自己发 br，避免双重压缩。改这一行会触发热重载 webserver，桌面 GUI 端口可能重新分配；手机公网入口指向插件网关，不受影响。

### 2. WebSocket permessage-deflate

DSH `0.2.2-rc.1` 的 `/api/remote.mux` 默认 `websocketCompression: 'deflate'`。手机握手实测：

```text
wss://<host>/api/remote.mux 101 permessage-deflate
```

网关是原始字节中继，扩展协商原样透传，因此快照、会话回放和工具输出这些大 JSON 帧已经压缩。插件侧无需改协议。

### 3. 审批轮询：1.5 s 全量状态 → 15 s 轻量长轮询

- 新增 `GET /api/dsh-mobile-harness.pending`：只返回 `phase/enabled/busy/devices/pages/pending`，不包含 labels、audit、sessions、QR 矩阵等大字段。
- 支持 `?wait=15000` 长轮询：每秒比较轻量状态，变化立即返回，超时返回 304，请求 abort 立即结束。
- 支持 `If-None-Match` + ETag/304；远程请求的 `pairCode` 一律抹空，`deviceId` 始终是 HMAC 引用。
- 前端改为模块级 `statusFeed` / `pendingFeed` 单例：
  - 审批浮层用 pending 长轮询，不再拉完整 status；
  - 远程面板用 status 条件请求，空闲 3 s、切换/下载状态 1 s；
  - 页面隐藏时暂停，恢复可见时立即刷新；
  - 多个订阅者共享同一个请求。
- `snapshot()` 中的展示型 `lastSeen` 按 10 s、`uiModeProbe.at` 按 60 s 取桶，真实状态不变；这样状态没有变化时 ETag 才能真正命中 304。

### 4. 只读 POST 去重与短缓存

网关对只读 RPC 做 **5 秒 TTL 响应缓存 + 在途合并**：

- 缓存键 = 方法 + URL + RPC method + `payload`，特意忽略每次请求都不同的 `rpcId`；
- 回放时把响应里的顶层 `rpcId` 替换为当前请求的 `rpcId`，所以缓存不会破坏 RPC 关联；
- 单条上限 2 MB、总缓存 32 MB、最多 64 条，按 LRU 淘汰；
- 上游 401/403 刷新一次 DSH cookie 再重试；
- 剥离缓存里的 `set-cookie`，设备 cookie 仍按调用方单独下发；
- 覆盖 `/api/settings/describe`、`/api/session/modelCatalog`、`/api/session/list`、`/api/skills/list`、`/api/agentPresets/list` 等只读接口。

这消除了打开页面时 `settings/describe`、`modelCatalog` 的重复上游调用，并让 5 秒内的连续刷新复用 `/api/session/list`。

### 5. 缓存与 SSE 头修正

- `/plugins/events` 之前被网关按 `/plugins/` 前缀错误标记为 `public, max-age=31536000, immutable`；现在 SSE 响应为 `cache-control: no-cache, no-transform` + `x-accel-buffering: no`。
- 只有内容寻址资源保留 immutable：`/assets/*`、`/plugins/??…&rev=`、`/plugins/<pkg>/client.<hash>.js`、`/plugins/<pkg>/assets/*`。
- 文本型 PWA 资产（`client.js`、`sw.js`、manifest）也走 br/gzip，但保持 `no-store`。

### 6. HMR SSE 初始 graph 去重

- 页面头部注入一个极小的 `EventSource` 包装，只给 `/plugins/events` 追加 `gwrev=<当前 __DSH_BOOT__.rev>`。
- 网关按 SSE 事件边界解析；如果连接收到的**第一条** graph 帧与页面 boot rev 相同，说明页面已经渲染过这份 graph，直接丢弃；变更后的 graph、`rebuilt` 帧和注释行原样转发。
- 实测同一页面：带 `gwrev` 的 SSE 首段只有 13 B（`: connected`），不带 `gwrev` 的对照是 35,203 B；`touch client.js` 后页面仍拿到新的 client bundle revision，HMR 重建路径正常。
- 降级：旧页面、旧客户端、桌面直连都没有 `gwrev`，网关不启用过滤，行为与之前一致。

## 实测收益

手机经公网 HTTPS + HTTP/2 入口，ADB + CDP 采样：

| 场景 | 优化前 | 优化后 | 变化 |
| --- | ---: | ---: | ---: |
| 强制冷启动（全部资源） | 17,826,499 B | 3,468,542 B | **-80.5%** |
| 普通刷新 | 约 1.25 MB | 146,169 B | **-88%** |
| 首个插件组合 chunk | 7,365,048 B | 1,583,512 B | -78.5% |
| 第二个插件组合 chunk | 5,887,910 B | 1,198,465 B | -79.6% |
| `/api/session/list` | 955,472 B | 98,877 B | -89.7% |
| `/api/settings/describe` 两次合计 | 165,554 B | 19,650 B（上游只打一次） | -88.1% |
| 空闲 40 s 的审批轮询 | 约 12 MB/h 全量状态 | 3 次 304，0 字节正文 | 几乎为 0 |
| `/plugins/events` 初始 graph | 105,780 B（4 次连接） | 165 B（3 次连接） | 每次连接约省 26–35 KB |

默认编码统计：冷启动 3.47 MB 中 br 3.46 MB，identity 仅 0.012 MB。插件 revision 更新后的首个刷新会重新取对应 combo（约 1.2–1.35 MB），之后回到 146 KB 的稳态。

复现：

```bash
adb -s <device> forward tcp:9222 localabstract:chrome_devtools_remote
node tools/measure-network.mjs --cold --seconds 70
node tools/measure-network.mjs --seconds 40
```

`tools/measure-network.mjs` 只读浏览器，输出按 URL 聚合的 transfer / content-encoding、WebSocket 握手扩展与帧长度。

## 仍需上游 DSH 修改的部分

这些不在 `dsh-mobile-harness` 仓库能控制的范围，已定位到具体代码：

- **首屏 bundle 拆分**：`@deepseek-ai/dsh-client-modules` 的 `compose()` 把所有 application 行按 URL 长度分成两个 combo，`bootInjections()` 对每个 application batch 都发 `script-preload`，`packages/client/web/src/boot.ts` 虽然只 prefetch `immediately` 行，但 `bootClient` 随后仍会 import 全部行。真正按需加载需要按 `immediately` 分层生成 batch，并让非 immediate 插件在首屏挂载后再 `create`。
- **`/api/session/list` 体积**：734 个 session 的 `projections` 约 790 KB（`agentTeam` 191 KB、`tokenUsage` 76 KB、`subagentCatalog` 56 KB）。压缩后已降到 98 KB；进一步需要分页或把重型 projection 标记为不在 summary 里下发。
- **第三方 WebSocket**：`dsh-better-sidebar` 的 `/sidebar/ws/agent-opens` 用 `new WebSocketServer({ noServer: true })`，未开启 `perMessageDeflate`；目前帧很小，收益有限。
- **心跳频率**：Gateway 默认 `websocketHeartbeatIntervalMs: 2000`，移动网络下可评估放宽到 10–30 s 以减少射频唤醒，但需权衡 NAT/代理空闲断连。
