/**
 * Device registry: the long-lived identity of every phone/browser that ever reached the
 * gateway, its trust state and the queue of connections waiting for approval.
 *
 * Persisted inside plugin-state.json so trust survives a DSH restart. The gateway keeps the
 * live part (open WebSockets) in memory; this class owns what has to be durable.
 *
 *   unknown --password--> pending --allow--> trusted --remove--> revoked
 *                                  \--deny--> revoked (denied, 60 s grace)
 *   any --block--> blocked --unblock--> revoked (must be approved again)
 */

/** A waiting request disappears after 5 minutes unless the panel decides. */
export const PENDING_TTL_MS = 5 * 60 * 1000
/** At most this many devices can wait at once, so a stranger cannot flood the panel. */
export const MAX_PENDING_REQUESTS = 3
/** A denial stays readable by the phone for a minute so it can show "已拒绝". */
export const DENIED_GRACE_MS = 60 * 1000
/** Audit trail length (approve/deny/remove/block decisions). */
export const MAX_AUDIT_ENTRIES = 200

/** Digits in the short code both screens show so the owner can tell which phone is asking. */
export const PAIRING_CODE_DIGITS = 6

const VALID_STATES = new Set(['pending', 'trusted', 'revoked', 'blocked'])

/** 0 means "no limit"; otherwise clamp to 1-10 so the panel cannot brick itself. */
export function clampMaxOnlineDevices(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return 3
  const int = Math.floor(raw)
  if (int <= 0) return 0
  return Math.min(10, int)
}

export class DeviceRegistry {
  /**
   * @param {object} state plugin-state.json document (mutated in place)
   * @param {{persist?: () => void, log?: (message: string) => void, now?: () => number}} [options]
   */
  constructor(state, options = {}) {
    this.state = state
    this.persist = typeof options.persist === 'function' ? options.persist : () => {}
    this.log = typeof options.log === 'function' ? options.log : () => {}
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    if (!Array.isArray(this.state.devices)) this.state.devices = []
    if (!Array.isArray(this.state.pendingRequests)) this.state.pendingRequests = []
    if (!Array.isArray(this.state.audit)) this.state.audit = []
    if (!this.state.settings || typeof this.state.settings !== 'object') this.state.settings = {}
  }

  /**
   * Current policy. requireApproval defaults to ON: an unknown device must be allowed.
   * phoneAssist (agent may drive the phone) defaults to OFF: it needs an explicit opt-in.
   */
  get settings() {
    const raw = this.state.settings || {}
    return {
      requireApproval: raw.requireApproval !== false,
      maxOnlineDevices: clampMaxOnlineDevices(raw.maxOnlineDevices),
      phoneAssist: raw.phoneAssist === true
    }
  }

  /** @param {{requireApproval?: boolean, maxOnlineDevices?: number, phoneAssist?: boolean}} patch */
  setSettings(patch = {}) {
    const next = this.settings
    if (patch.requireApproval !== undefined) next.requireApproval = patch.requireApproval === true
    if (patch.maxOnlineDevices !== undefined) next.maxOnlineDevices = clampMaxOnlineDevices(patch.maxOnlineDevices)
    if (patch.phoneAssist !== undefined) next.phoneAssist = patch.phoneAssist === true
    this.state.settings = next
    this.persist()
    return next
  }

  // -- device records --------------------------------------------------------

  normalize(raw) {
    const now = this.now()
    const state = VALID_STATES.has(raw.state) ? raw.state : 'pending'
    return {
      deviceId: String(raw.deviceId),
      label: typeof raw.label === 'string' && raw.label.length > 0 ? raw.label : '未知设备',
      client: raw.client === 'app' ? 'app' : 'web',
      clientVersion: typeof raw.clientVersion === 'string' ? raw.clientVersion.slice(0, 32) : '',
      userAgent: typeof raw.userAgent === 'string' ? raw.userAgent.slice(0, 240) : '',
      state,
      firstSeen: Number(raw.firstSeen) || now,
      lastSeen: Number(raw.lastSeen) || now,
      lastLoginAt: Number(raw.lastLoginAt) || null,
      approvedAt: Number(raw.approvedAt) || null,
      approvedBy: typeof raw.approvedBy === 'string' ? raw.approvedBy : null,
      revokedAt: Number(raw.revokedAt) || null,
      blockedAt: Number(raw.blockedAt) || null,
      // Device-channel credential (agent drives the phone). A token is never shown in the panel or
      // the diagnostics bundle; removing/blocking the device clears it.
      deviceToken: typeof raw.deviceToken === 'string' && raw.deviceToken.length > 0 ? raw.deviceToken : null,
      tokenIssuedAt: Number(raw.tokenIssuedAt) || null
    }
  }

