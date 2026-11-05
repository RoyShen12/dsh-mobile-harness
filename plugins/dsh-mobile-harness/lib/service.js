/**
 * Remote-access service: the switch's state machine.
 *
 * Owns the loopback gateway, the Tailscale serve entry, the persisted password/secret and
 * the snapshot the UI polls. All failures end in `phase: 'error'` + `lastError` instead of
 * throwing into the Host event loop.
 */
import { GatewayProxy } from './proxy.js'
import { ensureTlsMaterials } from './tls.js'
import { loadState, saveState, randomPassword, randomSecret, resolveStateDir, readLegacyPassword } from './state.js'
import { DeviceRegistry } from './registry.js'
import { DeviceBridge } from './device-bridge.js'
import { CloudflaredTunnel } from './cloudflared.js'
import { findTailscale, readStatus, serveOn80, stopServe80, publicUrlFor } from './tailscale.js'
import { qrMatrix } from './qr.js'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { collectLanAddresses, pickLanAddress } from './lan.js'
import { listPool, saveUpload, openFile, removeFile, ensurePool, MAX_UPLOAD_BYTES, POOL_DIR } from './files.js'
import { pickFolder, hasNativePicker } from './picker.js'
import { createServer } from 'node:net'
import { requestUpstream, resolveUpstreamOrigin } from './upstream.js'

/** @typedef {'disabled'|'starting'|'enabled'|'stopping'|'error'} RemotePhase */

/** Plugin version for the diagnostics bundle; a broken/unreadable package.json is not fatal. */
export const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

/** Numeric semver comparison; pre-release suffixes are ignored, which is enough to spot a real update. */
export function compareVersions(left, right) {
  const parts = (value) => String(value || '').split(/[-+]/)[0].split('.').map((part) => Number.parseInt(part, 10)).map((n) => (Number.isFinite(n) ? n : 0))
  const a = parts(left)
  const b = parts(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const l = a[i] ?? 0
    const r = b[i] ?? 0
    if (l !== r) return l > r ? 1 : -1
  }
  return 0
}

/**
 * Keep the one-time ticket in the fragment, outside HTTP request URLs and relay logs.
 */
function withScanTicket(url, ticket) {
  if (!url || !ticket) return url || null
  const parsed = new URL(url)
  parsed.hash = new URLSearchParams({ t: ticket }).toString()
  return parsed.toString()
}

export class RemoteService {
  /**
   * @param {object} ctx Cordis host context
   */
  constructor(ctx) {
    this.ctx = ctx
    this.state = loadState()
    this.managementKey = randomBytes(32)
    this.phase = /** @type {RemotePhase} */ ('disabled')
    this.publicUrl = null
    this.lastPublicUrl = null
    this.lastError = null
    this.since = null
    this.tailscale = { dnsName: null, backendState: 'Unknown', exe: null }
    // Every enable/disable/switch runs through this promise chain: two transitions used to
    // interleave (proxy.start racing proxy.stop, cloudflared spawn racing taskkill) and left
    // the panel stuck on "starting" with every control disabled.
    this.transition = Promise.resolve()
    this.busy = null
    // npm's answer about the newest release; cached for hours so the panel cannot hammer the registry.
    this.updateCache = null
    if (!this.state.secret) {
      this.state.secret = randomSecret()
      saveState(this.state)
    }
    if (!this.state.password) {
      // Keep the phone usable across the launcher→plugin switch: reuse the launcher's
      // password when one exists, otherwise generate a fresh random one.
      this.state.password = readLegacyPassword() || randomPassword(9)
      saveState(this.state)
    }
    // Durable device trust lives in plugin-state.json; the gateway only keeps live sockets.
    this.registry = new DeviceRegistry(this.state, {
      persist: () => saveState(this.state),
      log: (message) => this.log(message)
    })
    this.registry.migrate()
    // Phone channel ("phone as hands"): the app long-polls the gateway for one command at a time.
    // It lives in the service so the panel, the gateway and the `phone` tool share one queue.
    this.bridge = new DeviceBridge({
      registry: this.registry,
      resolveDeviceReference: (reference) => this.resolveDeviceReference(reference),
      log: (message) => this.log(message)
    })
    this.proxy = new GatewayProxy({
      getUpstreamOrigin: () => this.webOrigin(),
      getDshCookie: () => this.resolveDshCookie(),
      getUiMode: () => this.state.uiMode,
      // Per-device override (a phone that picked its own layout); null falls back to getUiMode.
      getDeviceUiMode: (deviceId) => this.deviceUiMode(deviceId),
      verifyPassword: (candidate) => this.verifyPassword(candidate),
      addSession: (record) => this.addSession(record),
      findSession: (id) => this.state.sessions.find((entry) => entry.id === id),
      touchSession: (record) => this.touchSession(record),
      getSessions: () => this.state.sessions,
      revokeSession: (id) => this.revokeSession(id),
      revokeAllSessions: () => this.revokeAllSessions(),
      isBlacklisted: (deviceId) => this.isBlacklisted(deviceId),
      blacklistDevice: (deviceId) => this.addBlacklist(deviceId),
      unblacklistDevice: (deviceId) => this.removeBlacklist(deviceId),
      registry: this.registry,
      deviceBridge: this.bridge,
      getSessionSecret: () => Buffer.from(this.state.secret, 'base64url'),
      getPublicUrl: () => this.publicUrl,
      getTunnelMode: () => this.state.tunnel,
      log: (message) => this.log(message)
    })
    // Cloudflare quick tunnel: the zero-config public entry. Nothing starts here — the tunnel is
    // only launched from enable() when the user picked it, so an idle plugin spawns no process.
    this.cloudflared = new CloudflaredTunnel({
      stateDir: this.stateDir,
      log: (message) => this.log(message),
      warn: (message) => this.warn(message),
      onUrl: (url) => {
        // A restarted tunnel publishes a new host; keep the panel and the QR in sync.
        if (this.state.tunnel === 'quick' && this.phase === 'enabled') {
          this.publicUrl = url
          this.lastPublicUrl = url
        }
      }
    })
  }

  get stateDir() {
    return resolveStateDir()
  }

  /** The shared file pool: one folder the phone and this computer both read. */
  get fileDir() {
    const custom = this.state.filePoolDir
    return custom ? resolve(custom) : join(this.stateDir, POOL_DIR)
  }


  /** Open the OS folder picker and adopt whatever the owner chooses. */
  async pickFilePoolDir() {
    if (!hasNativePicker()) {
      return { ok: false, error: '只有电脑本机能弹出选择框；远程页面请直接填路径。' }
    }
    let picked
    try {
      picked = await pickFolder()
    } catch (error) {
      return { ok: false, error: '打开选择框失败：' + (error instanceof Error ? error.message : String(error)) }
    }
    if (!picked) return { ok: false, cancelled: true, error: '没有选择目录' }
    const result = await this.setFilePoolDir(picked)
    return { ...result, dir: picked }
  }

  /**
   * Point the pool somewhere else (another drive, a synced folder). An empty value restores the
   * default <state dir>/files. The folder is created when missing; existing files are not moved.
   */
  async setFilePoolDir(raw) {
    const text = String(raw ?? '').trim()
    if (text.length === 0) {
      this.state.filePoolDir = null
    } else {
      const target = resolve(text)
      try {
        mkdirSync(target, { recursive: true })
        await ensurePool(target)
      } catch (error) {
        return { ok: false, error: '这个目录用不了：' + (error instanceof Error ? error.message : String(error)), snapshot: this.snapshot() }
      }
      this.state.filePoolDir = target
    }
    saveState(this.state)
    this.log('file pool: ' + this.fileDir)
    return { ok: true, snapshot: this.snapshot() }
  }

