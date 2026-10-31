/**
 * Device bridge: the command channel that lets the agent act on the phone ("phone as hands").
 *
 * The phone polls `POST /__device/poll` and blocks for up to POLL_WAIT_MS on a command; the host
 * pushes one command into the per-device queue and the poll answers immediately. No WebSocket, no
 * extra port, nothing added to the DSH mux — the whole channel rides the gateway the phone already
 * uses for its page.
 *
 * Security:
 *   - the credential is a 32-byte device token bound to a trusted registry record, sent as
 *     `X-DSH-Device-Token`; removing/blocking the device clears it;
 *   - the channel only works while the owner switched phone assistance on (default OFF);
 *   - commands are never re-sent: a 30 s timeout fails the tool call instead of repeating a tap;
 *   - the trace keeps op names and outcomes, never screen text or typed content.
 *
 * P1 exposes only `status`. Screen reading and tapping land in P2 on top of this same channel.
 */
import { randomBytes } from 'node:crypto'

/** How long one poll request is held open. Shorter than the 30 s gateway idleness. */
export const POLL_WAIT_MS = 25000
/** A command that the phone did not answer in this window fails; it is never retried. */
export const COMMAND_TIMEOUT_MS = 30000
/** Refuse to pile work on a phone that is not draining its queue. */
export const MAX_QUEUE_PER_DEVICE = 8
/** A phone counts as online if it polled this recently (polls come every ~25 s). */
export const ONLINE_WINDOW_MS = 60000
/** In-memory trace length for the panel (op names only). */
export const MAX_TRACE_ENTRIES = 60

/** Ops the host is allowed to put on the wire. Anything else is a programming error, not input. */
const KNOWN_OPS = new Set(['status', 'screen', 'tap', 'long_press', 'type', 'key', 'scroll', 'open_app'])

export class DeviceBridge {
  /**
   * @param {object} options
   * @param {import('./registry.js').DeviceRegistry} options.registry
   * @param {(message: string) => void} [options.log]
   * @param {() => number} [options.now]
   */
  constructor(options = {}) {
    this.registry = options.registry ?? null
    this.log = typeof options.log === 'function' ? options.log : () => {}
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    /** @type {Map<string, {lastPollAt: number|null, queue: object[], waiters: object[], lastOp: string|null, lastError: string|null, lastResultAt: number|null}>} */
    this.devices = new Map()
    /** @type {Map<string, {resolve: Function, reject: Function, timer: any, cmd: object, started: number}>} */
    this.waiting = new Map()
    /** @type {object[]} */
    this.trace = []
    this.counter = 0
  }

  /** Owner switch (D1: off until the user turns it on). */
  get enabled() {
    return Boolean(this.registry && this.registry.settings.phoneAssist === true)
  }

  setEnabled(value) {
    if (!this.registry) return false
    const next = this.registry.setSettings({ phoneAssist: value === true })
    if (!next.phoneAssist) this.dropAll('手机协助已关闭')
    this.log('phone assist ' + (next.phoneAssist ? 'on' : 'off'))
    return next.phoneAssist
  }

  /** @returns {object} per-device channel bookkeeping, created on first use */
  device(deviceId) {
    let state = this.devices.get(deviceId)
    if (!state) {
      state = { lastPollAt: null, queue: [], waiters: [], lastOp: null, lastError: null, lastResultAt: null }
      this.devices.set(deviceId, state)
    }
    return state
  }

  // -- credentials ----------------------------------------------------------

  /**
   * Issue a token for a trusted device. Re-issuing rotates: the old token stops working.
   * @param {string} deviceId
   * @returns {string} the token (caller hands it to the phone, never to a log)
   */
  issueToken(deviceId) {
    if (!this.registry) throw new Error('设备注册表未就绪')
    const record = this.registry.get(deviceId)
    if (!record) throw new Error('未知设备')
    if (record.state !== 'trusted') throw new Error('设备尚未被允许，不能开通手机协助')
    const token = randomBytes(32).toString('base64url')
    this.registry.setDeviceToken(deviceId, token)
    this.log('phone channel token issued for ' + record.label + ' (' + deviceId.slice(0, 6) + '…)')
    return token
  }

  /** Revoke one device's token and fail whatever it was running. */
  revokeToken(deviceId) {
    if (!this.registry) return null
    this.dropDevice(deviceId, '设备已被移除')
    return this.registry.clearDeviceToken(deviceId)
  }

