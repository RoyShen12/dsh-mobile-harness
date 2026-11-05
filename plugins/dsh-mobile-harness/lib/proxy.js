/**
 * In-process password gateway for the remote-access switch.
 *
 * The phone talks to this loopback listener through Tailscale Serve. The gateway:
 *   - refuses everything until the app has signed in; no URL query may grant a session;
 *   - keeps DSH's own 30-day owner cookie private and injects it upstream;
 *   - validates the public origin before translating it to the loopback authority;
 *   - relays WebSocket upgrades (`/api/remote.mux`) raw.
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { injectPwa, servePwa } from './pwa.js'

const SESSION_COOKIE = 'dsh-gw'

/** Panel actions that only make sense on the owner's own machine. */
const HOST_ONLY_API = new Set([
  '/api/dsh-mobile-harness.toggle',
  '/api/dsh-mobile-harness.password',
  '/api/dsh-mobile-harness.external',
  '/api/dsh-mobile-harness.cloudflared',
  '/api/dsh-mobile-harness.lan',
  '/api/dsh-mobile-harness.pool',
  '/api/dsh-mobile-harness.poolpick',
  '/api/dsh-mobile-harness.devices',
  '/api/dsh-mobile-harness.reset'
])
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000

/**
 * Per-browser identity, so the panel can say "1 台设备" instead of counting raw TCP
 * sockets (one page opens many). Issued on login and valid for 30 days.
 */
const DEVICE_COOKIE = 'dsh-device'
const DEVICE_MAX_AGE_SECONDS = 30 * 24 * 3600
const PENDING_COOKIE = 'dsh-pending'
const PENDING_MAX_AGE_SECONDS = 5 * 60
const MAX_PENDING_PROOFS = 2048
const MAX_BODY_BYTES = 64 * 1024
const MAX_RUNTIME_DEVICES = 2048
const MAX_RATE_ENTRIES = 2048
const MAX_CONNECTIONS = 128
const MAX_DEVICE_REQUESTS_PER_MINUTE = 120
const MAX_DEVICE_POLLS = 2
const AUTH_FAILURE_DELAY_MS = 250
const MAX_UNKNOWN_BACKOFF_MS = 1000
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

/** Wrong-password budget per device and known source, inside one window. */
const FAILURE_WINDOW_MS = 5 * 60 * 1000
const FAILURE_LIMIT_PER_DEVICE = 5
const FAILURE_LIMIT_PER_SOURCE = 50

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
 * @param {() => Buffer} options.getSessionSecret HMAC key persisted across restarts
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

/**
 * DSH's web frontend ships a desktop-only layout: its stylesheet has no width breakpoint, so a
 * 360-430px phone viewport squeezes the sidebar and the conversation pane until controls sit
 * off-screen and the page stops scrolling. A DOM-level patch would break on every frontend
 * upgrade, so the fix sits at the one boundary we control: the HTML navigation response. A phone
 * gets a fixed desktop viewport width, so every control lays out exactly as it does on a desktop
 * and the browser scales the result down to fit; desktop browsers are served untouched.
 */
/** Phone and tablet user agents; both need the fixed-width viewport because the frontend has no breakpoints. */
const PHONE_UA = /Android.*Mobile|iPhone|iPod|Opera Mini|IEMobile|Mobile|HarmonyOS|Windows Phone/i
/** Checked first: an iPad in desktop mode still says "Mobile", and Android tablets omit it entirely. */
const TABLET_UA = /iPad|Tablet|Macintosh.*Mobile|Android(?!.*Mobile)|MatePad|SM-T\d|Pad$/i
/**
 * Only the compat mode pins a canvas width; phone and tablet now use the real device width so the
 * in-page mobile skin engages and text renders at a genuine phone size instead of a shrunken 1280.
 */
export const UI_VIEWPORTS = Object.freeze({ compat: 1280 })
export const UI_MODES = Object.freeze(['auto', 'phone', 'tablet', 'compat'])

/**
 * Pick the layout the current request should see. `auto` sniffs the user agent; an explicit mode
 * always wins so the owner can force phone/tablet/compat from the panel.
 */
export function resolveUiMode(mode, userAgent) {
  const wanted = UI_MODES.includes(mode) ? mode : 'auto'
  if (wanted !== 'auto') return wanted
  const ua = String(userAgent || '')
  if (TABLET_UA.test(ua)) return 'tablet'
  if (PHONE_UA.test(ua)) return 'phone'
  return 'compat'
}

/**
 * Rewrite the viewport of a navigation response so a phone lays out on a fixed desktop canvas
 * instead of squeezing the desktop-only layout into 390px.
 */
export function injectViewport(html, mode) {
  let text = String(html)
  if (mode === 'phone' || mode === 'tablet') {
    // Native width: the in-page mobile skin needs a real 390-430px CSS viewport to engage, and
    // scaling a fixed 1280 canvas down is exactly what made text unreadably small. `data-dru-ui`
    // tells the page which layout the gateway chose, so the skin never has to re-guess it.
    text = text.replace(/<html([^>]*)>/i, '<html$1 data-dru-ui="' + mode + '">')
    const native = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content, user-scalable=yes" />'
    const found = /<meta[^>]*\bname=["']viewport["'][^>]*>/i
    return found.test(text) ? text.replace(found, native) : text.replace(/<head[^>]*>/i, (tag) => tag + native)
  }
  // compat: the pre-skin behaviour — a fixed desktop canvas the phone scales down. It is the
  // fallback for devices where the skin's selectors no longer match, not the default.
  const width = UI_VIEWPORTS.compat
  const meta = '<meta name="viewport" content="width=' + width + ', maximum-scale=5, user-scalable=yes" />'
  const existing = /<meta[^>]*\bname=["']viewport["'][^>]*>/i
  return existing.test(text) ? text.replace(existing, meta) : text.replace(/<head[^>]*>/i, (tag) => tag + meta)
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

function safeEqualText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function canonicalPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length > 4096) return null
  let decoded = pathname
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let next
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next === decoded) break
    decoded = next
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) return null
  const segments = []
  for (const segment of decoded.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const canonical = '/' + segments.join('/')
  // A trailing slash is part of the route: DSH serves the client-module combo
  // scripts at `/plugins/??<ids>&rev=…`, and `/plugins??…` is a 404.
  return decoded.length > 1 && /[\\/]$/.test(decoded) && canonical !== '/' ? canonical + '/' : canonical
}

