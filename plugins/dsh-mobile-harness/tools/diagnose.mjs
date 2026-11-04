#!/usr/bin/env node
/**
 * dsh-mobile-harness 一键诊断（命令行版）
 *
 * 用途：手机连不上时，不用开面板也能知道是哪一段断了。
 * 面板里的「一键自检」按钮走的是插件内部的同一套判断；这个脚本是它的离线孪生兄弟，
 * 只读不写，不绑端口、不改状态，可以在 DSH 没启动时也跑。
 *
 * 判定原则：先看结果，再看原因。外网地址能返回 HTTP，链路就是通的，
 * 此时日志里任何“连接映射目标失败”的旧行都不作数（frpc 只在失败时打印那一行，
 * 用户改好端口后旧行仍留在文件里，早先版本因此误报）。
 *
 * 用法：
 *   node tools/diagnose.mjs           人看的彩色报告
 *   node tools/diagnose.mjs --json    机器可读 JSON
 *
 * 退出码：0 全通 / 1 有断点 / 2 读不到状态文件
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { collectLanAddresses, pickLanAddress } from '../lib/lan.js'
import { join } from 'node:path'

const STATE_FILE = join(homedir(), '.dsh', 'remote-access', 'plugin-state.json')
// Overridable so the regression test can point it at a fixture directory.
const FRP_LOG_DIR = process.env.DSH_DIAGNOSE_FRP_DIR || 'C:\\ProgramData\\SakuraFrpService\\Logs'
const asJson = process.argv.includes('--json')
// Prints only what the log parser sees (no probing, no state file); used by the regression test.
const frpOnly = process.argv.includes('--frp-only')

const steps = []
const add = (id, label, status, detail, hint = null) => steps.push({ id, label, status, detail, hint })

function probe(rawUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let target
    try {
      target = new URL(rawUrl)
    } catch {
      resolve({ code: 0, error: 'bad-url' })
      return
    }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(
      {
        host: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: { 'user-agent': 'dsh-mobile-harness-diagnose', 'accept-encoding': 'identity' }
      },
      (res) => {
        res.resume()
        resolve({ code: res.statusCode ?? 0 })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ code: 0, error: 'timeout' })
    })
    req.on('error', (error) => resolve({ code: 0, error: error.code || String(error) }))
    req.end()
  })
}
function canBind(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    try {
      server.listen(port, '127.0.0.1')
    } catch {
      resolve(false)
    }
  })
}

/**
 * 读最近的 SakuraFrp 日志，只看最后一次隧道加载之后的行。
 * 返回 { localPort, localPortAt, endpoint, connected, log } 或 null。
 */
