/**
 * In-process password gateway for the remote-access switch.
 *
 * The phone talks to this loopback listener through Tailscale Serve. The gateway:
 *   - refuses everything until the app has signed in (password +, when required, the pairing
 *     code); no URL query may grant a session;
 *   - keeps DSH's own 30-day owner cookie private and injects it upstream;
 *   - rewrites `Host` to the loopback authority and drops `Origin`, so DSH's browser-trust
 *     fence accepts the request (it compares Origin with Host and never sees the tunnel host);
 *   - relays WebSocket upgrades (`/api/remote.mux`) raw.
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE = 'dsh-gw'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600

/**
 * Per-browser identity, so the panel can say "1 台设备" instead of counting raw TCP
 * sockets (one page opens many). Issued on login, valid for a year, refreshed by use.
 */
const DEVICE_COOKIE = 'dsh-device'
const DEVICE_MAX_AGE_SECONDS = 365 * 24 * 3600
/** A device without an open page counts as online this long after its last request. */
const DEVICE_IDLE_TTL_MS = 60000
/** A device without an open page only counts as online for this long after its last request. */
const DEVICE_RECENT_MS = 15000

/**
 * The QR carries this ticket instead of the password. Scanning the panel's own screen is the
 * owner's consent, so one scan may enter — but the ticket dies on first use and after ten
 * minutes, which keeps a screenshot of the panel from becoming a permanent key.
 */
const TICKET_TTL_MS = 10 * 60 * 1000

/** Wrong-password budget per device and globally, inside one window (brute-force guard). */
const FAILURE_WINDOW_MS = 5 * 60 * 1000
const FAILURE_LIMIT_PER_DEVICE = 5
const FAILURE_LIMIT_GLOBAL = 20

const CANDIDATE_PORTS = [
  64700, 64701, 64702, 64800, 64801, 64900, 64901, 50100, 50101, 50200, 50201, 55100, 55101
]

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const segment of header.split(';')) {
    const index = segment.indexOf('=')
    if (index !== -1 && segment.slice(0, index).trim() === name) return segment.slice(index + 1).trim()
  }
  return undefined
}

/**
 * @param {object} options
 * @param {() => Promise<string>} options.getDshCookie resolves the `dsh-auth-…=…` header
 * @param {(candidate: string) => boolean} options.verifyPassword
 * @param {Buffer} options.sessionSecret HMAC key persisted across restarts
 * @param {(message: string) => void} [options.log]
 */

/** Human-readable device label derived from the User-Agent. */
function describeUserAgent(userAgent) {
  const ua = String(userAgent || '')
  let platform = '未知设备'
  if (/Android/i.test(ua)) platform = 'Android'
  else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'iPhone/iPad'
  else if (/Windows/i.test(ua)) platform = 'Windows'
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = 'macOS'
  else if (/Linux/i.test(ua)) platform = 'Linux'
  let browser = ''
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  return browser ? `${platform} · ${browser}` : platform
}