  /** @returns {object[]} every known device (do not mutate the returned array) */
  list() {
    return this.state.devices
  }

  /** @returns {object|null} */
  get(deviceId) {
    if (typeof deviceId !== 'string' || deviceId.length === 0) return null
    return this.state.devices.find((entry) => entry.deviceId === deviceId) || null
  }

  /**
   * Create the device on first sight and refresh its display metadata.
   * @param {string} deviceId
   * @param {{label?: string, client?: string, clientVersion?: string, userAgent?: string}} info
   */
  touch(deviceId, info = {}) {
    const now = this.now()
    let record = this.get(deviceId)
    let created = false
    if (!record) {
      record = this.normalize({ deviceId, ...info, state: 'pending', firstSeen: now, lastSeen: now })
      this.state.devices.push(record)
      created = true
    } else {
      record.lastSeen = now
      if (info.label) record.label = String(info.label).slice(0, 80)
      if (info.client) record.client = info.client === 'app' ? 'app' : 'web'
      if (info.clientVersion) record.clientVersion = String(info.clientVersion).slice(0, 32)
      if (info.userAgent) record.userAgent = String(info.userAgent).slice(0, 240)
    }
    this.persist()
    return { record, created }
  }

  markLogin(deviceId) {
    const record = this.get(deviceId)
    if (!record) return null
    record.lastSeen = this.now()
    record.lastLoginAt = record.lastSeen
    this.persist()
    return record
  }

  /** Trust without an approval round (policy switched off, or migration). */
  autoTrust(deviceId, by = 'auto') {
    const record = this.get(deviceId)
    if (!record) return null
    if (record.state !== 'trusted') {
      record.state = 'trusted'
      record.approvedAt = this.now()
      record.approvedBy = by
      record.revokedAt = null
      this.persist()
    }
    return record
  }

  approve(deviceId, by = 'panel') {
    const record = this.get(deviceId)
    if (!record) return null
    record.state = 'trusted'
    record.approvedAt = this.now()
    record.approvedBy = by
    record.revokedAt = null
    this.dropRequestsFor(deviceId)
    this.audit('approve', record, by)
    this.persist()
    return record
  }

  /** Revoke trust: the device must ask again next time. */
  revoke(deviceId, by = 'panel') {
    const record = this.get(deviceId)
    if (!record) return null
    record.state = 'revoked'
    record.revokedAt = this.now()
    // A removed device must also lose the ability to drive the phone channel.
    record.deviceToken = null
    record.tokenIssuedAt = null
    this.dropRequestsFor(deviceId)
    this.audit('remove', record, by)
    this.persist()
    return record
  }

  /**
   * "Kick everyone": the proxy closes the sessions, and trust is dropped here too, so each device
   * has to be allowed again (and therefore sees a pairing code) on its next connection.
   */
  revokeAll(by = 'panel') {
    const now = this.now()
    let changed = 0
    for (const record of this.state.devices) {
      if (!record || record.state !== 'trusted') continue
      record.state = 'revoked'
      record.revokedAt = now
      record.deviceToken = null
      record.tokenIssuedAt = null
      changed += 1
      this.audit('remove', record, by)
    }
    if (changed > 0) this.persist()
    return changed
  }

  block(deviceId, by = 'panel') {
    const record = this.get(deviceId)
    if (!record) return null
    record.state = 'blocked'
    record.blockedAt = this.now()
    record.deviceToken = null
    record.tokenIssuedAt = null
    this.dropRequestsFor(deviceId)
    this.audit('block', record, by)
    this.persist()
    return record
  }

