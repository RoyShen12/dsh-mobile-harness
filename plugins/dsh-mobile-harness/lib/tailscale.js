/**
 * Thin controller for the local `tailscale` CLI.
 *
 * The plugin never embeds a tunnel: it asks Tailscale to publish the loopback proxy on
 * port 80 of the node's tailnet name (`tailscale serve --http=80`), which is reachable
 * from every device in the user's tailnet over WireGuard. On disable it only turns that
 * port off, leaving any other serve configuration alone.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'

const run = promisify(execFile)

const CANDIDATES = [
  'tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
  '/usr/local/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
]

/** @returns {Promise<string|null>} resolved executable path or null */
export async function findTailscale() {
  for (const candidate of CANDIDATES) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate
      continue
    }
    try {
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
export async function serveOn80(exe, port) {
  const { stdout, stderr } = await run(
    exe,
    ['serve', '--bg', '--http=80', `http://127.0.0.1:${port}`],
    { timeout: 20000, windowsHide: true }
  )
  return (stdout + stderr).trim()
}

/** Stop publishing port 80 (other serve entries stay). */
export async function stopServe80(exe) {
  try {
    await run(exe, ['serve', '--http=80', 'off'], { timeout: 15000, windowsHide: true })
  } catch {
    /* already off */
  }
}

/**
 * Build the phone-facing URL for a served node.
 * @param {string|null} dnsName
 * @returns {string|null}
 */
export function publicUrlFor(dnsName) {
  if (!dnsName) return null
  return `http://${dnsName}/`
}