/** Minimal HTML escaping for the two server-rendered pages. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch])
}

/** The browser form posts urlencoded; the in-page poller posts JSON. Accept both. */
function parseFormBody(text, contentType) {
  const raw = String(text || '')
  if (/json/i.test(String(contentType || ''))) {
    try {
      const parsed = JSON.parse(raw || '{}')
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  const out = {}
  for (const [key, value] of new URLSearchParams(raw)) out[key] = value
  return out
}

export class GatewayProxy {
  constructor(options) {
    this.options = options
    this.server = null
    this.port = null
    /** TLS twin of the loopback listener, for relays that refuse plain HTTP. */
    this.tlsServer = null
    this.tlsPort = null
    this.dshCookie = null
    this.sockets = new Set()
    this.startedAt = null
    /** deviceId -> { firstSeen, lastSeen, pages } */
    this.devices = new Map()
    /** live `/api/remote.mux` WebSocket connections (≈ open DSH pages) */
    this.pages = 0
    /** Reuse upstream sockets: a fresh TCP handshake per request is wasted work. */
    this.upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 })
    /** sessionId -> Set<socket> so a revoked device is disconnected immediately. */
    this.sessionSockets = new Map()
    /** deviceId -> { count, firstAt }: failed /__verify attempts inside the current window. */
    this.failures = new Map()
    /** The one live scan ticket (see TICKET_TTL_MS); burnt on the first scan. */
    this.ticket = null
    this.ticketExpiresAt = 0
  }

  // ── one-time scan ticket ─────────────────────────────────────────────────

  /** The ticket the panel should encode right now; reused until it is burnt or expires. */
  currentTicket() {
    if (!this.ticket || this.ticketExpiresAt <= Date.now()) {
      this.ticket = randomBytes(18).toString('base64url')
      this.ticketExpiresAt = Date.now() + TICKET_TTL_MS
    }
    return this.ticket
  }

  /** When the current ticket stops working (epoch ms, 0 when none). */
  ticketDeadline() {
    return this.ticket ? this.ticketExpiresAt : 0
  }

  /** Burn the ticket: used after a successful scan, a password rotation or a switch-off. */
  resetTicket() {
    this.ticket = null
    this.ticketExpiresAt = 0
  }

  /** @returns {boolean} true only for the live ticket, which is consumed on the spot */
  consumeTicket(value) {
    if (typeof value !== 'string' || value.length === 0) return false
    if (!this.ticket || this.ticketExpiresAt <= Date.now()) return false
    if (value !== this.ticket) return false
    this.resetTicket()
    return true
  }

  /**
   * Long-lived caching for content-addressed assets. DSH's static files carry a content
   * hash in their names, so a phone that already loaded them should never fetch them again
   * over a slow relay link.
   * @param {string} path request path (without query string)
   * @param {number|undefined} status upstream status
   * @returns {string|null}
   */
  cachePolicy(path, status) {
    if (status !== 200) return null
    if (/^\/(assets|plugins)\//.test(path)) return 'public, max-age=31536000, immutable'
    if (path === '/manifest.webmanifest' || path === '/favicon.svg') return 'public, max-age=86400'
    return null
  }

  /** @deprecated raw socket count — kept for older clients; use `pageCount()`. */
  get clients() {
    return this.pages
  }

  /**
   * Distinct browsers that currently hold an open page, plus devices that had a page very
   * recently. Plain API/health-check traffic never creates an "online device", which used to
   * inflate the count after test runs.
   */
  deviceCount() {
    const now = Date.now()
    let active = 0
    for (const [id, entry] of this.devices) {
      const recent = entry.hadPage && now - entry.lastSeen <= DEVICE_RECENT_MS
      if (entry.pages > 0 || recent) active += 1
      else if (now - entry.lastSeen > DEVICE_IDLE_TTL_MS) this.devices.delete(id)
    }
    return active
  }

  /** Clear the device registry (manual reset from the panel). */
  resetDevices() {
    this.devices.clear()
  }

  /** Open DSH pages, one WebSocket each. */
  pageCount() {
    return this.pages
  }

  deviceCookieValue(id) {
    return `${DEVICE_COOKIE}=${id}; Max-Age=${DEVICE_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax`
  }

  /** Append one Set-Cookie to a header value that may be absent/string/array. */
  static withCookie(headers, cookie) {
    const existing = headers['set-cookie']
    const merged = existing === undefined
      ? [cookie]
      : Array.isArray(existing)
        ? [...existing, cookie]
        : [existing, cookie]
    return { ...headers, 'set-cookie': merged }
  }

  /**
   * Identify the browser and refresh its activity stamp.
   * @returns {{ id: string, isNew: boolean }}
   */
  touchDevice(req) {
    const now = Date.now()
    let id = readCookie(req, DEVICE_COOKIE)
    let isNew = false
    if (typeof id !== 'string' || id.length < 6) {
      id = randomBytes(9).toString('base64url')
      isNew = true
    }
    const entry = this.devices.get(id)
    if (entry) entry.lastSeen = now
    else this.devices.set(id, { firstSeen: now, lastSeen: now, pages: 0, hadPage: false })
    return { id, isNew }
  }

  /** Create a session record for this device and return its signed cookie. */
  issueSession(req, device) {
    const id = randomBytes(12).toString('base64url')
    const issuedAt = Date.now()
    const appHeader = String(req.headers['x-dsh-client'] ?? '').toLowerCase()
    const clientVersion = String(req.headers['x-dsh-client-version'] ?? '').slice(0, 32)
    const record = {
      id,
      issuedAt,
      lastSeen: issuedAt,
      deviceId: device?.id ?? null,
      label: describeUserAgent(req.headers['user-agent']),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 240),
      client: appHeader === 'app' ? 'app' : 'web',
      clientVersion,
      revoked: false
    }
    this.options.addSession?.(record)
    return `${id}.${issuedAt}.${sign(this.options.sessionSecret, `${id}.${issuedAt}`)}`
  }

  /** Validate a session cookie against the signed token AND the persisted registry. */
  resolveSession(raw) {
    if (typeof raw !== 'string') return null
    const parts = raw.split('.')
    if (parts.length !== 3) return null
    const [id, issuedRaw, signature] = parts
    const expected = sign(this.options.sessionSecret, `${id}.${issuedRaw}`)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const issuedAt = Number(issuedRaw)
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt >= SESSION_MAX_AGE_SECONDS * 1000) return null
    const record = this.options.findSession?.(id)
    if (!record || record.revoked) return null
    record.lastSeen = Date.now()
    this.options.touchSession?.(record)
    return record
  }

  /** Stable device id for an app installation: HMAC of the app-generated installation id. */
  installationDeviceId(installationId) {
    if (typeof installationId !== 'string' || !/^[A-Za-z0-9_-]{12,128}$/.test(installationId)) return null
    return sign(this.options.sessionSecret, `install:${installationId}`).slice(0, 22)
  }

  // ── admission: who is this device, and may it come in? ────────────────────

  /** The persisted device registry, when the service wired one. */
  get registry() {
    return this.options.registry ?? null
  }

  /** Approval policy; without a registry the gateway keeps its 0.3.x open behaviour. */
  get admissionPolicy() {
    const registry = this.registry
    return registry ? registry.settings : { requireApproval: false, maxOnlineDevices: 0 }
  }

  /** Everything the registry needs to know about the caller. */
  identifyDevice(req) {
    const installationRaw = req.headers['x-dsh-client-id']
    const installationDevice = this.installationDeviceId(installationRaw)
    const userAgent = String(req.headers['user-agent'] ?? '')
    const client = String(req.headers['x-dsh-client'] ?? '').toLowerCase() === 'app' ? 'app' : 'web'
    let id = installationDevice
    let isNew = false
    if (!id) {
      const cookie = readCookie(req, DEVICE_COOKIE)
      if (typeof cookie === 'string' && cookie.length >= 6) id = cookie
      else {
        id = randomBytes(9).toString('base64url')
        isNew = true
      }
    }
    let runtime = this.devices.get(id)
    if (!runtime) {
      runtime = { firstSeen: Date.now(), lastSeen: Date.now(), pages: 0, hadPage: false }
      this.devices.set(id, runtime)
    }
    runtime.lastSeen = Date.now()
    return {
      id,
      isNew,
      client,
      clientVersion: String(req.headers['x-dsh-client-version'] ?? '').slice(0, 32),
      label: describeUserAgent(userAgent),
      userAgent: userAgent.slice(0, 240),
      installation: Boolean(installationDevice)
    }
  }

  noteFailure(deviceId) {
    const now = Date.now()
    for (const key of [deviceId, 'global']) {
      const entry = this.failures.get(key)
      if (!entry || now - entry.firstAt > FAILURE_WINDOW_MS) this.failures.set(key, { count: 1, firstAt: now })
      else entry.count += 1
    }
  }

  clearFailures(deviceId) {
    this.failures.delete(deviceId)
  }

  rateLimited(deviceId) {
    const now = Date.now()
    for (const key of [deviceId, 'global']) {
      const entry = this.failures.get(key)
      if (!entry) continue
      if (now - entry.firstAt > FAILURE_WINDOW_MS) {
        this.failures.delete(key)
        continue
      }
      const limit = key === 'global' ? FAILURE_LIMIT_GLOBAL : FAILURE_LIMIT_PER_DEVICE
      if (entry.count >= limit) return true
    }
    return false
  }

  /** Devices that currently hold an open page (one WebSocket per page). */
  onlineDeviceIds() {
    const ids = new Set()
    for (const [id, entry] of this.devices) {
      if (entry && entry.pages > 0) ids.add(id)
    }
    for (const [sessionId, sockets] of this.sessionSockets) {
      if (!sockets || sockets.size === 0) continue
      const record = this.options.findSession?.(sessionId)
      ids.add(record && record.deviceId ? record.deviceId : sessionId)
    }
    return ids
  }

  isDeviceOnline(deviceId) {
    if (!deviceId) return false
    const entry = this.devices.get(deviceId)
    if (entry && entry.pages > 0) return true
    for (const [sessionId, sockets] of this.sessionSockets) {
      if (!sockets || sockets.size === 0) continue
      const record = this.options.findSession?.(sessionId)
      if (record && record.deviceId === deviceId) return true
    }
    return false
  }

  /**
   * Enforce the "maximum online devices" setting. The caller's own device is never counted
   * against itself, so several tabs of one phone still use a single slot.
   * @returns {{online: number, max: number}|null} non-null when the limit is already reached
   */
  onlineLimit(deviceId) {
    const max = this.admissionPolicy.maxOnlineDevices
    if (!max || max <= 0) return null
    const others = this.onlineDeviceIds()
    others.delete(deviceId)
    if (others.size < max) return null
    return { online: others.size, max }
  }

  /** A removed/blocked device must lose even a still-valid session cookie. */
  revokedByPolicy(deviceId) {
    const registry = this.registry
    if (!registry || !deviceId) return false
    if (registry.settings.requireApproval === false) return false
    const record = registry.get(deviceId)
    return Boolean(record && (record.state === 'revoked' || record.state === 'blocked'))
  }

  sendJson(res, status, payload, cookies) {
    let headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    for (const cookie of cookies ?? []) headers = GatewayProxy.withCookie(headers, cookie)
    res.writeHead(status, headers)
    res.end(JSON.stringify(payload))
  }

  /**
   * POST /__verify (password + device identity) and POST /__verify/status (poll a pending
   * request). Both answer JSON; the app decides between "entered", "waiting" and the errors.
   */
  handleVerify(req, res, url, bodyText) {
    let body = {}
    try {
      body = JSON.parse(bodyText)
    } catch {
      body = {}
    }
    const device = this.identifyDevice(req)
    const registry = this.registry
    const existing = registry ? registry.get(device.id) : null
    if (existing && existing.state === 'blocked') {
      this.sendJson(res, 403, { ok: false, code: 'blocked', blacklisted: true, label: existing.label })
      return
    }
    if (this.rateLimited(device.id)) {
      this.sendJson(res, 429, { ok: false, code: 'too-many', message: '尝试过于频繁，请 5 分钟后再试' })
      return
    }
    if (url.pathname === '/__verify/status') {
      this.handleVerifyStatus(req, res, body, device)
      return
    }

    const submitted = typeof body?.password === 'string' ? body.password : ''
    const ticket = typeof body?.ticket === 'string' ? body.ticket : ''
    const passwordOk = this.options.verifyPassword(submitted)
    // A scan code carries a one-time ticket instead of the password (0.5.6): trading it in here
    // means a phone that never stored a password can still sign in. The ticket is burnt on use and
    // admission below still applies, so a screenshot of the panel is worthless.
    const ticketOk = passwordOk ? false : this.consumeTicket(ticket)
    if (!passwordOk && !ticketOk) {
      // A stale ticket is not a wrong password: do not count it towards the lockout, and say so.
      if (ticket) {
        this.sendJson(res, 401, { ok: false, code: 'ticket' })
        return
      }
      this.noteFailure(device.id)
      this.sendJson(res, 401, { ok: false, code: 'password' })
      return
    }
    this.clearFailures(device.id)

    const issue = () => {
      registry?.markLogin(device.id)
      this.sendJson(res, 200, { ok: true, deviceId: device.id, label: registry?.get(device.id)?.label ?? device.label }, [
        this.sessionCookieValue(req, device),
        this.deviceCookieValue(device.id)
      ])
    }

    const admitted = this.admitDevice(device)
    if (admitted.ok) {
      issue()
      return
    }
    if (admitted.status === 202) {
      this.options.log?.(
        'admission: waiting for approval from ' + admitted.pending.label + ' (' + admitted.pending.client + ')'
      )
      this.sendJson(res, 202, {
        ok: false,
        code: 'pending',
        pending: true,
        requestId: admitted.pending.requestId,
        pairCode: admitted.pending.pairCode,
        label: admitted.pending.label,
        client: admitted.pending.client,
        expiresAt: admitted.pending.expiresAt
      })
      return
    }
    this.sendJson(res, admitted.status, admitted.payload)
  }

  /**
   * The one admission decision both callers share (the app's POST /__verify and the browser's
   * login form), so the app and a browser can never drift apart on trust, codes or limits.
   * @returns {{ok: true, record?: object} | {ok: false, status: number, payload?: object, pending?: object}}
   */
  admitDevice(device) {
    const registry = this.registry
    if (!registry) return { ok: true }
    const policy = this.admissionPolicy
    const { record } = registry.touch(device.id, device)
    let trusted = record.state === 'trusted'
    // "Removed" means the user revoked this device on purpose: it has to be allowed again and
    // therefore has to see a pairing code, even when approval is switched off. Otherwise the
    // policy's auto-trust would cancel the removal at the next login and the code never appears.
    const removed = record.state === 'revoked'
    if (!trusted) {
      const denial = registry.recentDenial(device.id)
      if (denial) return { ok: false, status: 403, payload: { ok: false, code: 'denied', label: record.label } }
      if (!policy.requireApproval && !removed) {
        registry.autoTrust(device.id, 'policy')
        trusted = true
      }
    }
    const limit = this.onlineLimit(device.id)
    if (limit) {
      return {
        ok: false,
        status: 403,
        payload: { ok: false, code: 'max-online', online: limit.online, max: limit.max, label: record.label }
      }
    }
    if (trusted) return { ok: true, record }
    const queued = registry.requestApproval(record)
    if (!queued.ok) return { ok: false, status: 403, payload: { ok: false, code: 'max-pending', label: record.label } }
    return {
      ok: false,
      status: 202,
      pending: {
        requestId: queued.request.requestId,
        pairCode: queued.request.code,
        label: record.label,
        client: record.client,
        expiresAt: queued.request.expiresAt
      }
    }
  }

  handleVerifyStatus(req, res, body, device) {
    const registry = this.registry
    if (!registry) {
      this.sendJson(res, 503, { ok: false, code: 'unavailable' })
      return
    }
    const record = registry.get(device.id)
    if (record && record.state === 'blocked') {
      this.sendJson(res, 403, { ok: false, code: 'blocked', blacklisted: true, label: record.label })
      return
    }
    if (record && record.state === 'trusted') {
      const limit = this.onlineLimit(device.id)
      if (limit) {
        this.sendJson(res, 403, { ok: false, code: 'max-online', online: limit.online, max: limit.max, label: record.label })
        return
      }
      registry.markLogin(device.id)
      this.sendJson(res, 200, { ok: true, approved: true, deviceId: device.id, label: record.label }, [
        this.sessionCookieValue(req, device),
        this.deviceCookieValue(device.id)
      ])
      return
    }
    const requestId = typeof body?.requestId === 'string' ? body.requestId : ''
    const request = requestId ? registry.getRequest(requestId) : registry.pendingForDevice(device.id)
    if (!request || request.deviceId !== device.id) {
      this.sendJson(res, 403, { ok: false, code: 'expired' })
      return
    }
    if (request.status === 'denied') {
      this.sendJson(res, 403, { ok: false, code: 'denied', label: request.label })
      return
    }
    const limit = this.onlineLimit(device.id)
    if (limit) {
      this.sendJson(res, 403, { ok: false, code: 'max-online', online: limit.online, max: limit.max, label: request.label })
      return
    }
    this.sendJson(res, 202, {
      ok: false,
      code: 'pending',
      pending: true,
      requestId: request.requestId,
      pairCode: request.code,
      label: request.label,
      client: request.client,
      expiresAt: request.expiresAt
    })
  }

  // ── browser entry: one-time scan ticket, then a real login form ──────────

  /**
   * A scan of the panel's own screen. The ticket proves the caller is standing in front of the
   * owner's computer, so the password is skipped — but it is NOT the approval: the device goes
   * through the same admission as the app, so a first-time browser still has to be allowed on the
   * computer with the matching pairing code. The ticket is burnt here (single use, 10 minutes).
   */
  handleTicket(req, res, url) {
    if (!this.consumeTicket(url.searchParams.get('t'))) {
      this.serveLoginPage(res, '这个二维码已经用过或过期了（一次性，10 分钟）。重新扫码，或输入密码进入。', 401)
      return
    }
    const device = this.touchDevice(req)
    if (this.isBlacklisted(device.id)) {
      this.serveText(res, 403, 'This device is blocked.')
      return
    }
    const registry = this.registry
    const userAgent = String(req.headers['user-agent'] ?? '')
    if (registry) {
      registry.touch(device.id, {
        label: describeUserAgent(userAgent),
        client: 'web',
        clientVersion: '',
        userAgent: userAgent.slice(0, 240)
      })
      const record = registry.get(device.id)
      if (record && record.state === 'blocked') {
        this.serveLoginPage(res, '这台设备已被拉黑，先在电脑上解除。', 403)
        return
      }
    }
    const admitted = this.admitDevice(device)
    if (admitted.ok) {
      registry?.markLogin(device.id)
      const clean = new URL(url.href)
      clean.searchParams.delete('t')
      this.options.log?.('scan ticket accepted for ' + describeUserAgent(userAgent))
      res.writeHead(302, {
        location: clean.pathname + (clean.search || ''),
        'cache-control': 'no-store',
        'set-cookie': [this.sessionCookieValue(req, device), this.deviceCookieValue(device.id)]
      })
      res.end()
      return
    }
    if (admitted.status === 202) {
      this.options.log?.(
        'scan ticket queued for approval (' + admitted.pending.label + '), code shown on both sides'
      )
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': [this.deviceCookieValue(device.id)]
      })
      res.end(this.waitingPage(admitted.pending))
      return
    }
    const code = admitted.payload?.code
    if (code === 'max-online') {
      this.serveLoginPage(res, '在线设备已达上限（' + admitted.payload.online + '/' + admitted.payload.max + '），先在电脑上移除一台。', 403)
    } else if (code === 'denied') {
      this.serveLoginPage(res, '电脑上点过「拒绝」，过一会儿再试。', 403)
    } else if (code === 'max-pending') {
      this.serveLoginPage(res, '等待同意的设备太多了，先在电脑上处理一下。', 403)
    } else {
      this.serveLoginPage(res, '这台设备现在不能进入。', 403)
    }
  }

  /** GET shows the password form, POST runs it through the same admission as the app. */
  handleLogin(req, res, url) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      this.serveLoginPage(res, '', 200)
      return
    }
    if (req.method !== 'POST') {
      this.serveLoginPage(res, '这个地址只接受 GET 和 POST。', 405)
      return
    }
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        this.completeLogin(req, res, Buffer.concat(chunks).toString('utf8'))
      } catch (error) {
        this.options.log?.('browser login failed: ' + String(error?.message || error))
        this.serveLoginPage(res, '登录出错了，刷新页面再试一次。', 500)
      }
    })
  }

  completeLogin(req, res, bodyText) {
    const body = parseFormBody(bodyText, req.headers['content-type'])
    const device = this.identifyDevice(req)
    const registry = this.registry
    const existing = registry ? registry.get(device.id) : null
    if (existing && existing.state === 'blocked') {
      this.serveLoginPage(res, '这台设备已被拉黑，先在电脑上解除。', 403)
      return
    }
    if (this.rateLimited(device.id)) {
      this.serveLoginPage(res, '尝试过于频繁，请 5 分钟后再试。', 429)
      return
    }
    const submitted = typeof body?.password === 'string' ? body.password : ''
    if (!this.options.verifyPassword(submitted)) {
      this.noteFailure(device.id)
      this.serveLoginPage(res, '密码不对，再试一次。', 401)
      return
    }
    this.clearFailures(device.id)
    const admitted = this.admitDevice(device)
    if (admitted.ok) {
      registry?.markLogin(device.id)
      this.options.log?.('browser login: ' + describeUserAgent(req.headers['user-agent']) + ' entered')
      res.writeHead(302, {
        location: '/',
        'cache-control': 'no-store',
        'set-cookie': [this.sessionCookieValue(req, device), this.deviceCookieValue(device.id)]
      })
      res.end()
      return
    }
    if (admitted.status === 202) {
      this.options.log?.(
        'admission: browser waiting for approval (' + admitted.pending.label + '), code shown on both sides'
      )
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': [this.deviceCookieValue(device.id)]
      })
      res.end(this.waitingPage(admitted.pending))
      return
    }
    const code = admitted.payload?.code
    if (code === 'max-online') {
      this.serveLoginPage(res, '在线设备已达上限（' + admitted.payload.online + '/' + admitted.payload.max + '），先在电脑上移除一台。', 403)
    } else if (code === 'denied') {
      this.serveLoginPage(res, '电脑上点过「拒绝」，过一会儿再试。', 403)
    } else if (code === 'max-pending') {
      this.serveLoginPage(res, '等待同意的设备太多了，先在电脑上处理一下。', 403)
    } else {
      this.serveLoginPage(res, '这台设备现在不能进入。', 403)
    }
  }

  serveLoginPage(res, notice = '', status = 200) {
    if (res.writableEnded) return
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(this.loginPage(notice))
  }

  serveText(res, status, text) {
    if (res.writableEnded) return
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }

  /**
   * The browser's "waiting for the owner" page: same pairing code the panel shows, polled every
   * two seconds, so approving on the computer drops the browser straight into DSH.
   */
  waitingPage({ requestId, pairCode, label, expiresAt }) {
    const code = escapeHtml(String(pairCode || '').replace(/(\d{3})(?=\d)/g, '$1 '))
    const rid = String(requestId || '').replace(/[^A-Za-z0-9_-]/g, '')
    const who = escapeHtml(String(label || '新设备'))
    const until = expiresAt
      ? escapeHtml(new Date(expiresAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }))
      : ''
    return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="theme-color" content="#0e1014"/>