  /**
   * Authenticate a device-channel request.
   * @returns {{ok: true, deviceId: string, record: object} | {ok: false, code: string}}
   */
  authorize(req, headerValue) {
    if (!this.enabled) return { ok: false, code: 'disabled' }
    const raw = typeof headerValue === 'string' ? headerValue.trim() : ''
    if (!raw) return { ok: false, code: 'token' }
    const record = this.registry ? this.registry.findByToken(raw) : null
    if (!record) return { ok: false, code: 'token' }
    if (record.state !== 'trusted') return { ok: false, code: 'revoked' }
    return { ok: true, deviceId: record.deviceId, record }
  }

  // -- poll / enqueue -------------------------------------------------------

  /**
   * Hold one poll open until a command arrives or the wait expires.
   * @returns {Promise<object|null>} command, or null for "nothing to do" (204)
   */
  poll(deviceId, waitMs = POLL_WAIT_MS) {
    const state = this.device(deviceId)
    state.lastPollAt = this.now()
    if (state.queue.length > 0) {
      const cmd = state.queue.shift()
      this.record('deliver', cmd)
      return Promise.resolve(cmd)
    }
    const ms = Math.max(1000, Math.min(Number(waitMs) || POLL_WAIT_MS, 30000))
    return new Promise((resolve) => {
      const waiter = { resolve: null, timer: null }
      waiter.resolve = (cmd) => {
        clearTimeout(waiter.timer)
        resolve(cmd)
      }
      waiter.timer = setTimeout(() => {
        state.waiters = state.waiters.filter((item) => item !== waiter)
        resolve(null)
      }, ms)
      if (typeof waiter.timer.unref === 'function') waiter.timer.unref()
      state.waiters.push(waiter)
    })
  }

