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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * Append the one-time scan ticket to the public URL the QR encodes. The address itself keeps the
 * trailing slash the relays hand out, so the ticket lands as "?t=…" on the root path.
 */
function withScanTicket(url, ticket) {
  if (!url || !ticket) return url || null
  const glue = url.includes('?') ? '&' : '?'
  return url + glue + 't=' + ticket
}

export class RemoteService {
  /**
   * @param {object} ctx Cordis host context
   */
  constructor(ctx) {
    this.ctx = ctx
    this.state = loadState()
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
      log: (message) => this.log(message)
    })
    this.proxy = new GatewayProxy({
      upstreamHost: '127.0.0.1',
      upstreamPort: 0,
      getDshCookie: () => this.resolveDshCookie(),
      verifyPassword: (candidate) => this.verifyPassword(candidate),
      passwordEnabled: () => this.state.passwordEnabled === true,
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
      sessionSecret: Buffer.from(this.state.secret, 'base64url'),
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
    const a = Buffer.from(candidate)
    const b = Buffer.from(this.state.password)
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
    return diff === 0
  }

  webPort() {
    try {
      return this.ctx.webServer.port
    } catch {
      return null
    }
  }

  /** Resolve DSH's own owner cookie by exchanging this process's launch token. */
  async resolveDshCookie() {
    const port = this.webPort()
    if (!port) throw new Error('宿主 Web 服务尚未就绪')
    const base = `http://127.0.0.1:${port}/`
    const tokenUrl = this.ctx.connection.authenticatedUrl(base)
    const response = await fetch(tokenUrl, { redirect: 'manual' })
    const setCookie = response.headers.get('set-cookie')
    await response.body?.cancel?.()
    if (response.status !== 303 || !setCookie) {
      throw new Error(`无法获取 DSH 会话（HTTP ${response.status}）`)
    }
    return setCookie.split(';')[0].trim()
  }

  /**
   * Best-effort discovery of a running SakuraFrp TCP tunnel from its daily log, so the
   * panel can show the public URL without asking the user to copy it by hand.
   * @returns {{url: string, endpoint: string, tls: boolean}|null}
   */
  detectSakuraFrp() {
    try {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      const file = join('C:\\ProgramData\\SakuraFrpService\\Logs', `SakuraFrpService.${stamp}.log`)
      if (!existsSync(file)) return null
      const text = readFileSync(file, 'utf8')
      const matches = [...text.matchAll(/使用\s*>>([^<]+)<<\s*连接你的隧道/g)]
      if (matches.length === 0) return null
      const endpoint = matches[matches.length - 1][1].trim()
      const tls = /Automatic TLS|自动生成|加载证书/.test(text)
      return { url: `${tls ? 'https' : 'http'}://${endpoint}/`, endpoint, tls }
    } catch {
      return null
    }
  }

  /**
   * Switch the public entry: Tailscale Serve, an external relay (SakuraFrp/frp), a Cloudflare
   * quick tunnel (no account required), or loopback only.
   * @param {'tailscale'|'external'|'quick'|'none'} mode
   */
  async setTunnel(mode) {
    if (!['tailscale', 'external', 'quick', 'none'].includes(mode)) throw new Error('未知的入口类型')
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
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('只支持 http/https 网址')
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
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
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
        state: 'trusted',
        trusted: true,
        blocked: false,
        revoked: false,
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

  snapshot() {
    const enabled = this.phase === 'enabled'
    const password = this.state.password || ''
    // The QR carries a one-time scan ticket (?t=), never the password: the ticket is burnt by the
    // first scan and expires after ten minutes, so a screenshot of the panel stops working —
    // while one scan still drops the browser straight in (it is the owner's own screen).
    const ticket = enabled && this.publicUrl ? this.proxy.currentTicket?.() ?? null : null
    const qrText = enabled && this.publicUrl ? withScanTicket(this.publicUrl, ticket) : null
    let qr = null
    if (qrText) {
      qr = qrMatrix(qrText)
    }
    return {
      pluginVersion: PLUGIN_VERSION,
      phase: this.phase,
      enabled,
      busy: this.busy,
      tunnel: this.state.tunnel,
      publicUrl: this.publicUrl,
      lastPublicUrl: this.lastPublicUrl,
      password,
      qrText,
      qrTicketExpiresAt: enabled && ticket ? (this.proxy.ticketDeadline?.() ?? null) : null,
      qr,
      proxyPort: this.proxy.port ?? this.state.proxyPort ?? null,
      tlsPort: this.proxy.tlsPort ?? null,
      externalUrl: this.state.externalUrl ?? null,
      passwordEnabled: this.state.passwordEnabled === true,
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
      stateDir: this.stateDir,
      webPort: this.webPort(),
      tailscale: {
        dnsName: this.tailscale.dnsName,
        backendState: this.tailscale.backendState,
        available: Boolean(this.tailscale.exe)
      },
      cloudflare: this.cloudflared.snapshot()
    }
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
        lastError: this.lastError
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
        passwordEnabled: this.state.passwordEnabled === true,
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
          lastError: entry.lastError ? String(entry.lastError).slice(0, 80) : null
        })),
        trace: this.bridge.snapshot().trace.slice(0, 8).map((entry) => ({ kind: entry.kind, op: entry.op, ms: entry.ms }))
      },
      audit: this.registry.auditList(20).map((entry) => ({
        at: entry.at,
        action: entry.action,
        label: entry.label,
        actor: entry.actor
      })),
      storage: { stateDir: this.stateDir }
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
    const port = this.webPort()
    if (!port) throw new Error('宿主 Web 服务尚未就绪')
    this.proxy.options.upstreamPort = port

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

    const boundPort = await this.proxy.start(this.state.proxyPort)
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
      this.publicUrl = this.state.externalUrl || `http://127.0.0.1:${boundPort}/`
    } else {
      this.publicUrl = `http://127.0.0.1:${boundPort}/`
    }
    this.lastPublicUrl = this.publicUrl
    this.since = Date.now()
    this.phase = 'enabled'
    this.log(`remote access enabled on ${this.publicUrl} (gateway 127.0.0.1:${boundPort})`)
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

  /** @param {string} [password] */
  /**
   * Toggle the password gate. Disabled = transparent gateway (no login page, access by URL).
   * @param {boolean} enabled
   */
  setPasswordEnabled(enabled) {
    this.state.passwordEnabled = enabled === true
    saveState(this.state)
    return this.snapshot()
  }

  async rotatePassword(password) {
    const next = typeof password === 'string' && password.length >= 8 ? password : randomPassword(9)
    this.proxy.resetTicket?.()
    this.state.password = next
    // Rotate the session secret too: every paired device must log in with the new password.
    this.state.secret = randomSecret()
    saveState(this.state)
    const wasEnabled = this.phase === 'enabled'
    if (wasEnabled) {
      // Restart the gateway so the new secret takes effect.
      await this.setEnabled(false)
      await this.setEnabled(true)
    }
    return { password: next, snapshot: this.snapshot() }
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
