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

import { randomBytes, randomInt } from 'node:crypto'

/** A waiting request disappears after 5 minutes unless the panel decides. */
export const PENDING_TTL_MS = 5 * 60 * 1000
/** At most this many devices can wait at once, so a stranger cannot flood the panel. */
export const MAX_PENDING_REQUESTS = 3
/** A denial stays readable by the phone for a minute so it can show "已拒绝". */
export const DENIED_GRACE_MS = 60 * 1000
/** Audit trail length (approve/deny/remove/block decisions). */
export const MAX_AUDIT_ENTRIES = 200
export const MAX_DEVICE_RECORDS = 500
export const DEVICE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Digits in the short code both screens show so the owner can tell which phone is asking. */
export const PAIRING_CODE_DIGITS = 6

const VALID_STATES = new Set(['pending', 'trusted', 'revoked', 'blocked'])
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const DEVICE_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/

/** Viewports a single phone may pick; null means "follow the global default". */
const UI_MODES = new Set(['auto', 'phone', 'tablet', 'compat'])

/** @returns {string|null} a valid per-device viewport mode, or null */
export function normalizeUiMode(value) {
  return UI_MODES.has(value) ? value : null
}

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
    this.onPhoneAssistDisabled = null
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
    if (patch.phoneAssist === false) {
      for (const record of this.state.devices) {
        if (!record) continue
        record.deviceToken = null
        record.deviceFingerprint = null
        record.tokenIssuedAt = null
      }
      this.onPhoneAssistDisabled?.()
    }
    this.state.settings = next
    this.persist()
    return next
  }

  // -- device records --------------------------------------------------------

  normalize(raw) {
    const now = this.now()
    const state = VALID_STATES.has(raw.state) ? raw.state : 'pending'
    const token = typeof raw.deviceToken === 'string' && DEVICE_TOKEN_PATTERN.test(raw.deviceToken) ? raw.deviceToken : null
    return {
      deviceId: String(raw.deviceId),
      label: typeof raw.label === 'string' && raw.label.length > 0 ? raw.label.slice(0, 80) : '未知设备',
      client: raw.client === 'app' ? 'app' : 'web',
      clientVersion: typeof raw.clientVersion === 'string' ? raw.clientVersion.slice(0, 32) : '',
      userAgent: typeof raw.userAgent === 'string' ? raw.userAgent.slice(0, 240) : '',
      state,
      // Per-device viewport override, so two phones can run different layouts at once.
      uiMode: normalizeUiMode(raw.uiMode),
      firstSeen: Number(raw.firstSeen) || now,
      lastSeen: Number(raw.lastSeen) || now,
      lastLoginAt: Number(raw.lastLoginAt) || null,
      approvedAt: Number(raw.approvedAt) || null,
      approvedBy: typeof raw.approvedBy === 'string' ? raw.approvedBy : null,
      revokedAt: Number(raw.revokedAt) || null,
      blockedAt: Number(raw.blockedAt) || null,
      // Device-channel credential (agent drives the phone). A token is never shown in the panel or
      // the diagnostics bundle; removing/blocking the device clears it.
      deviceToken: token,
      deviceFingerprint: token && typeof raw.deviceFingerprint === 'string' && DEVICE_FINGERPRINT_PATTERN.test(raw.deviceFingerprint)
        ? raw.deviceFingerprint
        : null,
      tokenIssuedAt: token ? Number(raw.tokenIssuedAt) || null : null
    }
  }

  /** @returns {object[]} every known device (do not mutate the returned array) */
  list() {
    return this.state.devices
  }

  /** @returns {object|null} */
  get(deviceId) {
    if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) return null
    return this.state.devices.find((entry) => entry.deviceId === deviceId) || null
  }

  /**
   * Create the device on first sight and refresh its display metadata.
   * @param {string} deviceId
   * @param {{label?: string, client?: string, clientVersion?: string, userAgent?: string}} info
   */
  touch(deviceId, info = {}) {
    if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) throw new Error('设备标识无效')
    const now = this.now()
    let record = this.get(deviceId)
    let created = false
    if (!record) {
      if (this.state.devices.length >= MAX_DEVICE_RECORDS) throw new Error('设备记录已满，请先清理旧记录')
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
    record.deviceFingerprint = null
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
      record.deviceFingerprint = null
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
    record.deviceFingerprint = null
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
  setDeviceToken(deviceId, token, fingerprint) {
    const record = this.get(deviceId)
    if (!record || typeof token !== 'string' || !DEVICE_TOKEN_PATTERN.test(token) ||
        typeof fingerprint !== 'string' || !DEVICE_FINGERPRINT_PATTERN.test(fingerprint)) return null
    record.deviceToken = String(token)
    record.deviceFingerprint = fingerprint
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
    record.deviceFingerprint = null
    record.tokenIssuedAt = null
    this.audit('phone-unpair', record, 'panel')
    this.persist()
    return record
  }

  clearDeviceTokens() {
    let changed = false
    for (const record of this.state.devices) {
      if (!record || !record.deviceToken) continue
      record.deviceToken = null
      record.deviceFingerprint = null
      record.tokenIssuedAt = null
      changed = true
    }
    if (changed) this.persist()
    return changed
  }

  /** Resolve a device-channel token to its record, in constant time. */
  findByToken(token) {
    if (typeof token !== 'string' || !DEVICE_TOKEN_PATTERN.test(token)) return null
    const now = this.now()
    let expired = false
    let found = null
    for (const record of this.state.devices) {
      if (!record || typeof record.deviceToken !== 'string' || record.deviceToken.length === 0) continue
      const issuedAt = Number(record.tokenIssuedAt) || 0
      if (!issuedAt || issuedAt > now + 60000 || now - issuedAt >= DEVICE_TOKEN_TTL_MS) {
        record.deviceToken = null
        record.deviceFingerprint = null
        record.tokenIssuedAt = null
        expired = true
        continue
      }
      if (timingSafeEqualString(record.deviceToken, token)) found = record
    }
    if (expired) this.persist()
    return found
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
      record.deviceToken = null
      record.deviceFingerprint = null
      record.tokenIssuedAt = null
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
   * Import old sessions once as revoked records; only explicit registry trust survives upgrades.
   */
  migrate() {
    let changed = false
    const migrateSessions = this.state.deviceRegistryVersion !== 2
    const devices = []
    const seen = new Set()
    for (const raw of this.state.devices ?? []) {
      if (!raw || typeof raw.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(raw.deviceId)) {
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
    if (migrateSessions) {
      for (const session of this.state.sessions ?? []) {
        const deviceId = session?.deviceId
        if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId) || seen.has(deviceId)) continue
        seen.add(deviceId)
        changed = true
        devices.push(
          this.normalize({
            deviceId,
            label: session.label,
            client: session.client,
            clientVersion: session.clientVersion,
            state: 'revoked',
            firstSeen: session.issuedAt,
            lastSeen: session.lastSeen,
            revokedAt: this.now()
          })
        )
      }
    }
    for (const entry of this.state.blacklist ?? []) {
      const deviceId = entry?.deviceId
      if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) continue
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
    const boundedDevices = devices.length > MAX_DEVICE_RECORDS
      ? devices
          .map((record, index) => ({ record, index }))
          .sort((left, right) => Number(right.record.state === 'blocked') - Number(left.record.state === 'blocked') || left.index - right.index)
          .slice(0, MAX_DEVICE_RECORDS)
          .sort((left, right) => left.index - right.index)
          .map(({ record }) => record)
      : devices
    if (boundedDevices.length !== devices.length) changed = true
    this.state.devices = boundedDevices
    if (migrateSessions) {
      this.state.deviceRegistryVersion = 2
      changed = true
    }
    if (changed) {
      this.log('device registry migrated (' + boundedDevices.length + ' device records)')
      this.persist()
    }
    return changed
  }
}

function randomRequestId() {
  return 'req-' + randomBytes(12).toString('base64url')
}

/** Length-aware constant-time compare, so a token cannot be guessed byte by byte. */
function timingSafeEqualString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

/** Six digits, unique among the requests currently waiting. */
function randomPairingCode(taken) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let digits = ''
    for (let digitIndex = 0; digitIndex < PAIRING_CODE_DIGITS; digitIndex += 1) digits += String(randomInt(0, 10))
    if (!taken || !taken.has(digits)) return digits
  }
  return String(randomInt(0, 10 ** PAIRING_CODE_DIGITS)).padStart(PAIRING_CODE_DIGITS, '0')
}