  unblock(deviceId, by = 'panel') {
    const record = this.get(deviceId)
    if (!record) return null
    record.state = 'revoked'
    record.blockedAt = null
    this.audit('unblock', record, by)
    this.persist()
    return record
  }

  // -- device channel tokens -------------------------------------------------

  /** Bind a fresh 32-byte token to a trusted device. A token is opaque and never displayed. */
  setDeviceToken(deviceId, token) {
    const record = this.get(deviceId)
    if (!record) return null
    record.deviceToken = String(token)
    record.tokenIssuedAt = this.now()
    this.audit('phone-token', record, 'panel')
    this.persist()
    return record
  }

  /** Drop the device token: the phone can no longer act on this computer's behalf. */
  clearDeviceToken(deviceId) {
    const record = this.get(deviceId)
    if (!record || !record.deviceToken) return null
    record.deviceToken = null
    record.tokenIssuedAt = null
    this.audit('phone-unpair', record, 'panel')
    this.persist()
    return record
  }

  /** Resolve a device-channel token to its record, in constant time. */
  findByToken(token) {
    if (typeof token !== 'string' || token.length < 20) return null
    for (const record of this.state.devices) {
      if (!record || typeof record.deviceToken !== 'string' || record.deviceToken.length === 0) continue
      if (timingSafeEqualString(record.deviceToken, token)) return record
    }
    return null
  }

  /** Forget every device, request and audit row (panel "清空记录"). */
  reset() {
    this.state.devices = []
    this.state.pendingRequests = []
    this.state.audit = []
    this.persist()
  }

  // -- pending queue ---------------------------------------------------------

  purgeRequests() {
    const now = this.now()
    const before = this.state.pendingRequests.length
    this.state.pendingRequests = this.state.pendingRequests.filter((entry) => {
      if (!entry || typeof entry.requestId !== 'string') return false
      if (entry.status === 'denied') return now - (Number(entry.decidedAt) || 0) < DENIED_GRACE_MS
      return Number(entry.expiresAt) > now
    })
    return before !== this.state.pendingRequests.length
  }

