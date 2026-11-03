/**
 * Thin controller for the local `tailscale` CLI.
 *
 * The plugin never embeds a tunnel: it asks Tailscale to publish the loopback proxy on
 * HTTPS port 443 of the node's tailnet name, which is reachable from every device in the
 * user's tailnet over WireGuard. On disable it only turns that port off when its handler
 * still points at this plugin's loopback port.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'

const run = promisify(execFile)
let activeServePort = null

const CANDIDATES = [
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
]

function executableCandidates() {
  const executable = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale'
  const dirs = String(process.env.PATH || process.env.Path || '').split(delimiter)
  const fromPath = dirs
    .map((dir) => dir.replace(/^"|"$/g, '').trim())
    .filter((dir) => dir && isAbsolute(dir) && resolve(dir) !== resolve(process.cwd()))
    .map((dir) => join(dir, executable))
  return [...new Set([...CANDIDATES, ...fromPath].filter((candidate) => isAbsolute(candidate)))]
}

/** @returns {Promise<string|null>} resolved executable path or null */
export async function findTailscale() {
  for (const candidate of executableCandidates()) {
    try {
      if (!existsSync(candidate)) continue
      const { stdout } = await run(candidate, ['version'], { timeout: 8000, windowsHide: true })
      if (stdout.trim().length > 0) return candidate
    } catch {
      /* keep looking */
    }
  }
  return null
}

/**
 * Read the node's tailnet identity.
 * @param {string} exe
 * @returns {Promise<{ backendState: string, dnsName: string|null, tailnet: string|null }>}
 */
export async function readStatus(exe) {
  const { stdout } = await run(exe, ['status', '--json'], { timeout: 12000, windowsHide: true })
  const parsed = JSON.parse(stdout)
  const dnsName = typeof parsed?.Self?.DNSName === 'string' ? parsed.Self.DNSName.replace(/\.$/, '') : null
  return {
    backendState: typeof parsed?.BackendState === 'string' ? parsed.BackendState : 'Unknown',
    dnsName,
    tailnet: typeof parsed?.CurrentTailnet?.Name === 'string' ? parsed.CurrentTailnet.Name : null
  }
}

/**
 * Publish the local proxy on the node's tailnet HTTP port.
 * @param {string} exe
 * @param {number} port loopback proxy port
 */
export async function serveOn443(exe, port) {
  const config = await readServeConfig(exe)
  const current = https443Config(config)
  if (current.unknown) throw new Error('无法识别当前 Tailscale Serve 配置，请先在本机检查 443 规则')
  if (current.hasPort) {
    if (matchesHarnessConfig(current, port)) return ''
    throw new Error('Tailscale HTTPS 443 已有 Serve 配置，请先在本机检查并清理冲突规则')
  }
  const { stdout, stderr } = await run(
    exe,
    ['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`],
    { timeout: 20000, windowsHide: true }
  )
  activeServePort = port
  return (stdout + stderr).trim()
}

export async function serveOn80(exe, port) {
  return serveOn443(exe, port)
}

export async function stopServe443(exe) {
  const port = activeServePort
  activeServePort = null
  if (port === null) return
  try {
    const config = await readServeConfig(exe)
    const current = https443Config(config)
    if (current.unknown || !current.hasPort || !matchesHarnessConfig(current, port)) return
    await run(exe, ['serve', '--https=443', 'off'], { timeout: 15000, windowsHide: true })
  } catch {
    return
  }
}

export async function stopServe80(exe) {
  return stopServe443(exe)
}

async function readServeConfig(exe) {
  try {
    const { stdout } = await run(exe, ['serve', 'status', '--json'], { timeout: 12000, windowsHide: true })
    const parsed = JSON.parse(stdout || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tailscale Serve 状态格式无效')
    return parsed
  } catch (error) {
    const output = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error instanceof Error ? error.message : String(error)}`
    if (/no serve config|no serve|nothing to serve|serve (?:is )?(?:not enabled|not configured)/i.test(output)) return {}
    throw new Error(`无法安全读取 Tailscale Serve 状态：${output.trim().slice(-300)}`)
  }
}

function https443Config(config) {
  const hasTcp = Object.hasOwn(config, 'TCP') || Object.hasOwn(config, 'tcp')
  const hasWeb = Object.hasOwn(config, 'Web') || Object.hasOwn(config, 'web')
  if ((!hasTcp && !hasWeb && Object.keys(config).length > 0) || (hasTcp && !objectMap(config.TCP || config.tcp)) || (hasWeb && !objectMap(config.Web || config.web))) {
    return { hasPort: false, unknown: true, tcpEntry: null, webEntries: [] }
  }
  const tcp = config?.TCP || config?.tcp
  const tcpEntry = tcp && (tcp['443'] || tcp[443])
  const web = config?.Web || config?.web
  const webEntries = []
  if (web && typeof web === 'object') {
    for (const [host, value] of Object.entries(web)) {
      const httpsHost = /^(?:https:\/\/[^/]+(?::443)?|[^/]+:443)\/?$/i.test(host)
      if (tcpEntry?.HTTPS === true || httpsHost) webEntries.push(value)
      else return { hasPort: false, unknown: true, tcpEntry, webEntries: [] }
    }
  }
  return { hasPort: Boolean(tcpEntry || webEntries.length), unknown: false, tcpEntry, webEntries }
}

function objectMap(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function matchesHarnessEntry(entry, port) {
  const handlers = entry?.Handlers || entry?.handlers
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) return false
  const keys = Object.keys(handlers)
  if (keys.length !== 1 || keys[0] !== '/') return false
  const handler = handlers['/']
  const proxy = handler?.Proxy || handler?.proxy
  return proxy === `http://127.0.0.1:${port}`
}

function matchesHarnessConfig(config, port) {
  if (config.tcpEntry && config.tcpEntry.HTTPS === false) return false
  if (config.webEntries.length) {
    return config.webEntries.length === 1 && matchesHarnessEntry(config.webEntries[0], port)
  }
  return matchesHarnessEntry(config.tcpEntry, port)
}

/**
 * Build the phone-facing URL for a served node.
 * @param {string|null} dnsName
 * @returns {string|null}
 */
export function publicUrlFor(dnsName) {
  if (!dnsName) return null
  return `https://${dnsName}/`
}