  /**
   * Queue a command for a device and resolve when its result comes back.
   * @param {{deviceId?: string, op: string, args?: object, timeoutMs?: number}} request
   */
  async call(request) {
    if (!this.enabled) {
      throw new Error('手机协助未开启：先在电脑面板「远程 → 设备准入 → 手机协助」打开')
    }
    const op = String(request?.op ?? '')
    if (!KNOWN_OPS.has(op)) throw new Error('手机不支持的指令：' + (op || '(空)'))
    const deviceId = request?.deviceId || this.defaultDeviceId()
    if (!deviceId) {
      // A trusted phone with no token is not "no phone": the host restarted and the app has not
      // re-minted its channel yet. Say so, or the owner goes hunting for a missing 允许 click.
      if (this.trustedWithoutChannel() > 0) {
        throw new Error('手机通道还没连上：在手机上打开 DSH Mobile Harness App 一次（或下拉刷新），正在自动重连')
      }
      throw new Error('没有已授权的手机：先在手机上连一次并在电脑上点「允许」')
    }
    if (!this.isOnline(deviceId)) {
      // D3: no queueing while the phone is away — the agent gets an error it can react to.
      throw new Error('手机不在线：先打开手机上的 DSH Mobile Harness App（手机协助不排队，会直接报错）')
    }
    const timeoutMs = Number(request?.timeoutMs) || COMMAND_TIMEOUT_MS
    const cmd = this.enqueue(deviceId, op, request?.args, timeoutMs)
    const started = this.now()
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(cmd.id)
        // A command that timed out must never reach the phone afterwards: in P2 an old "tap" would
        // fire on a screen the operator has long left.
        this.expireQueued(deviceId, cmd.id)
        this.record('timeout', cmd, this.now() - started)
        reject(new Error('手机没有在 ' + Math.round(timeoutMs / 1000) + ' 秒内执行（' + op + '）'))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.waiting.set(cmd.id, { resolve, reject, timer, cmd, started, deviceId })
    })
  }

  /** Drop a still-queued command whose caller already gave up. */
  expireQueued(deviceId, cmdId) {
    const state = this.devices.get(deviceId)
    if (!state) return
    const index = state.queue.findIndex((entry) => entry && entry.id === cmdId)
    if (index >= 0) state.queue.splice(index, 1)
  }

  /** Push one command into the queue, or hand it straight to a waiting poll. */
  enqueue(deviceId, op, args, timeoutMs = COMMAND_TIMEOUT_MS) {
    const state = this.device(deviceId)
    if (state.queue.length >= MAX_QUEUE_PER_DEVICE) {
      throw new Error('手机命令队列已满（' + MAX_QUEUE_PER_DEVICE + ' 条），等前面的执行完再试')
    }
    this.counter += 1
    const cmd = {
      id: 'c' + this.counter.toString(36) + randomBytes(3).toString('hex'),
      op,
      args: args && typeof args === 'object' ? args : {},
      deadlineMs: this.now() + timeoutMs
    }
    state.lastOp = op
    const waiter = state.waiters.shift()
    if (waiter) waiter.resolve(cmd)
    else state.queue.push(cmd)
    return cmd
  }

  /**
   * The phone reports the outcome of one command.
   * @returns {{ok: true} | {ok: false, code: string}}
   */
  complete(deviceId, payload) {
    const id = typeof payload?.id === 'string' ? payload.id : ''
    const waiter = id ? this.waiting.get(id) : null
    if (!waiter) return { ok: false, code: 'unknown-command' }
    this.waiting.delete(id)
    clearTimeout(waiter.timer)
    const ms = Number(payload?.ms)
    const elapsed = Number.isFinite(ms) && ms >= 0 ? ms : this.now() - waiter.started
    const failed = payload?.ok === false
    const error = failed ? String(payload?.error || '手机执行失败') : null
    const state = this.device(deviceId)
    state.lastError = error
    state.lastResultAt = this.now()
    this.record(failed ? 'error' : 'ok', waiter.cmd, elapsed, error)
    waiter.resolve({ ok: !failed, op: waiter.cmd.op, data: payload?.data ?? null, error, ms: elapsed })
    return { ok: true }
  }

  // -- liveness / housekeeping ---------------------------------------------

  isOnline(deviceId) {
    const state = this.devices.get(deviceId)
    if (!state) return false
    if (state.waiters.length > 0) return true
    if (!state.lastPollAt) return false
    return this.now() - state.lastPollAt < ONLINE_WINDOW_MS
  }

  /** The phone the tool talks to when the model did not name one: the freshest trusted device. */
  defaultDeviceId() {
    if (!this.registry) return null
    let best = null
    let bestAt = 0
    for (const record of this.registry.list()) {
      if (!record || record.state !== 'trusted' || !record.deviceToken) continue
      const state = this.devices.get(record.deviceId)
      const at = state?.lastPollAt ?? 0
      if (at > bestAt) {
        bestAt = at
        best = record.deviceId
      }
      if (!best) best = record.deviceId
    }
    return best
  }

  /** Trusted phones whose channel token is gone — host restart, or the app has not asked again yet. */
  trustedWithoutChannel() {
    if (!this.registry) return 0
    let count = 0
    for (const record of this.registry.list()) {
      if (record && record.state === 'trusted' && !record.deviceToken) count += 1
    }
    return count
  }

  /** Fail everything in flight for one device (removed, blocked, token revoked). */
  dropDevice(deviceId, reason = '设备已断开') {
    const state = this.devices.get(deviceId)
    if (state) {
      state.queue.length = 0
      for (const waiter of state.waiters) waiter.resolve(null)
      state.waiters.length = 0
    }
    for (const [id, waiter] of this.waiting) {
      if (waiter.deviceId !== deviceId) continue
      this.waiting.delete(id)
      clearTimeout(waiter.timer)
      this.record('cancelled', waiter.cmd, this.now() - waiter.started, reason)
      waiter.reject(new Error(reason))
    }
  }

  dropAll(reason = '手机协助已关闭') {
    for (const deviceId of this.devices.keys()) this.dropDevice(deviceId, reason)
    this.devices.clear()
  }

  /** @returns {object} panel payload: switches, per-device state and the recent trace */
  snapshot() {
    const devices = []
    for (const record of this.registry?.list() ?? []) {
      if (!record) continue
      const state = this.devices.get(record.deviceId)
      devices.push({
        deviceId: record.deviceId,
        label: record.label,
        state: record.state,
        authorized: Boolean(record.deviceToken),
        online: this.isOnline(record.deviceId),
        lastPollAt: state?.lastPollAt ?? null,
        lastResultAt: state?.lastResultAt ?? null,
        queue: state?.queue.length ?? 0,
        lastOp: state?.lastOp ?? null,
        lastError: state?.lastError ?? null
      })
    }
    devices.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return (b.lastPollAt ?? 0) - (a.lastPollAt ?? 0)
    })
    return {
      enabled: this.enabled,
      devices,
      onlineCount: devices.filter((entry) => entry.online).length,
      trace: this.trace.slice(-12).reverse(),
      pendingCount: this.waiting.size
    }
  }

  /** Ring buffer of op names and outcomes — never screen text, never typed content. */
  record(kind, cmd, ms, note = null) {
    if (!cmd) return
    this.trace.push({
      at: this.now(),
      kind,
      op: cmd.op,
      ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null,
      note: note ? String(note).slice(0, 120) : null
    })
    if (this.trace.length > MAX_TRACE_ENTRIES) this.trace.splice(0, this.trace.length - MAX_TRACE_ENTRIES)
  }
}