  /** @returns {object[]} requests still waiting for a decision, oldest first */
  pendingList() {
    if (this.purgeRequests()) this.persist()
    return this.state.pendingRequests
      .filter((entry) => entry.status !== 'denied')
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  getRequest(requestId) {
    if (typeof requestId !== 'string') return null
    if (this.purgeRequests()) this.persist()
    return this.state.pendingRequests.find((entry) => entry.requestId === requestId) || null
  }

  pendingForDevice(deviceId) {
    if (this.purgeRequests()) this.persist()
    return this.state.pendingRequests.find((entry) => entry.deviceId === deviceId && entry.status !== 'denied') || null
  }

  /** A recent denial, so the phone's retry loop can report "已被拒绝" instead of queueing again. */
  recentDenial(deviceId) {
    if (this.purgeRequests()) this.persist()
    return this.state.pendingRequests.find((entry) => entry.deviceId === deviceId && entry.status === 'denied') || null
  }

  /**
   * Queue (or reuse) an approval request for this device.
   * @returns {{ok: true, request: object} | {ok: false, reason: 'max-pending'}}
   */
  requestApproval(record, info = {}) {
    const existing = this.pendingForDevice(record.deviceId)
    if (existing) {
      existing.label = record.label
      existing.client = record.client
      existing.clientVersion = record.clientVersion
      this.persist()
      return { ok: true, request: existing }
    }
    if (this.pendingList().length >= MAX_PENDING_REQUESTS) return { ok: false, reason: 'max-pending' }
    const now = this.now()
    const takenCodes = new Set(this.state.pendingRequests.map((entry) => entry && entry.code).filter(Boolean))
    const request = {
      requestId: randomRequestId(),
      code: randomPairingCode(takenCodes),
      deviceId: record.deviceId,
      label: record.label,
      client: record.client,
      clientVersion: record.clientVersion,
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
      status: 'pending'
    }
    // A first-time device is "pending" in the registry too, so the panel can group it.
    if (record.state !== 'trusted' && record.state !== 'blocked') record.state = 'pending'
    record.lastSeen = now
    this.state.pendingRequests.push(request)
    this.audit('request', record, info.actor || 'device')
    this.persist()
    return { ok: true, request }
  }

  deny(requestId, by = 'panel') {
    const request = this.getRequest(requestId)
    if (!request || request.status === 'denied') return null
    request.status = 'denied'
    request.decidedAt = this.now()
    request.decidedBy = by
    const record = this.get(request.deviceId)
    if (record) {
      record.state = 'revoked'
      record.revokedAt = request.decidedAt
      this.audit('deny', record, by)
    }
    this.persist()
    return request
  }

  dropRequestsFor(deviceId) {
    const before = this.state.pendingRequests.length
    this.state.pendingRequests = this.state.pendingRequests.filter((entry) => entry.deviceId !== deviceId)
    return before !== this.state.pendingRequests.length
  }

  // -- audit ----------------------------------------------------------------

  audit(action, record, actor = 'panel') {
    const entry = {
      at: this.now(),
      action,
      deviceId: record?.deviceId ?? null,
      label: record?.label ?? '',
      actor
    }
    this.state.audit.push(entry)
    if (this.state.audit.length > MAX_AUDIT_ENTRIES) this.state.audit.splice(0, this.state.audit.length - MAX_AUDIT_ENTRIES)
    return entry
  }

  auditList(limit = 20) {
    return this.state.audit.slice(-limit).reverse()
  }

  // -- migration from the 0.3.x state file ----------------------------------

  /**
   * Upgrading must not turn every existing phone into a stranger: whatever appears in the old
   * sessions list becomes trusted, whatever appears in the old blacklist stays blocked.
   */
  migrate() {
    let changed = false
    const devices = []
    const seen = new Set()
    for (const raw of this.state.devices ?? []) {
      if (!raw || typeof raw.deviceId !== 'string' || raw.deviceId.length === 0) {
        changed = true
        continue
      }
      if (seen.has(raw.deviceId)) {
        changed = true
        continue
      }
      seen.add(raw.deviceId)
      devices.push(this.normalize(raw))
    }
    for (const session of this.state.sessions ?? []) {
      const deviceId = session?.deviceId
      if (typeof deviceId !== 'string' || deviceId.length === 0 || seen.has(deviceId)) continue
      seen.add(deviceId)
      changed = true
      devices.push(
        this.normalize({
          deviceId,
          label: session.label,
          client: session.client,
          clientVersion: session.clientVersion,
          state: 'trusted',
          firstSeen: session.issuedAt,
          lastSeen: session.lastSeen,
          approvedAt: session.issuedAt,
          approvedBy: 'migration'
        })
      )
    }
    for (const entry of this.state.blacklist ?? []) {
      const deviceId = entry?.deviceId
      if (typeof deviceId !== 'string' || deviceId.length === 0) continue
      if (seen.has(deviceId)) {
        const record = devices.find((item) => item.deviceId === deviceId)
        if (record && record.state !== 'blocked') {
          record.state = 'blocked'
          record.blockedAt = Number(entry.at) || this.now()
          changed = true
        }
        continue
      }
      seen.add(deviceId)
      changed = true
      devices.push(
        this.normalize({
          deviceId,
          label: entry.label,
          client: entry.client,
          state: 'blocked',
          firstSeen: entry.at,
          lastSeen: entry.at,
          blockedAt: entry.at
        })
      )
    }
    this.state.devices = devices
    if (changed) {
      this.log('device registry migrated (' + devices.length + ' device records)')
      this.persist()
    }
    return changed
  }
}

function randomRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** Length-aware constant-time compare, so a token cannot be guessed byte by byte. */
function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Six digits, unique among the requests currently waiting. */
function randomPairingCode(taken) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let digits = ''
    for (let i = 0; i < PAIRING_CODE_DIGITS; i += 1) digits += String(Math.floor(Math.random() * 10))
    if (!taken || !taken.has(digits)) return digits
  }
  return String(Date.now()).slice(-PAIRING_CODE_DIGITS)
}