function readFrpRelay() {
  if (!existsSync(FRP_LOG_DIR)) return null
  const files = readdirSync(FRP_LOG_DIR)
    .filter((name) => /^SakuraFrpService\.\d{8}\.log$/.test(name))
    .sort()
  if (!files.length) return null
  const log = files[files.length - 1]
  const lines = readFileSync(join(FRP_LOG_DIR, log), 'utf8').split(/\r?\n/)

  let start = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (/开始加载隧道配置|隧道启动中/.test(lines[index])) start = index
  }
  const scope = lines.slice(start).join('\n')

  const endpoints = [...scope.matchAll(/使用\s*>>([^<]+)<<\s*连接你的隧道/g)]
  const endpoint = endpoints.length ? endpoints[endpoints.length - 1][1].trim() : null
  const refused = [...scope.matchAll(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2})[^\n]*?连接映射目标\s*\[[^\]]*?:(\d+)\]/g)].pop()

  const startedAtMatch = [...scope.matchAll(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2})[^\n]*?隧道启动成功/g)].pop()
  const startedAt = startedAtMatch ? startedAtMatch[1].replace(/\//g, '-') : null
  const localPortAt = refused ? refused[1].replace(/\//g, '-') : null
  // A refusal older than the last successful start is history; only a newer one is current.
  const refusedNow = Boolean(localPortAt) && (!startedAt || localPortAt >= startedAt)
  return {
    log,
    endpoint,
    localPort: refused ? Number(refused[2]) : null,
    localPortAt,
    connected: /TCP 隧道启动成功|隧道启动成功/.test(scope),
    startedAt,
    refused: refusedNow,
    refusedAt: refusedNow ? localPortAt : null
  }
}

async function main() {
  if (frpOnly) {
    process.stdout.write(JSON.stringify(readFrpRelay(), null, 2) + '\n')
    return
  }

  let state = null
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    add('state', '读取状态', 'fail', '读不到 ' + STATE_FILE, 'DSH 里打开这个插件面板至少一次，或检查路径是否正确')
  }

  if (state) {
    const port = state.proxyPort
    if (state.enabled) add('switch', '总开关', 'ok', '已打开', null)
    else add('switch', '总开关', 'fail', '是关的', '面板顶部打开总开关')

    if (!port) {
      add('gateway', '网关监听', 'fail', '状态里没有端口', '打开开关再看')
    } else {
      const hit = await probe('http://127.0.0.1:' + port + '/', 2500)
      if (hit.code) add('gateway', '网关监听', 'ok', '127.0.0.1:' + port + ' 有响应（HTTP ' + hit.code + '）', null)
      else add('gateway', '网关监听', 'fail', '127.0.0.1:' + port + ' 没有响应（' + hit.error + '）', '网关没起来或已经漂到别的端口，重启 DSH')
    }

    const tunnel = state.tunnel
    if (tunnel === 'external') {
      const url = state.externalUrl || ''
      const relay = readFrpRelay()
      if (!url) {
        add('public', '外网地址', 'fail', '没填外网地址', '在面板「网络入口」里填 SakuraFrp 给的地址')
      } else {
        const hit = await probe(url, 6000)
        if (hit.code) {
          add('public', '外网地址', 'ok', url + ' 返回 HTTP ' + hit.code + '，链路已通', null)
          if (relay?.localPort) add('relay', '隧道本地端口', 'ok', '隧道 ' + relay.localPort + ' / 网关 ' + port + '（链路已通）', null)
        } else if (relay?.refused && relay.localPort === port) {
          add('public', '外网地址', 'fail', url + ' 连不上（' + hit.error + '）', 'frpc 已经连上 frp，但转发到 127.0.0.1:' + port + ' 一直被拒（最后一次 ' + (relay.refusedAt || '未知时间') + '）—— 这个端口现在没人监听：确认 DSH 正在运行、面板上的总开关是打开的')
          add('relay', '隧道本地端口', 'ok', '隧道与网关都指向 ' + port + '，端口本身没错', null)
        } else {
          add('public', '外网地址', 'fail', url + ' 连不上（' + hit.error + '）', '先确认 SakuraFrp 客户端里这条隧道是「已启动」；下面是本地侧线索')
          if (!relay) {
            add('relay', 'SakuraFrp 隧道', 'warn', '没读到 frpc 的运行日志（' + FRP_LOG_DIR + '）', '去 SakuraFrp 面板确认「本地端口」等于网关端口 ' + port)
          } else if (relay.localPort) {
            const bindable = await canBind(relay.localPort)
            const when = relay.localPortAt ? '（frpc 记录于 ' + relay.localPortAt + '）' : ''
            if (relay.localPort === port) {
              add('relay', '隧道本地端口', 'ok', '隧道与网关都在 ' + port + when, null)
            } else if (!bindable) {
              add('relay', '隧道本地端口', 'fail', '隧道转发到 ' + relay.localPort + '，但系统禁止绑定这个端口（EACCES）；网关在 ' + port + when, '把 SakuraFrp 里这条隧道的「本地端口」改成 ' + port + '，保存即恢复')
            } else {
              add('relay', '隧道本地端口', 'fail', '隧道转发到 ' + relay.localPort + '，网关却在 ' + port + when, '把 SakuraFrp 里这条隧道的「本地端口」改成 ' + port)
            }
          } else {
            add('relay', '隧道本地端口', 'warn', 'frpc 日志里没有当前这次转发的目标端口（隧道正常时它不打印）' + (relay.connected ? '，frpc 自己报告已连上' : ''), '去 SakuraFrp 面板确认「本地端口」等于网关端口 ' + port)
          }
        }
      }
    } else if (tunnel === 'quick') {
      const url = state.publicUrl
      if (url) {
        const hit = await probe(url, 6000)
        if (hit.code) add('public', 'Cloudflare 隧道', 'ok', url + ' 返回 HTTP ' + hit.code, null)
        else add('public', 'Cloudflare 隧道', 'fail', url + ' 连不上（' + hit.error + '）', 'quick 地址每次重启都变，去面板点「重连」后重新扫码')
      } else {
        add('public', 'Cloudflare 隧道', 'fail', '还没有隧道地址', '面板里点「重新连接」')
      }
    } else if (tunnel === 'lan') {
      const list = collectLanAddresses()
      const chosen = pickLanAddress(list, state.lanAddress)
      if (!list.length) {
        add('lan', '局域网入口', 'fail', '没找到非回环 IPv4 地址', '电脑没连网络？')
      } else {
        add('lan', '局域网入口', 'warn', list.map((entry) => entry.address + '（' + entry.name + '）' + (entry.address === chosen ? ' ← 二维码用这个' : '')).join('，'), '地址不对就到面板「网络入口 → 本机地址」点「用这个」换一条；手机必须和电脑在同一网段')
      }
      const hit = chosen ? await probe('http://' + chosen + ':' + port + '/', 2500) : { code: 0, error: 'no-address' }
      if (hit.code) add('lan-gw', '虚拟组网直连', 'ok', 'http://' + chosen + ':' + port + '/ 有响应（HTTP ' + hit.code + '）', null)
      else add('lan-gw', '虚拟组网直连', 'warn', 'http://' + chosen + ':' + port + '/ 没有响应（' + hit.error + '）', '网关在 LAN 入口下要监听 0.0.0.0——确认入口已切到「局域网 / 虚拟组网」并把开关重新打开')
    } else if (tunnel === 'tailscale') {
      add('tailscale', 'Tailscale', 'warn', '命令行版读不到 Tailscale 主机名，去面板看', '本机运行 tailscale up 并登录')
    } else {
      add('entry', '入口', 'warn', '仅本机，手机连不上', '选一个网络入口')
    }

    const devices = Array.isArray(state.devices) ? state.devices : []
    const pending = (Array.isArray(state.pendingRequests) ? state.pendingRequests : []).filter((item) => item.status === 'pending')
    const max = Number(state.settings?.maxOnlineDevices ?? 0)
    add(
      'devices',
      '设备准入',
      pending.length ? 'warn' : 'ok',
      devices.length + ' 台已登记' + (pending.length ? '，' + pending.length + ' 台等你同意' : '') + (max ? '，在线上限 ' + max : '，不限在线'),
      pending.length ? '到面板「设备准入」核对配对码后点允许' : null
    )
  }

  const ok = steps.every((step) => step.status !== 'fail')
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok, checkedAt: Date.now(), stateFile: STATE_FILE, steps }, null, 2) + '\n')
  } else {
    const mark = { ok: '\u2713', warn: '!', fail: '\u2717' }
    const color = { ok: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m' }
    process.stdout.write('\ndsh-mobile-harness 自检 · ' + STATE_FILE + '\n\n')
    for (const step of steps) {
      process.stdout.write(' ' + color[step.status] + mark[step.status] + '\u001b[0m ' + step.label + '：' + step.detail + '\n')
      if (step.hint) process.stdout.write('     \u2192 ' + step.hint + '\n')
    }
    process.stdout.write('\n' + (ok ? '链路是通的：手机扫码应该能进。' : '上面标 \u2717 的就是断点。') + '\n\n')
  }
  process.exit(state ? (ok ? 0 : 1) : 2)
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + '\n')
  process.exit(2)
})