  /** @returns {Promise<{ok: boolean, files: Array<{id: string, name: string, size: number, mtime: number}>, limit: number}>} */
  async listFiles() {
    return {
      ok: true,
      files: await listPool(this.fileDir),
      limit: MAX_UPLOAD_BYTES,
      dir: this.fileDir,
      custom: Boolean(this.state.filePoolDir)
    }
  }

  /** Store one uploaded buffer and return its pool entry. */
  async saveFile(name, bytes) {
    const file = await saveUpload(this.fileDir, name, bytes)
    this.log(`file pool: saved ${file.name} (${file.size} B)`)
    return { ok: true, file }
  }

  /** Resolve a pool id for streaming; null when it does not exist. */
  async openFileById(id) {
    return openFile(this.fileDir, id)
  }

  async deleteFileById(id) {
    const removed = await removeFile(this.fileDir, id)
    if (removed) this.log('file pool: removed ' + id)
    return { ok: removed }
  }

  /**
   * Run one transition at a time. Later callers queue instead of being silently dropped,
   * so a click during "正在启动" is applied right after the current transition settles.
   * @template T
   * @param {() => Promise<T>} run
   * @returns {Promise<T>}
   */
  serialize(run) {
    const next = this.transition.then(run, run)
    this.transition = next.then(
      () => {},
      () => {}
    )
    return next
  }

  log(message) {
    try {
      if (typeof this.ctx.logger?.info === 'function') this.ctx.logger.info(`dsh-mobile-harness: ${message}`)
      else console.log(`dsh-mobile-harness: ${message}`)
    } catch {
      /* logging must never fail a transition */
    }
  }

  warn(message) {
    try {
      if (typeof this.ctx.logger?.warn === 'function') this.ctx.logger.warn(`dsh-mobile-harness: ${message}`)
      else console.warn(`dsh-mobile-harness: ${message}`)
    } catch {
      /* ignore */
    }
  }

  verifyPassword(candidate) {
    if (typeof candidate !== 'string' || typeof this.state.password !== 'string') return false
    const submitted = Buffer.from(candidate)
    const expected = Buffer.from(this.state.password)
    return submitted.length === expected.length && timingSafeEqual(submitted, expected)
  }

  webPort() {
    try {
      return this.ctx.webServer.port
    } catch {
      return null
    }
  }

  /** The reachable origin published by the listener, with the older port-only fallback. */
  webOrigin() {
    return resolveUpstreamOrigin(this.ctx.webServer)
  }

  /** Resolve DSH's own owner cookie by exchanging this process's launch token. */
  async resolveDshCookie() {
    const base = `${this.webOrigin()}/`
    const tokenUrl = this.ctx.connection.authenticatedUrl(base)
    return new Promise((resolve, reject) => {
      const request = requestUpstream(tokenUrl, { agent: false, timeout: 5000 }, (response) => {
        const setCookie = response.headers['set-cookie']?.[0]
        response.resume()
        if (response.statusCode !== 303 || !setCookie) {
          reject(new Error(`无法获取 DSH 会话（HTTP ${response.statusCode}）`))
          return
        }
        resolve(setCookie.split(';')[0].trim())
      })
      request.on('timeout', () => request.destroy(new Error('获取 DSH 会话超时')))
      request.on('error', reject)
      request.end()
    })
  }