<title>DeepSeek Harness · 等待确认</title>
<style>
  html,body{margin:0;min-height:100%;background:#0e1014;color:#e8eaee;font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .card{width:min(92vw,400px);background:#171a21;border:1px solid #2c323d;border-radius:14px;padding:26px 22px;box-shadow:0 18px 60px #0008;text-align:center}
  h1{font-size:17px;margin:0 0 8px;font-weight:650}
  p{font-size:12px;color:#9aa3b2;margin:0 0 12px;line-height:1.6}
  .code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:.22em;color:#e8b339;margin:16px 0 8px}
  .meta{font-size:11px;color:#5a6473;margin:0 0 14px}
  .msg{font-size:12px;color:#9aa3b2;min-height:18px;line-height:1.6}
  .msg.err{color:#ff8a70}
  button{margin-top:14px;border:0;border-radius:9px;padding:10px 18px;font-size:13px;font-weight:650;background:#4c8dff;color:#08101f;cursor:pointer;display:none}
</style></head><body>
<div class="card">
  <h1>等待电脑确认</h1>
  <p>电脑「远程 → 设备准入」里会弹出这台设备。核对两边数字一致后点「允许」。</p>
  <div class="code">${code}</div>
  <div class="meta">${who}${until ? ' · ' + until + ' 前有效' : ''}</div>
  <div class="msg" id="msg">正在等待…</div>
  <button id="retry" type="button">输入密码进入</button>
</div>
<script>
(function () {
  var rid = ${JSON.stringify(rid)};
  var msg = document.getElementById('msg');
  var retry = document.getElementById('retry');
  var stopped = false;
  function fail(text) { stopped = true; msg.className = 'msg err'; msg.textContent = text; retry.style.display = 'inline-block'; }
  retry.addEventListener('click', function () { location.href = '/__login'; });
  function poll() {
    if (stopped) return;
    fetch('__verify/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: rid }) })
      .then(function (res) {
        if (res.status === 200) { location.replace('/'); return; }
        if (res.status === 202) { setTimeout(poll, 2000); return; }
        return res.json().catch(function () { return {}; }).then(function (json) {
          var code = json && json.code;
          if (code === 'denied') return fail('电脑上点了「拒绝」。下次再连会重新排队。');
          if (code === 'max-online') return fail('在线设备已达上限（' + json.online + '/' + json.max + '），先在电脑上移除一台。');
          if (code === 'blocked') return fail('这台设备已被拉黑，先在电脑上解除。');
          if (code === 'expired') return fail('这次请求过期了。回电脑上重新扫码，或点下面的按钮输入密码。');
          return fail('没通过：' + (code || res.status));
        });
      })
      .catch(function () { setTimeout(poll, 3000); });
  }
  setTimeout(poll, 1200);
})();
</script>
</body></html>`
  }

  /**
   * Device channel endpoints:
   *   POST /__device/token   -> issue/rotate the 32-byte token for this device (needs a page session)
   *   POST /__device/poll    -> long poll: one command, or 204 when there is nothing to do
   *   POST /__device/result  -> { id, ok, ms, data?, error? } for the command just executed
   */
  handleDevice(req, res, url) {
    if (req.method !== 'POST') {
      this.sendJson(res, 405, { ok: false, code: 'method' })
      return
    }
    const bridge = this.options.deviceBridge
    if (!bridge) {
      this.sendJson(res, 503, { ok: false, code: 'unavailable' })
      return
    }
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        body = {}
      }
      try {
        if (url.pathname === '/__device/token') {
          this.handleDeviceToken(req, res, bridge)
          return
        }
        const auth = bridge.authorize(req, req.headers['x-dsh-device-token'])
        if (!auth.ok) {
          this.sendJson(res, auth.code === 'disabled' ? 403 : 401, { ok: false, code: auth.code })
          return
        }
        if (url.pathname === '/__device/poll') {
          this.handleDevicePoll(res, bridge, auth.deviceId, body)
          return
        }
        if (url.pathname === '/__device/result') {
          const done = bridge.complete(auth.deviceId, body)
          this.sendJson(res, done.ok ? 200 : 409, done.ok ? { ok: true } : { ok: false, code: done.code })
          return
        }
        this.sendJson(res, 404, { ok: false, code: 'not-found' })
      } catch (error) {
        this.options.log?.('device channel failed: ' + String(error?.message || error))
        if (!res.writableEnded) this.sendJson(res, 500, { ok: false, code: 'error' })
      }
    })
  }

  /** A page session proves "this really is the approved phone"; the token is what outlives it. */
  handleDeviceToken(req, res, bridge) {
    const session = this.resolveSession(readCookie(req, SESSION_COOKIE))
    if (!session || !session.deviceId) {
      this.sendJson(res, 401, { ok: false, code: 'session' })
      return
    }
    try {
      const token = bridge.issueToken(session.deviceId)
      this.options.log?.('device channel: token issued to ' + String(session.deviceId).slice(0, 6) + '…')
      this.sendJson(res, 200, { ok: true, token, deviceId: session.deviceId })
    } catch (error) {
      this.sendJson(res, 403, { ok: false, code: 'not-trusted', message: String(error?.message || error) })
    }
  }

  handleDevicePoll(res, bridge, deviceId, body) {
    const waitMs = Number(body?.waitMs)
    Promise.resolve(bridge.poll(deviceId, Number.isFinite(waitMs) ? waitMs : undefined))
      .then((cmd) => {
        if (res.writableEnded) return
        if (!cmd) {
          res.writeHead(204, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        this.sendJson(res, 200, { ok: true, cmd })
      })
      .catch((error) => {
        if (res.writableEnded) return
        this.sendJson(res, 500, { ok: false, code: 'error', message: String(error?.message || error) })
      })
  }

  isBlacklisted(deviceId) {
    return Boolean(deviceId && this.options.isBlacklisted?.(deviceId))
  }

  authorizeSession(req) {
    if (this.options.passwordEnabled && this.options.passwordEnabled() === false) return true
    if (this.isBlacklisted(readCookie(req, DEVICE_COOKIE))) return false
    const session = this.resolveSession(readCookie(req, SESSION_COOKIE))
    if (!session) return false
    // A device removed or blocked after it logged in loses the session immediately.
    if (this.revokedByPolicy(session.deviceId)) return false
    return true
  }

  sessionCookieValue(req, device) {
    return `${SESSION_COOKIE}=${this.issueSession(req, device)}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax`
  }

  cookieAttributes(req, device) {
    return this.sessionCookieValue(req, device)
  }

  /** Close every live WebSocket that belongs to the given session id. */
  closeSessionSockets(sessionId) {
    const sockets = this.sessionSockets.get(sessionId)
    if (!sockets) return
    for (const socket of sockets) {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
    }
    this.sessionSockets.delete(sessionId)
  }

  sessionOnline(id) {
    const sockets = this.sessionSockets.get(id)
    return Boolean(sockets && sockets.size > 0)
  }

  revokeSession(id) {
    const record = this.options.revokeSession?.(id)
    this.closeSessionSockets(id)
    return record
  }

  revokeDeviceSessions(deviceId) {
    const affected = (this.options.getSessions?.() ?? []).filter((entry) => entry.deviceId === deviceId)
    for (const session of affected) this.revokeSession(session.id)
    return affected
  }

  revokeAllSessions() {
    const records = this.options.revokeAllSessions?.() ?? []
    for (const record of records) this.closeSessionSockets(record.id)
    return records
  }

  blacklistDevice(deviceId) {
    const record = this.options.blacklistDevice?.(deviceId)
    if (deviceId) {
      const sessions = (this.options.getSessions?.() ?? []).filter((entry) => entry.deviceId === deviceId)
      for (const session of sessions) {
        this.options.revokeSession?.(session.id)
        this.closeSessionSockets(session.id)
      }
    }
    return record
  }

  unblacklistDevice(deviceId) {
    return this.options.unblacklistDevice?.(deviceId)
  }

  loginPage(notice = '', prefill = '') {
    const safeNotice = String(notice).replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch])
    const safePrefill = String(prefill).replace(/"/g, '&quot;').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch])
    return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="theme-color" content="#0e1014"/>
<title>DeepSeek Harness · 远程访问</title>
<style>
  html,body{margin:0;height:100%;background:#0e1014;color:#e8eaee;font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  form{width:min(92vw,360px);background:#171a21;border:1px solid #2c323d;border-radius:14px;padding:26px 22px;box-shadow:0 18px 60px #0008}
  h1{font-size:17px;margin:0 0 6px;font-weight:650}
  p{font-size:12px;color:#9aa3b2;margin:0 0 18px;line-height:1.6}
  input{width:100%;box-sizing:border-box;background:#11141a;border:1px solid #2c323d;color:#e8eaee;border-radius:9px;padding:12px 13px;font-size:15px;margin-bottom:12px}
  input:focus{outline:none;border-color:#4c8dff}
  button{width:100%;border:0;border-radius:9px;padding:12px;font-size:14px;font-weight:650;background:#4c8dff;color:#08101f;cursor:pointer}
  .err{color:#ff8a70;font-size:12px;min-height:16px;margin-bottom:8px}
  .hint{font-size:11px;color:#5a6473;margin-top:14px;line-height:1.5}
</style></head><body>
<form method="POST" action="__login">
  <h1>DeepSeek Harness · 远程访问</h1>
  <p>请输入远程访问密码。这是本机网关的独立口令，与 DeepSeek 账号无关。</p>
  <div class="err">${safeNotice}</div>
  <input type="password" name="password" placeholder="访问密码" autocomplete="current-password" value="${safePrefill}" autofocus required/>
  <button type="submit">进入</button>
  <div class="hint">仅限本人设备使用。第一次登录的浏览器和 App 一样：密码正确后，要在电脑「远程 → 设备准入」里核对 6 位配对码再点「允许」。扫码进入时会自动登录。</div>
</form>
</body></html>`
  }

  async bind(preferredPort) {
    const candidates = []
    if (Number.isInteger(preferredPort) && preferredPort > 0) candidates.push(preferredPort)
    candidates.push(...CANDIDATE_PORTS)
    for (let attempt = 0; attempt < 40; attempt += 1) {
      candidates.push(50000 + Math.floor(Math.random() * 15000))
    }
    let lastError = null
    for (const port of candidates) {
      const server = http.createServer((req, res) => this.handle(req, res))
      server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))
      server.on('connection', (socket) => {
        try { socket.setNoDelay(true) } catch { /* ignore */ }
        this.sockets.add(socket)
        socket.on('close', () => this.sockets.delete(socket))
      })
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '127.0.0.1')
        })
        this.server = server
        this.port = port
        this.startedAt = Date.now()
        await this.bindTls()
        return port
      } catch (error) {
        lastError = error
        try {
          server.close()
        } catch {
          /* ignore */
        }
      }
    }
    throw new Error(`gateway: no usable loopback port (${lastError ? String(lastError.message || lastError) : 'unknown error'})`)
  }

  /**
   * Bind the TLS twin of the loopback listener. Relays such as SakuraFrp reject plain
   * HTTP on a TCP tunnel; HTTPS keeps the traffic opaque to them and satisfies their policy.
   */
  async bindTls() {
    const tlsOptions = this.options.tls
    if (!tlsOptions) return null
    const candidates = []
    if (Number.isInteger(this.options.tlsPort) && this.options.tlsPort > 0) candidates.push(this.options.tlsPort)
    candidates.push(64702, 64703, 64704, 64705, 64706)
    for (let attempt = 0; attempt < 20; attempt += 1) candidates.push(50000 + Math.floor(Math.random() * 15000))
    let lastError = null
    for (const port of candidates) {
      let server
      try {
        server = https.createServer(tlsOptions, (req, res) => this.handle(req, res))
      } catch (error) {
        this.options.log?.(`gateway tls setup failed: ${String(error)}`)
        return null
      }
      server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket))
      server.on('connection', (socket) => {
        try { socket.setNoDelay(true) } catch { /* ignore */ }
        this.sockets.add(socket)
        socket.on('close', () => this.sockets.delete(socket))
      })
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '127.0.0.1')
        })
        this.tlsServer = server
        this.tlsPort = port
        this.options.log?.(`gateway tls listening on 127.0.0.1:${port}`)
        return port
      } catch (error) {
        lastError = error
        try {
          server.close()
        } catch {
          /* ignore */
        }
      }
    }
    this.options.log?.(`gateway tls disabled: ${lastError ? String(lastError.message || lastError) : 'no usable port'}`)
    return null
  }

  upstreamHeaders(req) {
    const authority = `${this.options.upstreamHost}:${this.options.upstreamPort}`
    const headers = { ...req.headers, host: authority, cookie: this.dshCookie }
    delete headers.origin
    delete headers.referer
    delete headers.authorization
    return headers
  }

  handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')

      // Admission endpoints used by the native app. They answer JSON only, so nothing here can
      // turn into a rendered second login page: 200 = entered, 202 = waiting for the owner,
      // 403 = blocked / denied / device limit, 401 = wrong password, 429 = too many attempts.
      if (url.pathname === '/__verify' || url.pathname === '/__verify/status') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end('{"ok":false,"code":"method"}')
          return
        }
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          try {
            this.handleVerify(req, res, url, Buffer.concat(chunks).toString('utf8'))
          } catch (error) {
            this.options.log?.('gateway verify failed: ' + String(error))
            if (res.headersSent) {
              try { res.end() } catch { /* ignore */ }
            } else {
              this.sendJson(res, 500, { ok: false, code: 'error' })
            }
          }
        })
        return
      }

      // Device channel ("phone as hands"): the app polls for one command at a time. These routes
      // authenticate with a device token, NOT with the page session, and they never fall back to
      // the password-disabled bypass in authorizeSession().
      if (url.pathname.startsWith('/__device/')) {
        this.handleDevice(req, res, url)
        return
      }

      if (url.pathname === '/__login') {
        this.handleLogin(req, res, url)
        return
      }

      // A scanned QR carries ?t=<one-time ticket>: the owner's own screen vouches for the caller,
      // so it enters without typing the password. Already signed-in browsers just lose the token.
      if (url.searchParams.has('t') && !this.authorizeSession(req)) {
        this.handleTicket(req, res, url)
        return
      }

      if (!this.authorizeSession(req)) {
        // Nothing in a URL grants a session any more (the QR used to carry ?p=<password>, which
        // turned a screenshot into a permanent key). A browser now gets the password form, and
        // the same admission rules the app uses: password, then approval when required.
        const loginDevice = this.touchDevice(req)
        if (this.isBlacklisted(loginDevice.id)) {
          this.serveText(res, 403, 'This device is blocked.\n')
          return
        }
        this.serveLoginPage(res, '', 401)
        return
      }

      // Old QR links still carry ?p=<password>. It grants nothing now; strip it so the secret
      // never reaches the upstream log or a shared URL. Same for a spent scan ticket.
      if (url.searchParams.has('p') || url.searchParams.has('t')) {
        const clean = new URL(url.href)
        clean.searchParams.delete('p')
        clean.searchParams.delete('t')
        req.url = clean.pathname + (clean.search || '')
      }
      this.proxyRequest(req, res, this.touchDevice(req))
    } catch (error) {
      this.options.log?.(`gateway request failed: ${String(error)}`)
      console.error('[dsh-mobile-harness] gateway request failed:', error)
      if (!res.headersSent) res.writeHead(500)
      res.end('gateway error\n')
    }
  }
  proxyRequest(req, res, device, attempt = 0) {
    const retryable = attempt === 0 && (req.method === 'GET' || req.method === 'HEAD')
    const upstream = http.request(
      {
        host: this.options.upstreamHost,
        port: this.options.upstreamPort,
        method: req.method,
        path: req.url,
        headers: this.upstreamHeaders(req),
        // Never pool upstream sockets: a stale keep-alive socket makes the whole UI hang with no
        // response after DSH restarts or drops idle connections. A fresh loopback connect is cheap.
        agent: false,
        timeout: 20000
      },
      (upstreamRes) => {
        // The bootstrapped DSH owner cookie can go stale while the switch stays on (e.g. after a
        // DSH restart). Refresh it once and replay idempotent requests instead of showing a login page.
        if (retryable && (upstreamRes.statusCode === 401 || upstreamRes.statusCode === 403)) {
          upstreamRes.resume()
          Promise.resolve()
            .then(() => this.options.getDshCookie?.())
            .then((cookie) => {
              if (cookie && cookie !== this.dshCookie) {
                this.dshCookie = cookie
                this.options.log?.('gateway: refreshed DSH session after upstream 401, retrying')
                this.proxyRequest(req, res, device, 1)
                return
              }
              if (!res.headersSent) res.writeHead(502)
              res.end('dsh session expired\n')
            })
            .catch(() => {
              if (!res.headersSent) res.writeHead(502)
              res.end('dsh session error\n')
            })
          return
        }
        let headers = upstreamRes.headers
        if (device?.isNew) headers = GatewayProxy.withCookie(headers, this.deviceCookieValue(device.id))
        let path = req.url ?? '/'
        const queryAt = path.indexOf('?')
        if (queryAt !== -1) path = path.slice(0, queryAt)
        const cacheControl = this.cachePolicy(path, upstreamRes.statusCode)
        if (cacheControl && req.method !== 'POST') headers = { ...headers, 'cache-control': cacheControl }
        res.writeHead(upstreamRes.statusCode ?? 502, headers)
        upstreamRes.pipe(res)
      }
    )
    upstream.on('socket', (socket) => {
      try { socket.setNoDelay(true) } catch { /* ignore */ }
    })
    upstream.on('timeout', () => {
      this.options.log?.('gateway upstream timeout')
      upstream.destroy()
      if (!res.headersSent) res.writeHead(504, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('upstream timeout\n')
    })
    upstream.on('error', (error) => {
      this.options.log?.(`gateway upstream error: ${error.message}`)
      if (!res.headersSent) res.writeHead(502)
      res.end('upstream error\n')
    })
    req.pipe(upstream)
  }

  handleUpgrade(req, socket) {
    try {
      if (!this.authorizeSession(req)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        return
      }
      const session = this.resolveSession(readCookie(req, SESSION_COOKIE))
      const cookieDevice = readCookie(req, DEVICE_COOKIE)
      const deviceId = (session && session.deviceId) || cookieDevice
      const refuse = (reason) => {
        this.options.log?.('gateway: refusing websocket (' + reason + ')')
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      }
      // A session that outlived its approval (removed / blocked) must not keep a page alive.
      if (session && this.revokedByPolicy(session.deviceId)) {
        refuse('device revoked')
        return
      }
      if (session && session.deviceId && this.admissionPolicy.requireApproval) {
        const record = this.registry?.get(session.deviceId)
        if (!record || record.state !== 'trusted') {
          refuse('device not trusted')
          return
        }
      }
      if (session && session.deviceId) {
        const limit = this.onlineLimit(session.deviceId)
        if (limit) {
          refuse('online limit ' + limit.online + '/' + limit.max)
          return
        }
      }
      let entry = typeof deviceId === 'string' && deviceId.length >= 6 ? this.devices.get(deviceId) : undefined
      if (!entry && typeof deviceId === 'string' && deviceId.length >= 6) {
        entry = { firstSeen: Date.now(), lastSeen: Date.now(), pages: 0, hadPage: false }
        this.devices.set(deviceId, entry)
      }
      if (entry) {
        entry.pages += 1
        entry.hadPage = true
        entry.lastSeen = Date.now()
      }
      this.pages += 1
      // One page = one upgrade. Release on whichever half closes first: a peer that only
      // sends FIN (half-open) emits `end` without a prompt `close`.
      let released = false
      const release = () => {
        if (released) return
        released = true
        this.pages = Math.max(0, this.pages - 1)
        if (entry) entry.pages = Math.max(0, entry.pages - 1)
      }
      socket.once('close', release)
      socket.once('end', release)
      socket.once('error', release)
      socket.once('timeout', release)
      try { socket.setNoDelay(true) } catch { /* ignore */ }
      if (session) {
        const sockets = this.sessionSockets.get(session.id) ?? new Set()
        sockets.add(socket)
        this.sessionSockets.set(session.id, sockets)
        socket.once('close', () => {
          const current = this.sessionSockets.get(session.id)
          if (!current) return
          current.delete(socket)
          if (current.size === 0) this.sessionSockets.delete(session.id)
        })
      }
      this.connectUpgrade(req, socket, release, 0)
    } catch (error) {
      this.options.log?.(`gateway upgrade failed: ${String(error)}`)
      socket.destroy()
    }
  }

  /** Relays a WebSocket handshake, refreshing the DSH cookie once if upstream answers 401/403. */
  connectUpgrade(req, socket, release, attempt) {
    const upstreamSocket = net.connect(this.options.upstreamPort, this.options.upstreamHost, () => {
      const headers = this.upstreamHeaders(req)
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (const [name, value] of Object.entries(headers)) {
        lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      }
      upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`)
    })
    try { upstreamSocket.setNoDelay(true) } catch { /* ignore */ }
    upstreamSocket.setTimeout(20000)

    let decided = false
    const onHandshake = (chunk) => {
      if (decided) return
      decided = true
      upstreamSocket.removeListener('data', onHandshake)
      upstreamSocket.pause()
      const head = chunk.slice(0, 24).toString('latin1')
      if (attempt === 0 && /^HTTP\/1\.[01] (401|403)/.test(head)) {
        upstreamSocket.destroy()
        Promise.resolve()
          .then(() => this.options.getDshCookie?.())
          .then((cookie) => {
            if (cookie && cookie !== this.dshCookie) {
              this.dshCookie = cookie
              this.options.log?.('gateway: refreshed DSH session after WebSocket 401, retrying')
              this.connectUpgrade(req, socket, release, 1)
              return
            }
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
            socket.destroy()
            release()
          })
          .catch(() => {
            socket.destroy()
            release()
          })
        return
      }
      // Long-lived connection: no idle timeout once the handshake is through.
      upstreamSocket.setTimeout(0)
      socket.write(chunk)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      upstreamSocket.resume()
    }

    upstreamSocket.once('data', onHandshake)
    upstreamSocket.on('timeout', () => {
      upstreamSocket.destroy()
      socket.destroy()
      release()
    })
    upstreamSocket.on('error', () => {
      socket.destroy()
      release()
    })
    socket.on('error', () => upstreamSocket.destroy())
    socket.once('end', () => upstreamSocket.destroy())
  }

  async start(preferredPort) {
    if (this.server) return this.port
    this.dshCookie = await this.options.getDshCookie()
    await this.bind(preferredPort)
    return this.port
  }

  async stop() {
    const server = this.server
    const tlsServer = this.tlsServer
    this.server = null
    this.tlsServer = null
    this.port = null
    this.tlsPort = null
    this.dshCookie = null
    this.devices.clear()
    this.failures.clear()
    this.pages = 0
    try { this.upstreamAgent.destroy() } catch { /* ignore */ }
    for (const socket of this.sockets) {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    for (const target of [server, tlsServer]) {
      if (!target) continue
      await new Promise((resolve) => {
        try {
          target.close(() => resolve())
          target.closeAllConnections?.()
        } catch {
          resolve()
        }
        setTimeout(resolve, 1500)
      })
    }
  }
}

export { SESSION_MAX_AGE_SECONDS }
