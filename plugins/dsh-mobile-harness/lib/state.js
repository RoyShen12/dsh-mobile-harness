/**
 * Durable state for the remote-access plugin.
 *
 * Stored under `$DSH_HOME/remote-access/` next to the standalone launcher's files, so a
 * user who used the CLI proxy first keeps the same password. 0600 where the platform
 * honours it (Windows ACLs otherwise).
 */
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

export const STATE_DIR_NAME = 'remote-access'
export const STATE_FILE_NAME = 'plugin-state.json'

/** @returns {string} absolute path of the shared remote-access directory */
export function resolveStateDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return resolve(home, STATE_DIR_NAME)
}

/** @returns {string} absolute path of this plugin's state file */
export function resolveStateFile() {
  return join(resolveStateDir(), STATE_FILE_NAME)
}

function defaultState() {
  return {
    version: 1,
    /** whether the switch was on when the Host last shut down */
    enabled: false,
    /** 'tailscale' | 'external' | 'quick' | 'lan' | 'none' */
    tunnel: 'tailscale',
    /** public URL of an external relay (e.g. https://frp-cat.com:12345/), shown in the panel */
    externalUrl: null,
    /** lan entry: the adapter address to advertise (null = first by the preference order) */
    lanAddress: null,
    /** viewport served to phones/tablets: 'auto' | 'phone' | 'tablet' | 'compat' */
    uiMode: 'auto',
    /** absolute folder for the shared file pool (null = <state dir>/files) */
    filePoolDir: null,
    /** display password for the remote login page, shown only on local request */
    password: null,
    /** when true the gateway requires the access password (verified through POST /__verify) */
    passwordEnabled: true,
    /** HMAC key for the proxy's own session cookies */
    secret: null,
    /** last bound proxy port, for a stable restart */
    proxyPort: null,
    /** authorized device sessions: { id, deviceId, label, userAgent, issuedAt, lastSeen, revoked } */
    sessions: [],
    /** blocked devices: { deviceId, label, userAgent, at } (legacy mirror, see devices[].state) */
    blacklist: [],
    /** approval policy: { requireApproval, maxOnlineDevices } (0 = unlimited) */
    settings: { requireApproval: true, maxOnlineDevices: 3 },
    /** durable trust records, one per phone: { deviceId, label, client, state, ... } */
    devices: [],
    /** connections waiting for the owner: { requestId, deviceId, label, createdAt, expiresAt, status } */
    pendingRequests: [],
    /** recent approve/deny/remove/block decisions */
    audit: []
  }
}

const TUNNEL_MODES = new Set(['tailscale', 'external', 'quick', 'lan', 'none'])

/** @returns {object} loaded state, repaired with defaults */
export function loadState() {
  const dir = resolveStateDir()
  const file = resolveStateFile()
  try {
    chmodSync(dir, 0o700)
  } catch (error) {
    if (process.platform !== 'win32' && error?.code !== 'ENOENT') throw error
  }
  try {
    chmodSync(file, 0o600)
  } catch (error) {
    if (process.platform !== 'win32' && error?.code !== 'ENOENT') throw error
  }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return defaultState()
    throw new Error(`远程访问状态文件无法读取：${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`远程访问状态文件损坏：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('远程访问状态文件格式无效')
  }
  for (const key of ['sessions', 'blacklist', 'devices', 'pendingRequests', 'audit']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new Error(`远程访问状态字段无效：${key}`)
    }
  }
  if (parsed.settings !== undefined && (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings))) {
    throw new Error('远程访问状态字段无效：settings')
  }
  const base = defaultState()
  return {
    ...base,
    ...parsed,
    version: 1,
    tunnel: TUNNEL_MODES.has(parsed.tunnel) ? parsed.tunnel : 'tailscale',
    externalUrl: typeof parsed.externalUrl === 'string' && parsed.externalUrl.length > 0 ? parsed.externalUrl : null,
    lanAddress: typeof parsed.lanAddress === 'string' && parsed.lanAddress.length > 0 ? parsed.lanAddress : null,
    uiMode: ['auto', 'phone', 'tablet', 'compat'].includes(parsed.uiMode) ? parsed.uiMode : 'auto',
    filePoolDir: typeof parsed.filePoolDir === 'string' && parsed.filePoolDir.trim().length > 0 ? parsed.filePoolDir.trim() : null,
    passwordEnabled: true,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
    devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    pendingRequests: Array.isArray(parsed.pendingRequests) ? parsed.pendingRequests : [],
    audit: Array.isArray(parsed.audit) ? parsed.audit : []
  }
}

export function saveState(state) {
  const dir = resolveStateDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
  const file = resolveStateFile()
  const temp = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  const contents = JSON.stringify({ ...state, passwordEnabled: true }, null, 2)
  let fd = null
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, contents, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(temp, file)
    try {
      chmodSync(file, 0o600)
    } catch (error) {
      if (process.platform !== 'win32') throw error
    }
    let dirFd = null
    try {
      dirFd = openSync(dir, 'r')
      fsyncSync(dirFd)
    } catch {} finally {
      if (dirFd !== null) closeSync(dirFd)
    }
  } catch (error) {
    if (fd !== null) closeSync(fd)
    try {
      unlinkSync(temp)
    } catch {}
    throw error
  }
}

/** @returns {string} url-safe random password */
export function randomPassword(bytes = 9) {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Reuse the password the standalone launcher already generated, so switching modes does
 * not lock the phone out with an unknown credential.
 * @returns {string|null}
 */
export function readLegacyPassword() {
  try {
    const file = join(resolveStateDir(), 'password.txt')
    try {
      chmodSync(file, 0o600)
    } catch (error) {
      if (process.platform !== 'win32') throw error
    }
    const text = readFileSync(file, 'utf8').trim()
    return text.length >= 12 ? text : null
  } catch {
    return null
  }
}

/** @returns {string} url-safe random secret */
export function randomSecret() {
  return randomBytes(32).toString('base64url')
}