function isPluginManagementPath(pathname) {
  const path = canonicalPath(pathname)
  return Boolean(path && /^\/api\/dsh-mobile-harness(?:\.|\/|$)/i.test(path))
}

function jsonResponseEnded(res) {
  return res.writableEnded || res.destroyed
}

function parseIp(value) {
  if (typeof value !== 'string') return null
  const candidate = value.trim().replace(/^\[|\]$/g, '')
  return net.isIP(candidate) ? candidate.toLowerCase() : null
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
    this.failures = new Map()
    /** Last phone/tablet navigation: what "auto" resolved to ({ mode, at, label }). */
    this.uiProbe = null
    this.pendingProofs = new Map()
    this.deviceTraffic = new Map()
    /** The one live scan ticket (see TICKET_TTL_MS); burnt after admission accepts it. */
    this.ticket = null
    this.ticketExpiresAt = 0
    this.unknownFailureWindowAt = 0
    this.unknownFailureCount = 0
    this.ticketClaim = null
  }

  /** What the gateway resolved for the most recent phone/tablet navigation (null = none yet). */
  uiModeEffective() {
    return this.uiProbe ?? null
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

  getSessionSecret() {
    const secret = this.options.getSessionSecret?.() ?? this.options.sessionSecret
    if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('gateway session secret unavailable')
    return secret
  }

  deriveSecret(namespace) {
    return createHmac('sha256', this.getSessionSecret()).update(namespace).digest()
  }

  /** Burn the ticket and invalidate every pending login proof. */
  resetTicket() {
    this.ticket = null
    this.ticketExpiresAt = 0
    this.ticketClaim = null
    this.pendingProofs.clear()
    this.failures.clear()
    this.deviceTraffic.clear()
    this.unknownFailureWindowAt = 0
    this.unknownFailureCount = 0
  }

  resetAuthentication() {
    this.resetTicket()
  }

  /** @returns {boolean} true only for the current unexpired ticket */
  validTicket(value, deviceId) {
    if (typeof value !== 'string' || value.length === 0) return false
    const now = Date.now()
    if (!this.ticket || this.ticketExpiresAt <= now) return false
    this.pruneTicketClaim(now)
    if (!safeEqualText(value, this.ticket)) return false
    if (this.ticketClaim && deviceId !== undefined && this.ticketClaim.deviceId !== deviceId) return false
    return true
  }

  pruneTicketClaim(now = Date.now()) {
    const claim = this.ticketClaim
    if (!claim) return
    if (claim.expiresAt <= now) {
      this.ticketClaim = null
      return
    }
    const request = this.registry?.getRequest(claim.requestId)
    const record = this.registry?.get(claim.deviceId)
    if (request?.status === 'denied' || (!request && record?.state !== 'trusted')) this.ticketClaim = null
  }

  consumeTicket(value, deviceId, requestId) {
    if (!this.validTicket(value, deviceId)) return false
    if (this.ticketClaim && this.ticketClaim.requestId !== requestId) return false
    this.ticket = null
    this.ticketExpiresAt = 0
    this.ticketClaim = null
    return true
  }

  claimTicket(value, deviceId, requestId, expiresAt) {
    if (!this.validTicket(value, deviceId)) return false
    this.ticketClaim = { deviceId, requestId, expiresAt: Math.min(expiresAt, this.ticketExpiresAt) }
    return true
  }

  releaseTicketClaim(deviceId, requestId) {
    if (this.ticketClaim?.deviceId === deviceId && this.ticketClaim?.requestId === requestId) this.ticketClaim = null
  }

  isSecureRequest(req) {
    if (req.socket?.encrypted) return true
    try {
      const publicUrl = this.options.getPublicUrl?.()
      if (typeof publicUrl === 'string' && new URL(publicUrl).protocol === 'https:') return true
    } catch {
      return false
    }
    return false
  }

  publicEndpointAllowed() {
    try {
      const publicUrl = this.options.getPublicUrl?.()
      if (typeof publicUrl !== 'string') return true
      const parsed = new URL(publicUrl)
      if (parsed.protocol === 'https:') return true
      return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())
    } catch {
      return false
    }
  }

  cookieSuffix(req, maxAge) {
    return `; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${this.isSecureRequest(req) ? '; Secure' : ''}`
  }

  newDeviceId() {
    return randomBytes(18).toString('base64url')
  }

  signedDeviceId(raw) {
    if (typeof raw !== 'string') return null
    const parts = raw.split('.')
    if (parts.length !== 3) return null
    const [id, issuedRaw, signature] = parts
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(id) || !/^\d{10,16}$/.test(issuedRaw)) return null
    const issuedAt = Number(issuedRaw)
    const now = Date.now()
    if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 60_000 || now - issuedAt >= DEVICE_MAX_AGE_SECONDS * 1000) return null
    const expected = sign(this.deriveSecret('dsh-mobile-harness/device-cookie/v1'), `${id}.${issuedRaw}`)
    return safeEqualText(signature, expected) ? id : null
  }

  readDeviceId(req) {
    return this.signedDeviceId(readCookie(req, DEVICE_COOKIE))
  }

  deviceCookieValue(req, id) {
    const issuedAt = Date.now()
    const payload = `${id}.${issuedAt}`
    const signature = sign(this.deriveSecret('dsh-mobile-harness/device-cookie/v1'), payload)
    return `${DEVICE_COOKIE}=${payload}.${signature}${this.cookieSuffix(req, DEVICE_MAX_AGE_SECONDS)}`
  }

  clearCookie(req, name) {
    return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${this.isSecureRequest(req) ? '; Secure' : ''}`
  }

  makePendingProof(req, deviceId, requestId, ticket = null) {
    const now = Date.now()
    this.prunePendingProofs(now)
    if (this.pendingProofs.size >= MAX_PENDING_PROOFS) {
      const oldest = this.pendingProofs.keys().next().value
      if (oldest) {
        const proof = this.pendingProofs.get(oldest)
        this.discardPendingProof({ token: oldest, ...proof })
      }
    }
    const token = randomBytes(24).toString('base64url')
    const expiresAt = now + PENDING_MAX_AGE_SECONDS * 1000
    const source = this.requestBindingSource(req)
    const userAgent = sign(this.deriveSecret('dsh-mobile-harness/pending-agent/v1'), String(req.headers['user-agent'] || ''))
    const payload = `${token}.${deviceId}.${requestId}.${expiresAt}.${source}.${userAgent}.${ticket || ''}`
    const signature = sign(this.deriveSecret('dsh-mobile-harness/pending-auth/v1'), payload)
    this.pendingProofs.set(token, { deviceId, requestId, expiresAt, source, userAgent, ticket })
    return `${PENDING_COOKIE}=${token}.${signature}${this.cookieSuffix(req, PENDING_MAX_AGE_SECONDS)}`
  }

  requestBindingSource(req) {
    return this.trustedRateSource(req) || parseIp(req.socket?.remoteAddress) || 'unknown'
  }

  prunePendingProofs(now = Date.now()) {
    for (const [token, proof] of this.pendingProofs) {
      if (!proof || proof.expiresAt <= now) this.pendingProofs.delete(token)
    }
    if (this.ticketClaim && this.ticketClaim.expiresAt <= now) this.ticketClaim = null
  }

  pendingProof(req, deviceId, requestId) {
    const raw = readCookie(req, PENDING_COOKIE)
    if (typeof raw !== 'string') return null
    const parts = raw.split('.')
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{32}$/.test(parts[0])) return null
    const [token, signature] = parts
    const proof = this.pendingProofs.get(token)
    if (!proof || proof.expiresAt <= Date.now() || proof.deviceId !== deviceId) return null
    if (requestId && proof.requestId !== requestId) return null
    const source = this.requestBindingSource(req)
    const userAgent = sign(this.deriveSecret('dsh-mobile-harness/pending-agent/v1'), String(req.headers['user-agent'] || ''))
    if (proof.source !== source || !safeEqualText(proof.userAgent, userAgent)) return null
    const payload = `${token}.${proof.deviceId}.${proof.requestId}.${proof.expiresAt}.${proof.source}.${proof.userAgent}.${proof.ticket || ''}`
    const expected = sign(this.deriveSecret('dsh-mobile-harness/pending-auth/v1'), payload)
    if (!safeEqualText(signature, expected)) return null
    return { token, ...proof }
  }

  discardPendingProof(proof) {
    if (proof?.token) this.pendingProofs.delete(proof.token)
    if (proof?.ticket) this.releaseTicketClaim(proof.deviceId, proof.requestId)
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
    const normalized = canonicalPath(path)
    if (!normalized) return null
    if (/^\/(assets|plugins)\//.test(normalized)) return 'public, max-age=31536000, immutable'
    if (normalized === '/manifest.webmanifest' || normalized === '/favicon.svg') return 'public, max-age=86400'
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

  runtimeDevice(id) {
    const current = this.devices.get(id)
    if (current) {
      this.devices.delete(id)
      this.devices.set(id, current)
      current.lastSeen = Date.now()
      return current
    }
    const now = Date.now()
    for (const [candidate, entry] of this.devices) {
      if (entry.pages === 0 && now - entry.lastSeen > DEVICE_IDLE_TTL_MS) this.devices.delete(candidate)
    }
    while (this.devices.size >= MAX_RUNTIME_DEVICES) {
      let removable = null
      for (const [candidate, entry] of this.devices) {
        if (entry.pages === 0) {
          removable = candidate
          break
        }
      }
      if (!removable) return null
      this.devices.delete(removable)
    }
    const created = { firstSeen: now, lastSeen: now, pages: 0, hadPage: false }
    this.devices.set(id, created)
    return created
  }

  /** Clear the device registry (manual reset from the panel). */
  resetDevices() {
    this.devices.clear()
  }

  /** Open DSH pages, one WebSocket each. */
  pageCount() {
    return this.pages
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
    const signedId = this.readDeviceId(req)
    const id = signedId || this.newDeviceId()
    const isNew = !signedId
    const entry = this.runtimeDevice(id)
    if (entry) entry.lastSeen = now
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
    return `${id}.${issuedAt}.${sign(this.getSessionSecret(), `${id}.${issuedAt}`)}`
  }

  /** Validate a session cookie against the signed token AND the persisted registry. */
  resolveSession(raw) {
    if (typeof raw !== 'string') return null
    const parts = raw.split('.')
    if (parts.length !== 3) return null
    const [id, issuedRaw, signature] = parts
    if (!/^[A-Za-z0-9_-]{12,40}$/.test(id) || !/^\d{10,16}$/.test(issuedRaw)) return null
    const expected = sign(this.getSessionSecret(), `${id}.${issuedRaw}`)
    if (!safeEqualText(signature, expected)) return null
    const issuedAt = Number(issuedRaw)
    const now = Date.now()
    if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 60_000 || now - issuedAt >= SESSION_MAX_AGE_SECONDS * 1000) return null
    const record = this.options.findSession?.(id)
    if (!record || record.revoked || Number(record.issuedAt) !== issuedAt) return null
    return record
  }

  touchSessionRecord(record) {
    if (!record) return
    record.lastSeen = Date.now()
    this.options.touchSession?.(record)
  }

  /** Rate-limit hint only; the app-provided installation id never becomes a trusted identity. */
  installationDeviceId(installationId) {
    if (typeof installationId !== 'string' || !/^[A-Za-z0-9_-]{12,128}$/.test(installationId)) return null
    return sign(this.deriveSecret('dsh-mobile-harness/install-rate/v1'), installationId).slice(0, 22)
  }

  // ── admission: who is this device, and may it come in? ────────────────────

  /** The persisted device registry, when the service wired one. */
  get registry() {
    return this.options.registry ?? null
  }

  /** Approval policy; missing registry data fails closed in `admitDevice`. */
  get admissionPolicy() {
    const registry = this.registry
    return registry ? registry.settings : { requireApproval: true, maxOnlineDevices: 0 }
  }

  /** Everything the registry needs to know about the caller. */
  identifyDevice(req) {
    const installationRaw = req.headers['x-dsh-client-id']
    const rateInstallation = this.installationDeviceId(installationRaw)
    const userAgent = String(req.headers['user-agent'] ?? '')
    const client = String(req.headers['x-dsh-client'] ?? '').toLowerCase() === 'app' ? 'app' : 'web'
    const signedId = this.readDeviceId(req)
    const id = signedId || this.newDeviceId()
    const runtime = this.runtimeDevice(id)
    if (runtime) runtime.lastSeen = Date.now()
    return {
      id,
      isNew: !signedId,
      rateId: signedId || rateInstallation || id,
      client,
      clientVersion: String(req.headers['x-dsh-client-version'] ?? '').slice(0, 32),
      label: describeUserAgent(userAgent),
      userAgent: userAgent.slice(0, 240),
      installation: Boolean(rateInstallation)
    }
  }

  bumpFailure(key, now = Date.now()) {
    const previous = this.failures.get(key)
    this.failures.delete(key)
    const entry = !previous || now - previous.firstAt > FAILURE_WINDOW_MS
      ? { count: 1, firstAt: now }
      : { count: previous.count + 1, firstAt: previous.firstAt }
    this.failures.set(key, entry)
    while (this.failures.size > MAX_RATE_ENTRIES) this.failures.delete(this.failures.keys().next().value)
    return entry
  }

  failureEntry(key, now = Date.now()) {
    const entry = this.failures.get(key)
    if (!entry) return null
    if (now - entry.firstAt > FAILURE_WINDOW_MS) {
      this.failures.delete(key)
      return null
    }
    this.failures.delete(key)
    this.failures.set(key, entry)
    return entry
  }

  trustedRateSource(req) {
    const mode = this.options.getTunnelMode?.()
    if (mode === 'quick') {
      const source = parseIp(req.headers['cf-connecting-ip'])
      return source ? `cloudflare:${source}` : null
    }
    if (mode === 'tailscale') {
      const login = req.headers['tailscale-user-login']
      const name = req.headers['tailscale-user-name']
      const identity = typeof login === 'string' && login.length <= 256 ? login : name
      if (typeof identity === 'string' && identity.length > 0 && identity.length <= 256) {
        return `tailscale:${identity.toLowerCase()}`
      }
    }
    const remote = parseIp(req.socket?.remoteAddress)
    if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return `socket:${remote}`
    return null
  }

  noteFailure(deviceId, req) {
    const now = Date.now()
    this.bumpFailure(`device:${deviceId}`, now)
    const source = this.trustedRateSource(req)
    let delay = AUTH_FAILURE_DELAY_MS
    if (source) {
      this.bumpFailure(`source:${source}`, now)
    } else {
      if (!this.unknownFailureWindowAt || now - this.unknownFailureWindowAt > FAILURE_WINDOW_MS) {
        this.unknownFailureWindowAt = now
        this.unknownFailureCount = 0
      }
      this.unknownFailureCount = Math.min(this.unknownFailureCount + 1, 100)
      delay = Math.min(MAX_UNKNOWN_BACKOFF_MS, AUTH_FAILURE_DELAY_MS * (2 ** Math.min(this.unknownFailureCount - 1, 2)))
    }
    return delay
  }

  clearFailures(deviceId) {
    this.failures.delete(`device:${deviceId}`)
  }

  rateLimited(deviceId, req) {
    const now = Date.now()
    const device = this.failureEntry(`device:${deviceId}`, now)
    if (device && device.count >= FAILURE_LIMIT_PER_DEVICE) return true
    const source = this.trustedRateSource(req)
    const sourceEntry = source ? this.failureEntry(`source:${source}`, now) : null
    return Boolean(sourceEntry && sourceEntry.count >= FAILURE_LIMIT_PER_SOURCE)
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
  onlineLimit(deviceId, excludeSessionId = null) {
    const max = this.admissionPolicy.maxOnlineDevices
    if (!max || max <= 0) return null
    const now = Date.now()
    const active = []
    for (const session of this.options.getSessions?.() ?? []) {
      if (!session || session.revoked || !session.id || !session.deviceId) continue
      const issuedAt = Number(session.issuedAt)
      if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt >= SESSION_MAX_AGE_SECONDS * 1000) continue
      if (session.id !== excludeSessionId && now - (Number(session.lastSeen) || issuedAt) >= SESSION_IDLE_TTL_MS) {
        const sockets = this.sessionSockets.get(session.id)
        if (!sockets || sockets.size === 0) continue
      }
      if (this.revokedByPolicy(session.deviceId)) continue
      active.push(session)
    }
    const others = active.filter((session) => session.id !== excludeSessionId).length
    if (others < max) return null
    return { online: others, max }
  }

  touchActiveSessions(deviceId) {
    const now = Date.now()
    for (const session of this.options.getSessions?.() ?? []) {
      if (session && !session.revoked && session.deviceId === deviceId) {
        session.lastSeen = now
        this.options.touchSession?.(session)
      }
    }
  }

  /** A removed/blocked device must lose even a still-valid session cookie. */
  revokedByPolicy(deviceId) {
    const registry = this.registry
    if (!registry || !deviceId) return true
    const record = registry.get(deviceId)
    return !record || record.state !== 'trusted'
  }

  sendJson(res, status, payload, cookies) {
    let headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    for (const cookie of cookies ?? []) headers = GatewayProxy.withCookie(headers, cookie)
    res.writeHead(status, headers)
    res.end(JSON.stringify(payload))
  }

  rejectBody(req, res) {
    req.pause()
    const socket = req.socket
    if (res.writableFinished) {
      socket.destroy()
      return
    }
    res.once('finish', () => socket.destroy())
    if (!res.headersSent) {
      res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8', 'connection': 'close', 'cache-control': 'no-store' })
      res.end('payload too large\n')
    }
  }

  readBody(req, res) {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      this.rejectBody(req, res)
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      let done = false
      const fail = (error) => {
        if (done) return
        done = true
        reject(error)
      }
      req.on('data', (chunk) => {
        if (done) return
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          done = true
          chunks.length = 0
          req.pause()
          this.rejectBody(req, res)
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (done) return
        done = true
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      req.on('error', fail)
      req.on('aborted', () => fail(new Error('request aborted')))
    })
  }

  allowedOrigin(origin) {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      return false
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return false
    }
    try {
      const publicUrl = this.options.getPublicUrl?.()
      if (typeof publicUrl === 'string') {
        const expected = new URL(publicUrl)
        const expectedLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(expected.hostname.toLowerCase())
        if (expected.protocol === 'https:' && expected.origin === parsed.origin) return true
        if (expected.protocol === 'http:' && expectedLoopback && expected.origin === parsed.origin) return true
      }
    } catch {
      return false
    }
    const hostname = parsed.hostname.toLowerCase()
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
    return loopback && [this.port, this.tlsPort].includes(port)
  }

  requestOriginAllowed(req, upgrade = false) {
    const origin = req.headers.origin
    const referer = req.headers.referer
    const sessionCookie = readCookie(req, SESSION_COOKIE)
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase()
    const documentNavigation = !upgrade && !unsafe && String(req.headers['sec-fetch-mode'] || '').toLowerCase() === 'navigate' && String(req.headers['sec-fetch-dest'] || '').toLowerCase() === 'document'
    if (fetchSite === 'cross-site' && !documentNavigation && (upgrade || sessionCookie || unsafe)) return false
    if (upgrade && typeof origin !== 'string') return false
    const userNavigation = !upgrade && !unsafe && (fetchSite === 'none' || documentNavigation)
    if (!userNavigation && typeof this.options.getPublicUrl?.() !== 'string' && this.options.getTunnelMode?.() && this.options.getTunnelMode() !== 'none' && origin === undefined && referer === undefined) {
      return false
    }
    if (origin !== undefined) return typeof origin === 'string' && this.allowedOrigin(origin)
    if (typeof referer === 'string' && referer.length > 0) {
      try {
        return this.allowedOrigin(new URL(referer).origin)
      } catch {
        return false
      }
    }
    if (upgrade) return false
    if (sessionCookie && unsafe && String(req.headers['x-dsh-client'] || '').toLowerCase() !== 'app') return false
    return true
  }

  upstreamOrigin() {
    return `http://${this.options.upstreamHost}:${this.options.upstreamPort}`
  }

  beginDeviceRequest(token, isPoll) {
    if (typeof token !== 'string' || token.length < 12) return { ok: false, code: 'token' }
    const key = sign(this.deriveSecret('dsh-mobile-harness/device-rate/v1'), token)
    const now = Date.now()
    let entry = this.deviceTraffic.get(key)
    if (!entry || now - entry.firstAt > 60_000) entry = { count: 0, firstAt: now, polls: entry?.polls ?? 0 }
    if (entry.count >= MAX_DEVICE_REQUESTS_PER_MINUTE) return { ok: false, code: 'rate' }
    if (isPoll && entry.polls >= MAX_DEVICE_POLLS) return { ok: false, code: 'poll-limit' }
    entry.count += 1
    if (isPoll) entry.polls += 1
    this.deviceTraffic.delete(key)
    this.deviceTraffic.set(key, entry)
    while (this.deviceTraffic.size > MAX_RATE_ENTRIES) this.deviceTraffic.delete(this.deviceTraffic.keys().next().value)
    return { ok: true, key }
  }

  endDevicePoll(key) {
    const entry = this.deviceTraffic.get(key)
    if (!entry) return
    entry.polls = Math.max(0, entry.polls - 1)
  }

  async waitAuthDelay(startedAt, minimum = AUTH_FAILURE_DELAY_MS) {
    const remaining = minimum - (Date.now() - startedAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  }

  /**
   * POST /__verify (password + device identity) and POST /__verify/status (poll a pending
   * request). Both answer JSON; the app decides between "entered", "waiting" and the errors.
   */
  async handleVerify(req, res, url, bodyText) {
    const startedAt = Date.now()
    if (url.pathname !== '/__verify/status') await this.waitAuthDelay(startedAt)
    let body = {}
    try {
      body = JSON.parse(bodyText)
    } catch {
      body = {}
    }
    const device = this.identifyDevice(req)
    const registry = this.registry
    const existing = registry ? registry.get(device.id) : null
    if (url.pathname === '/__verify/status') {
      this.handleVerifyStatus(req, res, body, device)
      return
    }
    if (!registry) {
      this.sendJson(res, 503, { ok: false, code: 'unavailable' })
      return
    }
    if (existing && existing.state === 'blocked') {
      this.sendJson(res, 403, { ok: false, code: 'blocked', blacklisted: true, label: existing.label })
      return
    }
    const rateId = device.rateId || device.id
    if (this.rateLimited(rateId, req)) {
      this.sendJson(res, 429, { ok: false, code: 'too-many', message: '尝试过于频繁，请 5 分钟后再试' })
      return
    }

    const submitted = typeof body?.password === 'string' ? body.password : ''
    const ticket = typeof body?.ticket === 'string' ? body.ticket : ''
    const passwordOk = this.options.verifyPassword(submitted)
    const ticketOk = passwordOk ? false : this.validTicket(ticket, device.id)
    if (!passwordOk && !ticketOk) {
      const delay = this.noteFailure(rateId, req)
      await this.waitAuthDelay(startedAt, delay)
      this.sendJson(res, 401, { ok: false, code: ticket ? 'ticket' : 'password' })
      return
    }
    this.clearFailures(rateId)

    const issue = () => {
      registry.markLogin(device.id)
      this.sendJson(res, 200, { ok: true, deviceId: device.id, label: registry.get(device.id)?.label ?? device.label }, [
        this.sessionCookieValue(req, device),
        this.deviceCookieValue(req, device.id),
        this.clearCookie(req, PENDING_COOKIE)
      ])
    }

    const admitted = this.admitDevice(device, req)
    if (admitted.ok) {
      if (ticketOk && !this.consumeTicket(ticket, device.id, this.ticketClaim?.requestId)) {
        this.sendJson(res, 401, { ok: false, code: 'ticket' })
        return
      }
      issue()
      return
    }
    if (admitted.status === 202) {
      if (ticketOk) this.claimTicket(ticket, device.id, admitted.pending.requestId, admitted.pending.expiresAt)
      const proofCookie = this.makePendingProof(req, device.id, admitted.pending.requestId, ticketOk ? ticket : null)
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
      }, [this.deviceCookieValue(req, device.id), proofCookie])
      return
    }
    this.sendJson(res, admitted.status, admitted.payload)
  }

  /**
   * The one admission decision both callers share (the app's POST /__verify and the browser's
   * login form), so the app and a browser can never drift apart on trust, codes or limits.
   * @returns {{ok: true, record?: object} | {ok: false, status: number, payload?: object, pending?: object}}
   */
  admitDevice(device, req) {
    const registry = this.registry
    if (!registry) return { ok: false, status: 503, payload: { ok: false, code: 'unavailable' } }
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
    const currentSession = req ? this.authorizedSession(req) : null
    const limit = this.onlineLimit(device.id, currentSession?.id ?? null)
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
    const requestId = typeof body?.requestId === 'string' ? body.requestId : ''
    const currentSession = this.authorizedSession(req)
    if (currentSession && currentSession.deviceId === device.id) {
      this.sendJson(res, 200, { ok: true, approved: true, label: registry.get(device.id)?.label ?? device.label })
      return
    }
    const proof = this.pendingProof(req, device.id, requestId)
    if (!proof) {
      this.sendJson(res, 403, { ok: false, code: 'expired' })
      return
    }
    const record = registry.get(device.id)
    if (record && record.state === 'blocked') {
      this.discardPendingProof(proof)
      this.sendJson(res, 403, { ok: false, code: 'blocked', blacklisted: true, label: record.label })
      return
    }
    if (record && record.state === 'trusted') {
      const limit = this.onlineLimit(device.id)
      if (limit) {
        this.discardPendingProof(proof)
        this.sendJson(res, 403, { ok: false, code: 'max-online', online: limit.online, max: limit.max, label: record.label })
        return
      }
      if (proof.ticket && !this.consumeTicket(proof.ticket, device.id, proof.requestId)) {
        this.discardPendingProof(proof)
        this.sendJson(res, 403, { ok: false, code: 'ticket' })
        return
      }
      this.discardPendingProof(proof)
      registry.markLogin(device.id)
      this.sendJson(res, 200, { ok: true, approved: true, deviceId: device.id, label: record.label }, [
        this.sessionCookieValue(req, device),
        this.deviceCookieValue(req, device.id),
        this.clearCookie(req, PENDING_COOKIE)
      ])
      return
    }
    const request = requestId ? registry.getRequest(requestId) : null
    if (!request || request.deviceId !== device.id) {
      this.discardPendingProof(proof)
      this.sendJson(res, 403, { ok: false, code: 'expired' })
      return
    }
    if (request.status === 'denied') {
      this.discardPendingProof(proof)
      this.sendJson(res, 403, { ok: false, code: 'denied', label: request.label })
      return
    }
    const limit = this.onlineLimit(device.id)
    if (limit) {
      this.discardPendingProof(proof)
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

  handleWaiting(req, res, url) {
    const device = this.identifyDevice(req)
    const requestId = url.searchParams.get('requestId') || ''
    const proof = this.pendingProof(req, device.id, requestId)
    const request = this.registry?.getRequest(requestId)
    if (!proof || !request || request.deviceId !== device.id || request.status === 'denied') {
      this.discardPendingProof(proof)
      this.serveLoginPage(res, '这次请求已过期，请重新扫码或输入密码。', 403)
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(this.waitingPage({
      requestId: request.requestId,
      pairCode: request.code,
      label: request.label,
      client: request.client,
      expiresAt: request.expiresAt
    }))
  }

  // ── browser entry: password form and fragment ticket exchange ────────────

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
    this.readBody(req, res).then((bodyText) => {
      if (bodyText === null) return
      return this.completeLogin(req, res, bodyText)
    }).catch((error) => {
      this.options.log?.('browser login failed: ' + String(error?.message || error))
      if (!jsonResponseEnded(res)) this.serveLoginPage(res, '登录出错了，刷新页面再试一次。', 500)
    })
  }

  async completeLogin(req, res, bodyText) {
    const startedAt = Date.now()
    await this.waitAuthDelay(startedAt)
    const body = parseFormBody(bodyText, req.headers['content-type'])
    const device = this.identifyDevice(req)
    const registry = this.registry
    const existing = registry ? registry.get(device.id) : null
    if (!registry) {
      this.serveLoginPage(res, '远程登录服务暂不可用。', 503)
      return
    }
    if (existing && existing.state === 'blocked') {
      this.serveLoginPage(res, '这台设备已被拉黑，先在电脑上解除。', 403)
      return
    }
    const rateId = device.rateId || device.id
    if (this.rateLimited(rateId, req)) {
      this.serveLoginPage(res, '尝试过于频繁，请 5 分钟后再试。', 429)
      return
    }
    const submitted = typeof body?.password === 'string' ? body.password : ''
    if (!this.options.verifyPassword(submitted)) {
      const delay = this.noteFailure(rateId, req)
      await this.waitAuthDelay(startedAt, delay)
      this.serveLoginPage(res, '密码不对，再试一次。', 401)
      return
    }
    this.clearFailures(rateId)
    const admitted = this.admitDevice(device, req)
    if (admitted.ok) {
      registry.markLogin(device.id)
      this.options.log?.('browser login: ' + describeUserAgent(req.headers['user-agent']) + ' entered')
      res.writeHead(302, {
        location: '/',
        'cache-control': 'no-store',
        'set-cookie': [
          this.sessionCookieValue(req, device),
          this.deviceCookieValue(req, device.id),
          this.clearCookie(req, PENDING_COOKIE)
        ]
      })
      res.end()
      return
    }
    if (admitted.status === 202) {
      const proofCookie = this.makePendingProof(req, device.id, admitted.pending.requestId)
      this.options.log?.(
        'admission: browser waiting for approval (' + admitted.pending.label + '), code shown on both sides'
      )
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': [this.deviceCookieValue(req, device.id), proofCookie]
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
    return injectPwa(`<!doctype html><html lang="zh-CN"><head>
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
</body></html>`)
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
    this.readBody(req, res).then((bodyText) => {
      if (bodyText === null) return
      let body = {}
      try {
        body = JSON.parse(bodyText || '{}')
      } catch {
        body = {}
      }
      try {
        if (url.pathname === '/__device/token') {
          this.handleDeviceToken(req, res, bridge)
          return
        }
        const token = typeof req.headers['x-dsh-device-token'] === 'string' ? req.headers['x-dsh-device-token'] : ''
        const auth = bridge.authorize(req, token)
        if (!auth.ok) {
          this.sendJson(res, auth.code === 'disabled' ? 403 : 401, { ok: false, code: auth.code })
          return
        }
        const poll = url.pathname === '/__device/poll'
        const budget = this.beginDeviceRequest(token, poll)
        if (!budget.ok) {
          this.sendJson(res, 429, { ok: false, code: budget.code })
          return
        }
        this.touchActiveSessions(auth.deviceId)
        if (url.pathname === '/__device/poll') {
          this.handleDevicePoll(res, bridge, auth.deviceId, body, budget.key)
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
    }).catch((error) => {
      this.options.log?.('device channel failed: ' + String(error?.message || error))
      if (!jsonResponseEnded(res)) this.sendJson(res, 500, { ok: false, code: 'error' })
    })
  }

  /** A page session proves "this really is the approved phone"; the token is what outlives it. */
  handleDeviceToken(req, res, bridge) {
    if (bridge.enabled === false) {
      this.sendJson(res, 403, { ok: false, code: 'disabled' })
      return
    }
    const session = this.authorizedSession(req)
    if (!session || !session.deviceId) {
      this.sendJson(res, 401, { ok: false, code: 'session' })
      return
    }
    const budget = this.beginDeviceRequest(session.id, false)
    if (!budget.ok) {
      this.sendJson(res, 429, { ok: false, code: budget.code })
      return
    }
    this.touchActiveSessions(session.deviceId)
    try {
      const clientId = String(req.headers['x-dsh-client-id'] ?? '')
      const token = bridge.issueToken(session.deviceId, clientId)
      this.options.log?.('device channel: token issued to ' + String(session.deviceId).slice(0, 6) + '…')
      this.sendJson(res, 200, { ok: true, token, deviceId: session.deviceId })
    } catch (error) {
      this.sendJson(res, 403, { ok: false, code: 'not-trusted', message: String(error?.message || error) })
    }
  }

  handleDevicePoll(res, bridge, deviceId, body, rateKey) {
    const waitMs = Number(body?.waitMs)
    Promise.resolve(bridge.poll(deviceId, Number.isFinite(waitMs) ? waitMs : undefined))
      .then((cmd) => {
        this.endDevicePoll(rateKey)
        if (res.writableEnded) return
        if (!cmd) {
          res.writeHead(204, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        this.sendJson(res, 200, { ok: true, cmd })
      })
      .catch((error) => {
        this.endDevicePoll(rateKey)
        if (res.writableEnded) return
        this.sendJson(res, 500, { ok: false, code: 'error', message: String(error?.message || error) })
      })
  }

  isBlacklisted(deviceId) {
    return Boolean(deviceId && this.options.isBlacklisted?.(deviceId))
  }

  authorizedSession(req) {
    const deviceId = this.readDeviceId(req)
    const session = this.resolveSession(readCookie(req, SESSION_COOKIE))
    if (!deviceId || !session || session.deviceId !== deviceId) return null
    if (this.isBlacklisted(deviceId) || this.revokedByPolicy(session.deviceId)) return null
    if (this.onlineLimit(session.deviceId, session.id)) return null
    this.touchSessionRecord(session)
    return session
  }

  authorizeSession(req) {
    return Boolean(this.authorizedSession(req))
  }

  sessionCookieValue(req, device) {
    const current = this.authorizedSession(req)
    const value = current && current.deviceId === device?.id
      ? `${current.id}.${current.issuedAt}.${sign(this.getSessionSecret(), `${current.id}.${current.issuedAt}`)}`
      : this.issueSession(req, device)
    return `${SESSION_COOKIE}=${value}${this.cookieSuffix(req, SESSION_MAX_AGE_SECONDS)}`
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
    return injectPwa(`<!doctype html><html lang="zh-CN"><head>
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
<script>
(function () {
  var ticket = new URLSearchParams(location.hash.slice(1)).get('t');
  if (!ticket) return;
  history.replaceState(null, '', location.pathname + location.search);
  var message = document.querySelector('.err');
  message.textContent = '正在验证扫码票据…';
  fetch('/__verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: ticket })
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (result) {
      if (response.status === 200) {
        location.replace('/');
        return;
      }
      if (response.status === 202 && result.requestId) {
        location.replace('/__waiting?requestId=' + encodeURIComponent(result.requestId));
        return;
      }
      message.textContent = result.code === 'ticket'
        ? '这张二维码已过期或已使用，请回电脑重新扫码。'
        : result.code === 'too-many'
          ? '尝试过于频繁，请稍后再试。'
          : '扫码登录失败，请输入密码或重新扫码。';
    });
  }).catch(function () {
    message.textContent = '无法连接远程服务，请检查网络后重试。';
  });
})();
</script>
</body></html>`)
  }

  async bind(preferredPort, host = '127.0.0.1') {
    const candidates = []
    if (Number.isInteger(preferredPort) && preferredPort > 0) candidates.push(preferredPort)
    candidates.push(...CANDIDATE_PORTS)
    for (let attempt = 0; attempt < 40; attempt += 1) {
      candidates.push(50000 + Math.floor(Math.random() * 15000))
    }
    let lastError = null
    for (const port of candidates) {
      const server = http.createServer({ headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 }, (req, res) => this.handle(req, res))
      server.maxConnections = MAX_CONNECTIONS
      server.maxRequestsPerSocket = 256
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
          server.listen(port, host)
        })
        this.server = server
        this.port = port
        this.startedAt = Date.now()
        await this.bindTls(host)
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
  async bindTls(host = '127.0.0.1') {
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
        server = https.createServer({ ...tlsOptions, headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 }, (req, res) => this.handle(req, res))
        server.maxConnections = MAX_CONNECTIONS
        server.maxRequestsPerSocket = 256
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
          server.listen(port, host)
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
    const headers = { ...req.headers, host: authority, cookie: this.dshCookie, 'x-dsh-mobile-remote': '1' }
    delete headers['x-forwarded-host']
    delete headers['x-forwarded-proto']
    delete headers['x-forwarded-port']
    delete headers.forwarded
    const path = canonicalPath(new URL(req.url ?? '/', 'http://dsh.invalid').pathname)
    if (typeof headers.origin === 'string') headers.origin = this.upstreamOrigin()
    if (typeof headers.referer === 'string' && path) headers.referer = `${this.upstreamOrigin()}${path}`
    delete headers.authorization
    // A navigation may be rewritten on the way back (injectViewport), and a compressed body
    // cannot be rewritten without inflating it first, so ask for identity on navigations only.
    if (/text\/html/i.test(String(req.headers.accept || ''))) {
      headers['accept-encoding'] = 'identity'
      delete headers['if-none-match']
      delete headers['if-modified-since']
    }
    // Everything the gateway forwards came from a phone/tablet or another machine, never from
    // the owner's own DSH window (which talks to the upstream port directly). The panel uses
    // this to hide host-only controls; a client-side spoofed value is overwritten here.
    headers['x-dsh-panel-view'] = 'client'
    // The browser's own cookies never reach DSH — the owner cookie replaces them — so the device
    // identity travels in a header the gateway owns. Strip first: a phone must not be able to
    // claim another device id by sending the header itself.
    delete headers['x-dsh-device-id']
    // The device cookie can be cleared (private mode, a fresh browser); the session cookie still
    // names the device, so fall back to it rather than losing the per-device choices. The cookie
    // value is signed (<id>.<issuedAt>.<signature>), so forward the verified id, never the raw
    // value: the upstream routes match it against the device registry.
    const forwardedDevice = this.readDeviceId(req)
      || this.resolveSession(readCookie(req, SESSION_COOKIE))?.deviceId
    if (typeof forwardedDevice === 'string' && forwardedDevice.length >= 6) {
      headers['x-dsh-device-id'] = forwardedDevice
    }
    return headers
  }

  handle(req, res) {
    try {
      if (!this.publicEndpointAllowed()) {
        this.serveText(res, 403, 'HTTPS required.\n')
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const path = canonicalPath(url.pathname)
      if (!path) {
        this.serveText(res, 400, 'Bad request path.\n')
        return
      }
      url.pathname = path
      // Remote pages are allowed to read the plugin's client-facing routes (status, file pool,
      // their own UI mode, self-check) because the panel hides host-only controls when the
      // upstream stamps the request; host-only management POSTs are refused further down by
      // HOST_ONLY_API, which is the gate that must stay in front of state-changing calls.
      if (!this.requestOriginAllowed(req)) {
        this.serveText(res, 403, 'Origin rejected.\n')
        return
      }
      if (url.searchParams.has('p') || url.searchParams.has('t')) {
        const clean = new URL(url.href)
        clean.searchParams.delete('p')
        clean.searchParams.delete('t')
        if (req.method === 'GET' || req.method === 'HEAD') {
          res.writeHead(302, { location: clean.pathname + (clean.search || ''), 'cache-control': 'no-store' })
          res.end()
          return
        }
        url.searchParams.delete('p')
        url.searchParams.delete('t')
        req.url = url.pathname + url.search
      }

      // Public install assets contain no device/session data and stay available after login expires.
      if (servePwa(req, res, path)) return

      if (path === '/__verify' || path === '/__verify/status') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end('{"ok":false,"code":"method"}')
          return
        }
        this.readBody(req, res).then((bodyText) => {
          if (bodyText === null) return
          return this.handleVerify(req, res, url, bodyText)
        }).catch((error) => {
          this.options.log?.('gateway verify failed: ' + String(error?.message || error))
          if (!jsonResponseEnded(res)) this.sendJson(res, 500, { ok: false, code: 'error' })
        })
        return
      }

      if (path.startsWith('/__device/')) {
        this.handleDevice(req, res, url)
        return
      }

      if (path === '/__login') {
        this.handleLogin(req, res, url)
        return
      }

      if (path === '/__waiting') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          this.serveText(res, 405, 'Method not allowed.\n')
          return
        }
        this.handleWaiting(req, res, url)
        return
      }

      const session = this.authorizedSession(req)
      if (!session) {
        const loginDevice = this.touchDevice(req)
        if (this.isBlacklisted(loginDevice.id) || this.registry?.get(loginDevice.id)?.state === 'blocked') {
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
      } else {
        req.url = url.pathname + url.search
      }
      // Host-only settings never apply from a remote page: the switch, the password, the
      // entry mode, device approvals, the pool location. The panel hides them, and this is the
      // second line of defence for a client that calls the API anyway.
      if (HOST_ONLY_API.has(url.pathname) && req.method === 'POST') {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end('{"ok":false,"error":"这个设置要在电脑本机的面板上改。"}')
        return
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
        if (device?.isNew) headers = GatewayProxy.withCookie(headers, this.deviceCookieValue(req, device.id))
        let path = req.url ?? '/'
        const queryAt = path.indexOf('?')
        if (queryAt !== -1) path = path.slice(0, queryAt)
        const cacheControl = this.cachePolicy(path, upstreamRes.statusCode)
        if (cacheControl && req.method !== 'POST') headers = { ...headers, 'cache-control': cacheControl }
        const ua = String(req.headers['user-agent'] || '')
        // A phone that picked its own layout wins over the global default.
        const uiMode = resolveUiMode(this.options.getDeviceUiMode?.(device?.id) ?? this.options.getUiMode?.(), ua)
        // Remember what "auto" resolved to on the last phone/tablet navigation, so the panel can
        // say "this is what auto picks" instead of leaving the owner to guess.
        if (PHONE_UA.test(ua) || TABLET_UA.test(ua)) {
          this.uiProbe = { mode: uiMode, at: Date.now(), label: describeUserAgent(ua) }
        }
        const rewriteHtml = req.method === 'GET'
          && /text\/html/i.test(String(headers['content-type'] || ''))
          && !headers['content-encoding']
        if (rewriteHtml) {
          const chunks = []
          upstreamRes.on('data', (chunk) => chunks.push(chunk))
          upstreamRes.on('end', () => {
            let html = Buffer.concat(chunks).toString('utf8')
            if (PHONE_UA.test(ua) || TABLET_UA.test(ua)) html = injectViewport(html, uiMode)
            // Every gateway page can be installed, including an iPad requesting desktop mode.
            const body = Buffer.from(injectPwa(html), 'utf8')
            const outHeaders = { ...headers, 'content-length': String(body.length), 'cache-control': 'no-store' }
            delete outHeaders['transfer-encoding']
            delete outHeaders.etag
            delete outHeaders['last-modified']
            if (!res.headersSent) res.writeHead(upstreamRes.statusCode ?? 502, outHeaders)
            res.end(body)
          })
          return
        }
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
      if (!this.publicEndpointAllowed()) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const path = canonicalPath(url.pathname)
      if (!path) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        return
      }
      if (isPluginManagementPath(path)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      const refuse = (reason) => {
        this.options.log?.('gateway: refusing websocket (' + reason + ')')
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      }
      if (!this.requestOriginAllowed(req, true)) {
        refuse('origin')
        return
      }
      const session = this.authorizedSession(req)
      if (!session) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        return
      }
      req.url = path + url.search
      const limit = this.onlineLimit(session.deviceId, session.id)
      if (limit) {
        refuse('online limit ' + limit.online + '/' + limit.max)
        return
      }
      const entry = this.runtimeDevice(session.deviceId) || { firstSeen: Date.now(), lastSeen: Date.now(), pages: 0, hadPage: false }
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
      const sockets = this.sessionSockets.get(session.id) ?? new Set()
      sockets.add(socket)
      this.sessionSockets.set(session.id, sockets)
      socket.once('close', () => {
        const current = this.sessionSockets.get(session.id)
        if (!current) return
        current.delete(socket)
        if (current.size === 0) this.sessionSockets.delete(session.id)
      })
      this.touchActiveSessions(session.deviceId)
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

  async start(preferredPort, host = '127.0.0.1') {
    if (this.server) return this.port
    this.dshCookie = await this.options.getDshCookie()
    await this.bind(preferredPort, host)
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