  /**
   * Best-effort discovery of a running SakuraFrp TCP tunnel from its daily log, so the
   * panel can show the public URL without asking the user to copy it by hand.
   * @returns {{url: string, endpoint: string, tls: boolean}|null}
   */
  detectSakuraFrp(dirOverride = null) {
    try {
      const dir = dirOverride || 'C:\\ProgramData\\SakuraFrpService\\Logs'
      if (!existsSync(dir)) return null
      // frpc rolls its log at midnight, but a service that kept running writes yesterday's file
      // until it restarts, so read the newest file instead of guessing today's name.
      const newest = readdirSync(dir)
        .filter((name) => /^SakuraFrpService\.\d{8}\.log$/.test(name))
        .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)[0]
      if (!newest) return null
      const lines = readFileSync(join(dir, newest.name), 'utf8').split(/\r?\n/)
      // Frpc only prints “连接映射目标 [tcp://127.0.0.1:64701] failed” when the forward is REFUSED.
      // That line survives in the file after the user fixes the port, so reading the whole log
      // reported a dead port on a perfectly healthy tunnel. Only the lines after the most recent
      // tunnel (re)load describe the current state — anything earlier is history.
      let start = 0
      for (let index = 0; index < lines.length; index += 1) {
        if (/开始加载隧道配置|隧道启动中/.test(lines[index])) start = index
      }
      const scope = lines.slice(start).join('\n')
      const scopedEndpoints = [...scope.matchAll(/使用\s*>>([^<]+)<<\s*连接你的隧道/g)]
      const endpoints = scopedEndpoints.length
        ? scopedEndpoints
        : [...lines.join('\n').matchAll(/使用\s*>>([^<]+)<<\s*连接你的隧道/g)]
      if (endpoints.length === 0) return null
      const endpoint = endpoints[endpoints.length - 1][1].trim()
      const tls = /Automatic TLS|自动生成|加载证书/.test(scope) || /Automatic TLS|自动生成|加载证书/.test(lines.join('\n'))
      // The loopback target, when frpc mentioned one in THIS attempt. Null means “unknown”, not
      // “wrong”: a healthy tunnel never logs it at all.
      const refused = [...scope.matchAll(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2})[^\n]*?连接映射目标\s*\[[^\]]*?:(\d+)\]/g)].pop()
      const localPort = refused ? Number(refused[2]) : null
      const localPortAt = refused ? refused[1].replace(/\//g, '-') : null
      const connected = /TCP 隧道启动成功|隧道启动成功/.test(scope)
      // frpc reports the tunnel to the frp server as started while the local forward can keep
      // being refused because nothing listens on that port. A refusal only describes the current
      // state when it is newer than the last successful start.
      const started = [...scope.matchAll(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2})[^\n]*?隧道启动成功/g)].pop()
      const startedAt = started ? started[1].replace(/\//g, '-') : null
      const refusedNow = Boolean(localPortAt) && (!startedAt || localPortAt >= startedAt)
      if (!tls) return null
      return {
        url: `${tls ? 'https' : 'http'}://${endpoint}/`,
        endpoint,
        tls,
        localPort,
        localPortAt,
        connected,
        startedAt,
        refused: refusedNow,
        refusedAt: refusedNow ? localPortAt : null,
        log: newest.name,
        logAt: newest.at
      }
    } catch {
      return null
    }
  }

  /**
   * Switch the public entry: Tailscale Serve, an external relay (SakuraFrp/frp), a Cloudflare
   * quick tunnel (no account required), a LAN/virtual-network listen, or loopback only.
   * @param {'tailscale'|'external'|'quick'|'lan'|'none'} mode
   */
  async setTunnel(mode) {
    if (!['tailscale', 'external', 'quick', 'lan', 'none'].includes(mode)) throw new Error('未知的入口类型')
    return this.serialize(async () => {
      // Switching the entry ALWAYS turns the switch off. The new entry needs a fresh enable
      // (tailscale serve, a new cloudflared host, a different relay), and re-enabling inline
      // made the panel sit on "正在启动" for up to 35 s with every control disabled.
      if (this.phase === 'enabled' || this.busy) {
        this.busy = 'stopping'
        try {
          await this.disable()
        } catch (error) {
          this.warn(`disable before switch failed: ${error instanceof Error ? error.message : String(error)}`)
          this.phase = 'disabled'
          this.publicUrl = null
          this.state.enabled = false
          saveState(this.state)
        } finally {
          this.busy = null
        }
      }
      this.state.tunnel = mode
      if (mode === 'external' && !this.state.externalUrl) {
        const detected = this.detectSakuraFrp()
        if (detected) this.state.externalUrl = detected.url
      }
      saveState(this.state)
      this.log(`entry switched to ${mode} (switch left off)`)
      return this.snapshot()
    })
  }

  /**
   * Persist the external public URL. An empty string clears it; auto-detect fills it from SakuraFrp.
   * @param {string|null|undefined} raw
   */
  setExternalUrl(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      this.state.externalUrl = null
      saveState(this.state)
      if (this.phase === 'enabled' && this.state.tunnel === 'external') {
        this.publicUrl = `http://127.0.0.1:${this.proxy.port ?? this.state.proxyPort}/`
      }
      return this.snapshot()
    }
    let parsed
    try {
      parsed = new URL(String(raw).trim())
    } catch {
      throw new Error('网址格式无效，示例：https://frp-cat.com:12345/')
    }
    if (parsed.protocol !== 'https:') throw new Error('外部隧道必须使用 HTTPS')
    if (parsed.username || parsed.password || parsed.pathname !== '/') throw new Error('请填写无用户名、密码或路径的 HTTPS 入口地址')
    parsed.hash = ''
    parsed.search = ''
    if (!parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname + '/'
    this.state.externalUrl = parsed.toString()
    saveState(this.state)
    if (this.phase === 'enabled' && this.state.tunnel === 'external') this.publicUrl = this.state.externalUrl
    return this.snapshot()
  }

  /** Clear the "online devices" registry (useful after test runs or stale entries). */
  resetDevices() {
    this.proxy.resetDevices()
    return this.snapshot()
  }

  // ── device management ───────────────────────────────────────────────────

  sessionOnline(id) {
    return Boolean(this.proxy && typeof this.proxy.sessionOnline === 'function' && this.proxy.sessionOnline(id))
  }

  addSession(record) {
    if (!Array.isArray(this.state.sessions)) this.state.sessions = []
    this.state.sessions.unshift(record)
    if (this.state.sessions.length > 60) this.state.sessions.length = 60
    saveState(this.state)
  }

  touchSession(record) {
    const now = Date.now()
    if (!record.lastTouchedAt || now - record.lastTouchedAt > 20000) {
      record.lastTouchedAt = now
      saveState(this.state)
    }
  }

  revokeSession(id) {
    const record = this.state.sessions.find((entry) => entry.id === id)
    if (!record) return null
    record.revoked = true
    record.revokedAt = Date.now()
    saveState(this.state)
    return record
  }

  revokeAllSessions() {
    const revoked = []
    for (const record of this.state.sessions) {
      if (record.revoked) continue
      record.revoked = true
      record.revokedAt = Date.now()
      revoked.push(record)
    }
    saveState(this.state)
    return revoked
  }

  isBlacklisted(deviceId) {
    if (!deviceId) return false
    const record = this.registry.get(deviceId)
    if (record && record.state === 'blocked') return true
    return this.state.blacklist.some((entry) => entry.deviceId === deviceId)
  }

  addBlacklist(deviceId) {
    if (!deviceId) return null
    if (!Array.isArray(this.state.blacklist)) this.state.blacklist = []
    const record = this.registry.get(deviceId)
    if (record) this.registry.block(deviceId, 'panel')
    const existing = this.state.blacklist.find((entry) => entry.deviceId === deviceId)
    if (existing) {
      saveState(this.state)
      return existing
    }
    const session = this.state.sessions.find((entry) => entry.deviceId === deviceId)
    const entry = {
      deviceId,
      label: record?.label ?? session?.label ?? '未知设备',
      userAgent: record?.userAgent ?? session?.userAgent ?? '',
      client: (record?.client ?? session?.client) === 'app' ? 'app' : 'web',
      at: Date.now()
    }
    this.state.blacklist.push(entry)
    saveState(this.state)
    return entry
  }

  removeBlacklist(deviceId) {
    if (!Array.isArray(this.state.blacklist)) this.state.blacklist = []
    this.state.blacklist = this.state.blacklist.filter((entry) => entry.deviceId !== deviceId)
    const record = this.registry.get(deviceId)
    if (record && record.state === 'blocked') this.registry.unblock(deviceId, 'panel')
    saveState(this.state)
    return true
  }

  /** Disconnect every live page of a device, without touching the trust record. */
  disconnectDevice(deviceId) {
    if (typeof deviceId !== 'string' || deviceId.length === 0) return []
    if (typeof this.proxy?.revokeDeviceSessions === 'function') return this.proxy.revokeDeviceSessions(deviceId)
    return []
  }

  deviceReference(deviceId) {
    if (!deviceId) return null
    return createHmac('sha256', this.managementKey).update(String(deviceId)).digest('base64url')
  }

  resolveDeviceReference(reference) {
    if (typeof reference !== 'string') return ''
    const record = this.registry.list().find((entry) => this.deviceReference(entry.deviceId) === reference)
    return record?.deviceId ?? ''
  }

  managementReferences(value) {
    if (Array.isArray(value)) return value.map((entry) => this.managementReferences(entry))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      key === 'deviceId' ? this.deviceReference(entry) : this.managementReferences(entry)
    ]))
  }

  /**
   * Panel API: the approval queue and the device list.
   *
   *   approve   {deviceId}   trust the phone, its waiting page connects on the next poll
   *   deny      {requestId}  or {deviceId}: refuse this attempt (60 s "denied" window)
   *   revokeDevice {deviceId} close its pages AND forget the trust (asks again next time)
   *   block / unblock        hard ban / lift it (the phone must be approved again)
   *   settings  {requireApproval?, maxOnlineDevices?}
   */
  handleDevices(body) {
    const action = typeof body?.action === 'string' ? body.action : ''
    const deviceId = this.resolveDeviceReference(body?.deviceId)
    if (action === 'revoke' && typeof body?.id === 'string') this.proxy.revokeSession(body.id)
    else if (action === 'revokeAll') {
      // "全部下线" = close every session AND drop the trust, so the next login has to be
      // allowed again — that is where the pairing code comes back.
      this.proxy.revokeAllSessions()
      this.bridge.dropAll('全部下线')
      const dropped = this.registry.revokeAll('panel')
      this.log('all devices kicked: sessions closed, trust dropped for ' + dropped + ' device(s)')
    }
    else if (action === 'approve' && deviceId) {
      const pending = this.registry.pendingForDevice(deviceId)
      const code = typeof body?.code === 'string' ? body.code.replace(/\s+/g, '') : ''
      if (pending && pending.code && code !== pending.code) throw new Error('配对码不一致：请核对手机屏幕上显示的数字')
      const record = this.registry.approve(deviceId, 'panel')
      if (!record) throw new Error('设备不存在')
      // A pending phone may already hold a half-open page from before approval; drop it so the
      // poll status endpoint is the only way in.
      this.log('device approved: ' + record.label + ' (' + record.client + ')')
    } else if (action === 'deny') {
      const request = typeof body?.requestId === 'string' ? this.registry.deny(body.requestId, 'panel') : null
      if (!request && deviceId) {
        const pending = this.registry.pendingForDevice(deviceId)
        if (pending) this.registry.deny(pending.requestId, 'panel')
      }
      if (!request && !deviceId) throw new Error('缺少待同意的请求')
      if (deviceId) this.disconnectDevice(deviceId)
    } else if (action === 'revokeDevice' && deviceId) {
      // "移除" = disconnect now + revoke trust: the phone has to be allowed again.
      this.disconnectDevice(deviceId)
      this.bridge.dropDevice(deviceId, '设备已被移除')
      this.registry.revoke(deviceId, 'panel')
      this.log('device removed: ' + deviceId.slice(0, 6) + '…')
    } else if ((action === 'block' || action === 'blacklist') && deviceId) {
      this.addBlacklist(deviceId)
      this.bridge.dropDevice(deviceId, '设备已被拉黑')
      this.disconnectDevice(deviceId)
    } else if ((action === 'unblock' || action === 'unblacklist') && deviceId) {
      this.removeBlacklist(deviceId)
      this.disconnectDevice(deviceId)
    } else if (action === 'settings') {
      const patch = body?.settings && typeof body.settings === 'object' ? body.settings : body
      this.registry.setSettings({
        requireApproval: patch?.requireApproval,
        maxOnlineDevices: patch?.maxOnlineDevices,
        phoneAssist: patch?.phoneAssist
      })
    } else if (action === 'phone') {
      // Owner switch for "the agent may act on the phone". Turning it off fails every command in
      // flight, so the agent cannot keep tapping while the panel says it is off.
      this.bridge.setEnabled(body?.enabled === true)
    } else if (action === 'phone-revoke' && deviceId) {
      this.bridge.revokeToken(deviceId)
      this.log('phone channel revoked for ' + deviceId.slice(0, 6) + '…')
    } else if (action === 'diag') {
      return { ok: true, diag: this.diagnostics() }
    } else if (action === 'reset') {
      this.proxy.revokeAllSessions()
      this.bridge.dropAll('设备记录已清空')
      this.registry.reset()
      this.state.sessions = []
      this.state.blacklist = []
      saveState(this.state)
    } else throw new Error('未知的设备操作')
    return this.snapshot()
  }

  /** Live view: who is online right now (open WebSockets), grouped per device. */
  buildDeviceList(enabled) {
    const onlineIds = enabled && typeof this.proxy?.onlineDeviceIds === 'function' ? this.proxy.onlineDeviceIds() : new Set()
    const sessionsByDevice = new Map()
    for (const session of this.state.sessions ?? []) {
      const key = session.deviceId || session.id
      const list = sessionsByDevice.get(key) ?? []
      list.push(session)
      sessionsByDevice.set(key, list)
    }
    const rows = []
    const seen = new Set()
    for (const record of this.registry.list()) {
      seen.add(record.deviceId)
      const sessions = sessionsByDevice.get(record.deviceId) ?? []
      const activeSessions = sessions.filter((entry) => !entry.revoked).length
      rows.push({
        deviceId: record.deviceId,
        label: record.label,
        client: record.client,
        clientVersion: record.clientVersion,
        state: record.state,
        // null = this phone follows the global default mode.
        uiMode: record.uiMode ?? null,
        trusted: record.state === 'trusted',
        blocked: record.state === 'blocked',
        revoked: record.state === 'revoked',
        online: onlineIds.has(record.deviceId),
        activeSessions,
        firstSeen: record.firstSeen,
        lastSeen: Math.max(record.lastSeen ?? 0, sessions.reduce((max, entry) => Math.max(max, entry.lastSeen ?? 0), 0)),
        lastLoginAt: record.lastLoginAt ?? null,
        approvedAt: record.approvedAt ?? null,
        latestId: sessions[0]?.id ?? null
      })
    }
    // Sessions of devices the registry does not know (should not happen after migrate, but keep
    // the panel honest rather than hiding a live page).
    for (const [key, sessions] of sessionsByDevice) {
      if (seen.has(key)) continue
      const latest = sessions[0]
      rows.push({
        deviceId: key,
        label: latest?.label || '未知设备',
        client: latest?.client === 'app' ? 'app' : 'web',
        clientVersion: latest?.clientVersion || '',
        state: 'revoked',
        trusted: false,
        uiMode: null,
        blocked: false,
        revoked: true,
        online: onlineIds.has(key),
        activeSessions: sessions.filter((entry) => !entry.revoked).length,
        firstSeen: latest?.issuedAt ?? null,
        lastSeen: latest?.lastSeen ?? null,
        lastLoginAt: latest?.lastSeen ?? null,
        approvedAt: null,
        latestId: latest?.id ?? null
      })
    }
    // Online first (green light on top), then most recently seen.
    rows.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
    })
    return rows
  }

  /** True when a loopback TCP port can actually be bound right now. */
  /**
   * Current relay hint for the panel, throttled: snapshot() runs once a second and re-reading the
   * frpc log that often is pure waste. Returns null when nothing is known.
   * @returns {{localPort: number|null, localPortAt: string|null, connected: boolean, log: string, logAt: number}|null}
   */
  relayHint(now = Date.now()) {
    if (this.relayCache && now - this.relayCache.at < 3000) return this.relayCache.value
    const detected = this.detectSakuraFrp()
    const value = detected
      ? { localPort: detected.localPort, localPortAt: detected.localPortAt, connected: detected.connected, startedAt: detected.startedAt, refused: detected.refused, refusedAt: detected.refusedAt, log: detected.log, logAt: detected.logAt }
      : null
    this.relayCache = { at: now, value }
    return value
  }

  canBind(port) {
    if (!Number.isInteger(port) || port <= 0) return Promise.resolve(false)
    return new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
  }

  /** GET a URL and report only the status code (0 = no answer). Used by the self-check. */
  probeUrl(rawUrl, timeoutMs = 5000) {
    return new Promise((resolve) => {
      let target
      try {
        target = new URL(rawUrl)
      } catch {
        resolve({ code: 0, error: 'bad-url' })
        return
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        resolve({ code: 0, error: 'bad-protocol' })
        return
      }
      const req = requestUpstream(
        target,
        {
          method: 'GET',
          timeout: timeoutMs,
          headers: { 'user-agent': 'dsh-mobile-harness-selfcheck', 'accept-encoding': 'identity' }
        },
        (res) => {
          res.resume()
          resolve({ code: res.statusCode ?? 0, location: res.headers.location ?? null })
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

  /**
   * One-click diagnosis: walk every hop the phone's request crosses and name the one that breaks.
   * Read-only: it binds nothing and changes no state, so it is safe to press while the switch is on.
   * @returns {Promise<{ok: boolean, checkedAt: number, steps: Array<{id: string, label: string, status: 'ok'|'warn'|'fail', detail: string, hint: string|null}>}>}
   */
  async selfCheck() {
    const steps = []
    const add = (id, label, status, detail, hint = null) => steps.push({ id, label, status, detail, hint })
    const port = this.proxy.port ?? this.state.proxyPort ?? null
    let upstream
    let upstreamError
    try { upstream = this.webOrigin() } catch (error) { upstreamError = error instanceof Error ? error.message : String(error) }

    if (this.phase === 'enabled') add('switch', '总开关', 'ok', '已打开', null)
    else add('switch', '总开关', 'fail', '当前状态：' + this.phase, '打开面板顶部的总开关')

    if (!port) {
      add('gateway', '网关监听', 'fail', '还没有端口', '打开开关再看')
    } else {
      const hit = await this.probeUrl('http://127.0.0.1:' + port + '/', 2500)
      if (hit.code) add('gateway', '网关监听', 'ok', '127.0.0.1:' + port + ' 有响应（HTTP ' + hit.code + '）', null)
      else add('gateway', '网关监听', 'fail', '127.0.0.1:' + port + ' 没有响应（' + hit.error + '）', '关掉开关再打开一次')
    }

    if (!upstream) {
      add('upstream', 'DSH 本体', 'fail', upstreamError || '读不到宿主 Web 地址', '检查宿主 Web 监听配置')
    } else {
      const hit = await this.probeUrl(upstream + '/', 2500)
      if (hit.code) add('upstream', 'DSH 本体', 'ok', upstream + ' 在跑（HTTP ' + hit.code + '）', null)
      else add('upstream', 'DSH 本体', 'fail', upstream + ' 没有响应（' + hit.error + '）', '检查宿主监听地址、协议及证书信任')
    }

    if (this.state.tunnel === 'external') {
      // Result first, cause second: if the public URL answers, the link is up and the target port
      // is by definition correct — whatever an old frpc line in the log still says.
      const url = this.publicUrl || this.state.externalUrl || ''
      const hit = url ? await this.probeUrl(url, 6000) : { code: 0, error: 'no-url' }
      const relay = this.relayHint()
      if (hit.code) {
        add('public', '外网地址', 'ok', url + ' 返回 HTTP ' + hit.code + '，链路已通', null)
        if (relay?.localPort) add('relay', '隧道本地端口', 'ok', '隧道 ' + relay.localPort + ' / 网关 ' + port + '（链路已通，端口一致）', null)
      } else if (relay?.refused && relay.localPort === port) {
        // frpc is connected to the frp server, yet nothing answers on the loopback port: the
        // tunnel is healthy and the port number is RIGHT, the local service is simply not up.
        // Saying '端口不对' here would send the user to fix the wrong thing.
        add('public', '外网地址', 'fail', url + ' 连不上（' + hit.error + '）', 'frpc 自己连上了 frp，但转发到 127.0.0.1:' + port + ' 一直被拒（最后一次 ' + (relay.refusedAt || '未知时间') + '）—— 这个端口现在没人监听：先确认面板顶部的总开关是打开的、DSH 还在运行')
        add('relay', '隧道本地端口', 'ok', '隧道与网关都指向 ' + port + '，端口本身没错', null)
      } else if (!url) {
        add('public', '外网地址', 'fail', '还没有外网地址', '在「网络入口」里填 SakuraFrp 给的地址，或点「自动检测」')
      } else {
        add('public', '外网地址', 'fail', url + ' 连不上（' + hit.error + '）', '下面是本地侧的线索；先确认 SakuraFrp 客户端里这条隧道是「已启动」')
        if (!relay) {
          add('relay', 'SakuraFrp 隧道', 'warn', '没读到 frpc 的运行日志（' + 'C:\\ProgramData\\SakuraFrpService\\Logs' + '）', '去 SakuraFrp 面板确认这条隧道的「本地端口」等于网关端口 ' + port)
        } else if (relay.localPort) {
          const bindable = await this.canBind(relay.localPort)
          const when = relay.localPortAt ? '（frpc 记录于 ' + relay.localPortAt + '）' : ''
          if (relay.localPort === port) add('relay', '隧道本地端口', 'ok', '隧道与网关都在 ' + port + when, null)
          else if (!bindable) add('relay', '隧道本地端口', 'fail', '隧道转发到 ' + relay.localPort + '，但系统禁止绑定这个端口（EACCES）；网关在 ' + port + when, '把 SakuraFrp 里这条隧道的「本地端口」改成 ' + port)
          else add('relay', '隧道本地端口', 'fail', '隧道转发到 ' + relay.localPort + '，网关却在 ' + port + when, '把 SakuraFrp 里这条隧道的「本地端口」改成 ' + port)
        } else {
          add('relay', '隧道本地端口', 'warn', 'frpc 日志里没有当前这次转发的目标端口（隧道正常时它不打印）' + (relay.connected ? '，frpc 自己报告已连上' : ''), '去 SakuraFrp 面板确认「本地端口」等于网关端口 ' + port)
        }
      }
    } else if (this.state.tunnel === 'quick') {
      const cloudflareState = this.cloudflared.state
      if (cloudflareState === 'running') add('cloudflare', 'Cloudflare 隧道', 'ok', '运行中：' + (this.publicUrl ?? '—'), null)
      else add('cloudflare', 'Cloudflare 隧道', 'fail', '状态：' + cloudflareState, '点「重连」，或切到局域网 / 外部隧道')
      if (this.publicUrl) {
        const hit = await this.probeUrl(this.publicUrl, 6000)
        if (hit.code) add('public', '外网地址', 'ok', this.publicUrl + ' 返回 HTTP ' + hit.code, null)
        else add('public', '外网地址', 'fail', this.publicUrl + ' 连不上（' + hit.error + '）', 'quick 隧道地址每次重启都会变，重新扫码')
      }
    } else if (this.state.tunnel === 'lan') {
      const addresses = this.lanAddresses()
      const chosen = this.preferredLanAddress()
      if (addresses.length) {
        const detail = addresses
          .map((entry) => entry.address + '（' + entry.name + '）' + (entry.address === chosen ? ' ← 二维码用这个' : ''))
          .join('，')
        add('lan', '本机地址', 'warn', detail, '手机必须和电脑在同一个网段；地址不对就到「网络入口 → 本机地址」点「用这个」换一条')
        if (this.state.lanAddress && this.state.lanAddress !== chosen) {
          add('lan-pick', '记住的地址', 'warn', '记住的 ' + this.state.lanAddress + ' 现在不在线，已临时改用 ' + chosen, '网卡拔了或虚拟组网没连；重新连上后会自动回到它')
        }
      } else {
        add('lan', '本机地址', 'fail', '没找到非回环 IPv4', '电脑没连网络？')
      }
    } else if (this.state.tunnel === 'tailscale') {
      if (this.tailscale?.dnsName) add('tailscale', 'Tailscale', 'ok', this.tailscale.dnsName + '（' + this.tailscale.backendState + '）', null)
      else add('tailscale', 'Tailscale', 'fail', '没拿到 Tailscale 主机名', '本机运行 tailscale up 并登录')
    } else {
      add('entry', '入口', 'warn', '仅本机，手机连不上', '选一个网络入口')
    }

    const pending = (this.state.pendingRequests || []).filter((item) => item.status === 'pending').length
    const max = Number(this.state.settings?.maxOnlineDevices ?? 0)
    add(
      'devices',
      '设备准入',
      pending ? 'warn' : 'ok',
      (this.state.devices || []).length + ' 台已登记' + (pending ? '，' + pending + ' 台等你同意' : '') + (max ? '，在线上限 ' + max : '，不限在线'),
      pending ? '到「设备准入」核对配对码后点允许' : null
    )

    return { ok: steps.every((step) => step.status !== 'fail'), checkedAt: Date.now(), steps }
  }

  /**
   * IPv4 addresses this machine can be reached at from the same Wi-Fi or a virtual LAN
   * (皎月连 / ZeroTier / Tailscale / Radmin all hand out an address that shows up here).
   * The ordering lives in lib/lan.js so the panel and tools/diagnose.mjs cannot disagree.
   */
  lanAddresses() {
    return collectLanAddresses()
  }

  /**
   * The IPv4 address the QR / public URL should advertise for the lan entry: the one the owner
   * picked, or the best-ranked one. A stale choice (adapter unplugged, VPN gone) falls back instead
   * of handing out an address that cannot answer.
   * @returns {string|null}
   */
  preferredLanAddress() {
    return pickLanAddress(this.lanAddresses(), this.state.lanAddress)
  }

  /**
   * Pin the lan entry to one adapter address (null = back to automatic). Live: the gateway already
   * listens on 0.0.0.0, so only the advertised URL and the QR change, with no rebind.
   * @param {string|null|undefined} raw
   */
  setLanAddress(raw) {
    const list = this.lanAddresses()
    const value = typeof raw === 'string' && raw.trim() ? raw.trim() : null
    if (value && !list.some((entry) => entry.address === value)) throw new Error('这台机器上没有这个地址：' + value)
    this.state.lanAddress = value
    saveState(this.state)
    if (this.state.tunnel === 'lan' && this.phase === 'enabled') {
      const port = this.proxy.port ?? this.state.proxyPort
      this.publicUrl = `http://${this.preferredLanAddress() ?? '127.0.0.1'}:${port}/`
      this.lastPublicUrl = this.publicUrl
    }
    this.log(`lan address ${value ?? 'auto'}`)
    return this.snapshot()
  }

  /**
   * Choose the viewport served to phones and tablets. Applies on the next page load (the viewport
   * is part of the HTML the gateway injects), so the panel tells the owner to refresh.
   *
   * Without a deviceId this is the default every device without its own choice gets; with one it
   * stores that phone's own mode, so two phones can run different layouts at the same time.
   * @param {'auto'|'phone'|'tablet'|'compat'|'default'} mode 'default' clears a device override
   * @param {string|null} [deviceId]
   */
  setUiMode(mode, deviceId = null) {
    const known = ['auto', 'phone', 'tablet', 'compat']
    if (!known.includes(mode) && !(mode === 'default' && deviceId)) throw new Error('未知的界面模式')
    if (deviceId) {
      const record = this.registry.get(deviceId)
      if (!record) throw new Error('找不到这台设备，刷新页面再试')
      record.uiMode = mode === 'default' ? null : mode
      saveState(this.state)
      this.log(`ui mode ${mode === 'default' ? 'follows the default' : mode} for device ${String(deviceId).slice(0, 8)}… (applies on the next page load)`)
      return this.snapshot()
    }
    this.state.uiMode = mode
    saveState(this.state)
    this.log(`ui mode ${mode} (applies on the next page load)`)
    return this.snapshot()
  }

  /**
   * This device's own viewport choice. null means it follows the global default.
   * @param {string|null} deviceId
   * @returns {string|null}
   */
  deviceUiMode(deviceId) {
    if (!deviceId) return null
    return this.registry.get(deviceId)?.uiMode ?? null
  }

  /**
   * Ask npm whether a newer dsh-mobile-harness exists. Mirrors are tried in order, the answer is
   * cached for six hours, and a network failure is reported as "unknown" instead of throwing:
   * an offline machine still shows its own version in the tab bar.
   * @param {boolean} force ignore the cache and ask again
   * @returns {Promise<{current: string, latest: string|null, hasUpdate: boolean, checkedAt: number, error: string|null}>}
   */
  async checkUpdate(force = false) {
    const now = Date.now()
    if (!force && this.updateCache && now - this.updateCache.at < 6 * 60 * 60 * 1000) return this.updateCache.value
    const sources = [
      'https://registry.npmmirror.com/dsh-mobile-harness/latest',
      'https://registry.npmjs.org/dsh-mobile-harness/latest'
    ]
    let latest = null
    let error = null
    for (const url of sources) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
        if (!response.ok) {
          error = `HTTP ${response.status}`
          continue
        }
        const body = await response.json()
        if (typeof body?.version === 'string' && body.version) {
          latest = body.version
          error = null
          break
        }
        error = 'no version field'
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    }
    const value = {
      current: PLUGIN_VERSION,
      latest,
      hasUpdate: latest ? compareVersions(latest, PLUGIN_VERSION) > 0 : false,
      checkedAt: now,
      error: latest ? null : error
    }
    this.updateCache = { at: now, value }
    if (value.hasUpdate) this.log(`update available: ${PLUGIN_VERSION} -> ${latest}`)
    return value
  }

  snapshot() {
    const enabled = this.phase === 'enabled'
    // The relay's real target port only exists in frpc's log, and reading it here (throttled) is what
    // makes a SakuraFrp port change take effect without restarting DSH.
    const relay = enabled && this.state.tunnel === 'external' ? this.relayHint() : null
    const gatewayPort = this.proxy.port ?? this.state.proxyPort ?? null
    // A remembered adapter can disappear (unplugged cable, VPN off); fall back rather than advertise
    // an address nothing answers on. The picker still shows the stored choice as unavailable.
    const lanList = this.lanAddresses()
    const lanSelected = this.state.lanAddress && lanList.some((entry) => entry.address === this.state.lanAddress)
      ? this.state.lanAddress
      : lanList[0]?.address ?? null
    // The QR carries a one-time scan ticket, never the password: the ticket is burnt after
    // admission accepts it and expires after ten minutes, so a screenshot of the panel stops
    // working — while one scan still drops the browser straight in (it is the owner's own screen).
    const ticket = enabled && this.publicUrl ? this.proxy.currentTicket?.() ?? null : null
    const qrText = enabled && this.publicUrl ? withScanTicket(this.publicUrl, ticket) : null
    let qr = null
    if (qrText) {
      qr = qrMatrix(qrText)
    }
    return this.managementReferences({
      pluginVersion: PLUGIN_VERSION,
      // Last npm answer, if the panel already asked; the tab bar reads it without another request.
      update: this.updateCache?.value ?? null,
      phase: this.phase,
      enabled,
      busy: this.busy,
      tunnel: this.state.tunnel,
      publicUrl: this.publicUrl,
      /** The loopback port the external relay forwards to (null when unknown / not external). */
      relay,
      relayLocalPort: relay?.localPort ?? this.relayLocalPort ?? null,
      // Only complain when frpc is NOT already connected: a healthy tunnel logs no target line at
      // all, and a stale “refused” line from before the fix must not turn into a red banner.
      relayPortMismatch: Boolean(relay?.localPort && gatewayPort && relay.localPort !== gatewayPort && !relay.connected),
      // Every address this machine owns, with the one the QR currently advertises marked, so the
      // panel can offer a picker instead of silently choosing the first adapter.
      lanAddress: lanSelected,
      lanAddresses: lanList.map((entry) => ({ ...entry, selected: entry.address === lanSelected })),
      lanUrl: enabled && this.state.tunnel === 'lan' ? this.publicUrl : null,
      // The default viewport for phones/tablets that have not picked their own.
      uiMode: this.state.uiMode,
      filePoolDir: this.fileDir,
      filePoolCustom: Boolean(this.state.filePoolDir),
      // Only meaningful on 'auto': the mode the last phone/tablet request actually got.
      uiModeProbe: this.state.uiMode === 'auto' ? (this.proxy.uiModeEffective?.() ?? null) : null,
      lastPublicUrl: this.lastPublicUrl,
      qrText,
      qrTicketExpiresAt: enabled && ticket ? (this.proxy.ticketDeadline?.() ?? null) : null,
      qr,
      proxyPort: this.proxy.port ?? this.state.proxyPort ?? null,
      tlsPort: this.proxy.tlsPort ?? null,
      externalUrl: this.state.externalUrl ?? null,
      passwordEnabled: true,
      clients: enabled ? this.proxy.pageCount() : 0,
      devices: enabled ? this.proxy.deviceCount() : 0,
      deviceList: this.buildDeviceList(enabled),
      onlineDevices: enabled ? this.proxy.onlineDeviceIds().size : 0,
      settings: this.registry.settings,
      phone: this.bridge.snapshot(),
      pending: this.registry.pendingList().map((entry) => ({
        requestId: entry.requestId,
        deviceId: entry.deviceId,
        label: entry.label,
        client: entry.client,
        clientVersion: entry.clientVersion,
        pairCode: entry.code || '',
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt
      })),
      audit: this.registry.auditList(12),
      sessions: (this.state.sessions ?? []).map((entry) => ({
        id: entry.id,
        deviceId: entry.deviceId,
        label: entry.label || '未知设备',
        client: entry.client === 'app' ? 'app' : 'web',
        clientVersion: entry.clientVersion || '',
        createdAt: entry.issuedAt,
        lastSeen: entry.lastSeen,
        revoked: Boolean(entry.revoked),
        online: this.sessionOnline(entry.id)
      })),
      blacklist: (this.state.blacklist ?? []).map((entry) => ({
        deviceId: entry.deviceId,
        label: entry.label || '未知设备',
        at: entry.at
      })),
      pages: enabled ? this.proxy.pageCount() : 0,
      since: this.since,
      lastError: this.lastError,
      webPort: this.webPort(),
      tailscale: {
        dnsName: this.tailscale.dnsName,
        backendState: this.tailscale.backendState,
        available: Boolean(this.tailscale.exe)
      },
      cloudflare: this.cloudflared.snapshot()
    })
  }

  /**
   * Secret-free support snapshot for "my phone cannot connect" reports. Built from a whitelist —
   * never by deleting fields from snapshot() — so a new secret cannot leak in by accident. The
   * pairing code, password, session secret, DSH cookie and tunnel token are all absent by design.
   */
  diagnostics() {
    const enabled = this.phase === 'enabled'
    const devices = this.buildDeviceList(enabled)
    const pending = this.registry.pendingList()
    const now = Date.now()
    return {
      pluginVersion: PLUGIN_VERSION,
      kind: 'dsh-mobile-harness.diagnostics',
      schema: 1,
      generatedAt: new Date(now).toISOString(),
      plugin: { name: 'dsh-mobile-harness', version: PLUGIN_VERSION },
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      service: {
        phase: this.phase,
        enabled,
        busy: Boolean(this.busy),
        since: this.since,
        lastError: this.lastError ? 'gateway-transition-failed' : null
      },
      gateway: {
        proxyPort: this.proxy.port ?? this.state.proxyPort ?? null,
        tlsPort: this.proxy.tlsPort ?? null,
        webPort: this.webPort(),
        tunnel: this.state.tunnel,
        cloudflareState: this.cloudflared.state,
        cloudflareHost: hostOf(this.cloudflared.url),
        publicHost: hostOf(this.publicUrl),
        lastPublicHost: hostOf(this.lastPublicUrl),
        passwordEnabled: true,
        onlineDevices: enabled ? this.proxy.onlineDeviceIds().size : 0,
        onlinePages: enabled ? this.proxy.pageCount() : 0
      },
      admission: {
        requireApproval: this.registry.settings?.requireApproval ?? true,
        maxOnlineDevices: this.registry.settings?.maxOnlineDevices ?? null,
        pendingCount: pending.length,
        pending: pending.map((entry) => ({
          label: entry.label,
          client: entry.client,
          clientVersion: entry.clientVersion || '',
          waitedSeconds: Math.max(0, Math.round((now - (entry.createdAt ?? now)) / 1000))
        })),
        devices: devices.map((row) => ({
          label: row.label,
          client: row.client,
          clientVersion: row.clientVersion || '',
          state: row.state,
          online: Boolean(row.online),
          activeSessions: row.activeSessions ?? 0,
          lastSeen: row.lastSeen ?? null
        })),
        blacklistCount: (this.state.blacklist ?? []).length
      },
      // Phone channel: op names and outcomes only — no screen text, no typed content, no token.
      phone: {
        enabled: this.bridge.enabled,
        onlineCount: this.bridge.snapshot().onlineCount,
        devices: this.bridge.snapshot().devices.map((entry) => ({
          label: entry.label,
          authorized: entry.authorized,
          online: entry.online,
          lastOp: entry.lastOp,
          lastError: entry.lastError ? 'device-operation-failed' : null
        })),
        trace: this.bridge.snapshot().trace.slice(0, 8).map((entry) => ({ kind: entry.kind, op: entry.op, ms: entry.ms }))
      },
      audit: this.registry.auditList(20).map((entry) => ({
        at: entry.at,
        action: entry.action,
        label: entry.label,
        actor: entry.actor
      }))
    }
  }

  /** @param {boolean} enabled */
  async setEnabled(enabled) {
    return this.serialize(async () => {
      if (enabled === (this.phase === 'enabled')) return this.snapshot()
      this.busy = enabled ? 'starting' : 'stopping'
      this.lastError = null
      try {
        if (enabled) await this.enable()
        else await this.disable()
      } catch (error) {
        this.phase = 'error'
        this.lastError = error instanceof Error ? error.message : String(error)
        this.warn(`remote access transition failed: ${this.lastError}`)
        this.state.enabled = false
        saveState(this.state)
        await this.safeStopEverything()
      } finally {
        this.busy = null
      }
      return this.snapshot()
    })
  }

  /**
   * Download the cloudflared binary into the plugin state dir (~50 MB, official URL then a mirror).
   * Safe to call twice: an in-flight download is reused.
   */
  async installCloudflared() {
    // Fire and forget: a 50 MB download must not hold the HTTP request (and the panel's
    // "下载" button) hostage. Progress and failures surface through snapshot().cloudflare.
    if (!this.cloudflared.downloading) {
      this.cloudflared.install().catch((error) => {
        this.warn(`cloudflared install failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    return this.snapshot()
  }

  /** Stop an in-flight cloudflared download (panel 停止下载). Partial bytes are dropped. */
  cancelCloudflared() {
    this.cloudflared.cancelDownload()
    return this.snapshot()
  }

  /**
   * Delete the downloaded binary (panel 删除). The escape hatch for a corrupt or half-written
   * file: remove it, then download again. Refused while a tunnel is actually running, because
   * deleting the exe under a live process leaves the panel showing an address that is gone.
   */
  async removeCloudflared() {
    const live = this.cloudflared.state === 'running' || this.cloudflared.state === 'starting'
    if (live) throw new Error('Cloudflare 隧道正在运行：先关掉上面的开关，再删除')
    const next = await this.cloudflared.removeBinary()
    if (this.state.tunnel === 'quick') this.publicUrl = null
    return this.snapshot()
  }

  /** Manual reconnect for a stuck quick tunnel: keeps the mode, gets a fresh public URL. */
  async restartCloudflared() {
    if (this.state.tunnel !== 'quick' || this.phase !== 'enabled') {
      throw new Error('Cloudflare 隧道未启用')
    }
    const started = await this.cloudflared.restart()
    this.publicUrl = started.url
    this.lastPublicUrl = started.url
    return this.snapshot()
  }

  async enable() {
    this.phase = 'starting'
    this.publicUrl = null
    this.webOrigin()
    // LAN entries accept connections on every interface (Wi-Fi, and virtual LANs such as 皎月连 or
    // ZeroTier); every other entry keeps the listener on loopback and reaches it through its tunnel.
    const host = this.state.tunnel === 'lan' ? '0.0.0.0' : '127.0.0.1'

    let dnsName = null
    if (this.state.tunnel === 'tailscale') {
      const exe = await findTailscale()
      if (!exe) throw new Error('未找到 tailscale.exe；请先安装 Tailscale 并登录')
      const status = await readStatus(exe)
      this.tailscale = { exe, dnsName: status.dnsName, backendState: status.backendState }
      if (status.backendState !== 'Running' || !status.dnsName) {
        throw new Error(`Tailscale 未就绪（${status.backendState}）。请在本机运行 tailscale up 并完成登录`)
      }
      dnsName = status.dnsName
    }

    // The TLS twin is only needed for relays without automatic HTTPS. SakuraFrp terminates TLS
    // itself, so keep it off by default: it avoids an extra loopback listener and a blocking
    // certificate-generation child process during app startup.
    if (this.state.tlsEnabled === true) {
      this.proxy.options.tls = ensureTlsMaterials(this.stateDir)
      this.proxy.options.tlsPort = 64702
    } else {
      this.proxy.options.tls = null
      this.proxy.options.tlsPort = null
    }

    // An external relay forwards to one fixed loopback port. Follow frpc's own target when the
    // log is readable, else keep the remembered port: binding elsewhere makes the tunnel answer
    // 502 and the phone shows a bare "connection refused".
    let preferredPort = this.state.proxyPort
    let relayLocalPort = null
    // frpc's target port wins whenever it is readable, whatever entry is selected: the relay is a
    // fixed port, so a gateway that drifted elsewhere answers every request through it with 502.
    const relay = this.detectSakuraFrp()
    if (relay?.localPort) {
      relayLocalPort = relay.localPort
      // Ports the OS refuses to bind (EACCES: a VPN/safety client or a reserved range holds them)
      // must not become the preferred port: try it, and keep the remembered one when it fails.
      if (await this.canBind(relay.localPort)) {
        preferredPort = relay.localPort
      } else {
        this.warn(`relay local port ${relay.localPort} cannot be bound on this machine (EACCES); keeping ${preferredPort}. Change the tunnel local port in SakuraFrp to match the gateway port.`)
      }
    }
    this.relayLocalPort = relayLocalPort
    const boundPort = await this.proxy.start(preferredPort, host)
    if (relayLocalPort && relayLocalPort !== boundPort) {
      this.warn(`relay forwards to 127.0.0.1:${relayLocalPort} but the gateway bound ${boundPort}: change the tunnel local port in SakuraFrp to ${boundPort}`)
    }
    this.state.proxyPort = boundPort
    this.state.enabled = true
    saveState(this.state)

    if (this.state.tunnel === 'tailscale') {
      try {
        await serveOn80(this.tailscale.exe, boundPort)
      } catch (error) {
        throw new Error(`tailscale serve 失败：${error instanceof Error ? error.message : String(error)}`)
      }
      this.publicUrl = publicUrlFor(dnsName)
    } else if (this.state.tunnel === 'quick') {
      // Needs an outbound connection only; the URL is scraped from cloudflared's own log.
      const started = await this.cloudflared.start(boundPort)
      this.publicUrl = started.url
    } else if (this.state.tunnel === 'external') {
      if (!this.state.externalUrl) {
        const detected = this.detectSakuraFrp()
        if (detected) {
          this.state.externalUrl = detected.url
          saveState(this.state)
        }
      }
      if (!this.state.externalUrl) throw new Error('请先配置 HTTPS 外部隧道地址')
      const external = new URL(this.state.externalUrl)
      if (external.protocol !== 'https:' || external.username || external.password || external.pathname !== '/') {
        throw new Error('外部隧道必须使用无凭据和路径的 HTTPS 地址，请重新保存入口')
      }
      this.publicUrl = external.toString()
    } else if (this.state.tunnel === 'lan') {
      const primary = this.preferredLanAddress()
      this.publicUrl = `http://${primary ?? '127.0.0.1'}:${boundPort}/`
      if (!primary) this.warn('lan entry: no non-loopback IPv4 address found; the QR falls back to 127.0.0.1')
    } else {
      this.publicUrl = `http://127.0.0.1:${boundPort}/`
    }
    this.lastPublicUrl = this.publicUrl
    this.since = Date.now()
    this.phase = 'enabled'
    this.log(`remote access enabled on ${this.publicUrl} (gateway ${host}:${boundPort})`)
  }

  async disable() {
    this.phase = 'stopping'
    await this.safeStopEverything()
    this.state.enabled = false
    saveState(this.state)
    this.publicUrl = null
    this.since = null
    this.phase = 'disabled'
    this.log('remote access disabled')
  }

  async safeStopEverything() {
    // A scan ticket only lives while the switch is on: stopping the gateway burns it, so a
    // screenshot taken earlier cannot sign a browser in after the owner turned the switch off.
    this.proxy.resetTicket?.()
    try {
      await this.cloudflared.stop()
    } catch (error) {
      this.warn(`cloudflared stop failed: ${String(error)}`)
    }
    try {
      await this.proxy.stop()
    } catch (error) {
      this.warn(`gateway stop failed: ${String(error)}`)
    }
    if (this.tailscale.exe) {
      try {
        await stopServe80(this.tailscale.exe)
      } catch {
        /* ignore */
      }
    }
  }

  setPasswordEnabled(enabled) {
    if (enabled !== true) throw new Error('网关始终要求密码或一次性扫码票据')
    this.state.passwordEnabled = true
    saveState(this.state)
    return this.snapshot()
  }

  async rotatePassword(password) {
    if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 128)) {
      throw new Error('密码长度需为 12–128 个字符')
    }
    return this.serialize(async () => {
      const next = password ?? randomPassword(12)
      this.proxy.revokeAllSessions()
      this.bridge.dropAll('网关密码已重置')
      this.registry.revokeAll('password-reset')
      this.state.password = next
      this.state.passwordEnabled = true
      this.state.secret = randomSecret()
      this.proxy.resetAuthentication?.()
      this.proxy.resetTicket?.()
      saveState(this.state)
      return { snapshot: this.snapshot() }
    })
  }

  async init() {
    if (!this.state.enabled) return
    // Enabling the gateway binds a loopback port and talks to the host web server. Doing that
    // synchronously while the desktop shell is still booting occasionally made the startup
    // window fail with net::ERR_NETWORK_ACCESS_DENIED, so defer it a few seconds and retry.
    const attempt = async (remaining) => {
      try {
        await this.setEnabled(true)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        if (remaining > 1) {
          this.startupTimer = setTimeout(() => attempt(remaining - 1), 5000)
        }
      }
    }
    this.startupTimer = setTimeout(() => attempt(3), 4000)
  }

  async dispose() {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    await this.safeStopEverything()
  }
}

/** `https://host:port/` → `host:port`; empty or unparsable → null. */
function hostOf(url) {
  if (typeof url !== 'string' || !url) return null
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}
