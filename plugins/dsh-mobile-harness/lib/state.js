/**
 * Durable state for the remote-access plugin.
 *
 * Stored under `$DSH_HOME/remote-access/` next to the standalone launcher's files, so a
 * user who used the CLI proxy first keeps the same password. 0600 where the platform
 * honours it (Windows ACLs otherwise).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

export const STATE_DIR_NAME = 'remote-access'
export const STATE_FILE_NAME = 'plugin-state.json'

/** @returns {string} absolute path of the shared remote-access directory */
export function resolveStateDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, STATE_DIR_NAME)
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
    /** display password for the remote login page (plain text by design: the UI shows it) */
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
  const file = resolveStateFile()
  if (!existsSync(file)) return defaultState()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
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
      passwordEnabled: parsed.passwordEnabled !== false,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : []
    }
  } catch {
    return defaultState()
  }
}

/** Persist state atomically enough for a small JSON document. */
export function saveState(state) {
  const dir = resolveStateDir()
  mkdirSync(dir, { recursive: true })
  const file = resolveStateFile()
  writeFileSync(file, JSON.stringify(state, null, 2))
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows: ACLs come from the profile directory */
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
    const text = readFileSync(join(resolveStateDir(), 'password.txt'), 'utf8').trim()
    return text.length >= 6 ? text : null
  } catch {
    return null
  }
}

/** @returns {string} url-safe random secret */
export function randomSecret() {
  return randomBytes(32).toString('base64url')
}
