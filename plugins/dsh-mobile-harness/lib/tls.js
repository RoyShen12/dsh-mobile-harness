/**
 * Self-signed TLS material for the loopback gateway.
 *
 * SakuraFrp (and some other relays) reject plain HTTP over a TCP tunnel, so the public
 * entry has to speak TLS end to end. The certificate is generated once and reused; a
 * browser shows a one-time "not trusted" warning, which is acceptable for a personal
 * gateway that is still password protected.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const OPENSSL_CANDIDATES = [
  'openssl',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\OpenSSL\\bin\\openssl.exe',
  'E:\\miniconda3\\Library\\bin\\openssl.exe',
  'C:\\ProgramData\\miniconda3\\Library\\bin\\openssl.exe'
]

const SUBJECT_ALT_NAMES = [
  'DNS:localhost',
  'IP:127.0.0.1',
  'DNS:frp-cat.com',
  'DNS:dx.frp-cat.com',
  'DNS:yd.frp-cat.com',
  'DNS:lt.frp-cat.com'
].join(',')

const PFX_PASSWORD = 'dsh-remote-gateway'

/** Last failure reason, surfaced for diagnostics. */
export let lastTlsError = null

/** @returns {string|null} usable openssl executable */
function findOpenssl() {
  for (const candidate of OPENSSL_CANDIDATES) {
    try {
      const result = spawnSync(candidate, ['version'], { windowsHide: true, timeout: 5000 })
      if (!result.error && result.status === 0) return candidate
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/**
 * @param {string} stateDir directory that persists across restarts
 * @returns {{key?: Buffer, cert?: Buffer, pfx?: Buffer, passphrase?: string}|null}
 */
export function ensureTlsMaterials(stateDir) {
  try {
    const dir = join(stateDir, 'tls')
    mkdirSync(dir, { recursive: true })
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    if (existsSync(keyPath) && existsSync(certPath)) {
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
    }

    const openssl = findOpenssl()
    if (openssl) {
      // Some Windows OpenSSL builds point OPENSSL_CONF at a missing file; give them one.
      const confPath = join(dir, 'openssl.cnf')
      if (!existsSync(confPath)) writeFileSync(confPath, '[req]\ndistinguished_name = dn\n[dn]\n')
      const result = spawnSync(
        openssl,
        [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-config', confPath,
          '-keyout', keyPath, '-out', certPath,
          '-days', '3650',
          '-subj', '/CN=dsh-remote-gateway',
          '-addext', `subjectAltName=${SUBJECT_ALT_NAMES}`
        ],
        { windowsHide: true, timeout: 30000, env: { ...process.env, OPENSSL_CONF: confPath } }
      )
      if (!result.error && existsSync(keyPath) && existsSync(certPath)) {
        return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
      }
      lastTlsError = `openssl status=${result.status} error=${result.error ? result.error.message : 'none'} stderr=${String(result.stderr || '').slice(-200)}`
    }

    // Fallback: Windows' own certificate generator, exported as a PFX bundle.
    const pfxPath = join(dir, 'gateway.pfx')
    if (!existsSync(pfxPath)) {
      const hostNames = ['localhost', 'frp-cat.com', 'dx.frp-cat.com', 'yd.frp-cat.com', 'lt.frp-cat.com']
        .map((name) => `'${name}'`)
        .join(',')
      const script = [
        `$cert = New-SelfSignedCertificate -Subject 'CN=dsh-remote-gateway' -DnsName ${hostNames} -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(10)`,
        `$pwd = ConvertTo-SecureString -String '${PFX_PASSWORD}' -AsPlainText -Force`,
        `Export-PfxCertificate -Cert $cert -FilePath '${pfxPath}' -Password $pwd | Out-Null`,
        `Remove-Item -Path ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint)`
      ].join('; ')
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 60000
      })
    }
    if (existsSync(pfxPath)) {
      return { pfx: readFileSync(pfxPath), passphrase: PFX_PASSWORD }
    }
    return null
  } catch {
    return null
  }
}
