/**
 * Self-signed TLS material for the loopback gateway.
 *
 * The generated certificate is self-signed. Client-facing endpoints must use a certificate
 * trusted by the platform; certificate warnings must be treated as connection failures.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const OPENSSL_CANDIDATES = [
  '/usr/bin/openssl',
  '/usr/local/bin/openssl',
  '/opt/homebrew/bin/openssl',
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

/** Last failure reason, surfaced for diagnostics. */
export let lastTlsError = null

function toolEnvironment(extra = {}) {
  const result = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']) {
    if (typeof process.env[key] === 'string') result[key] = process.env[key]
  }
  return { ...result, ...extra }
}

function absolutePathCandidates() {
  const executable = process.platform === 'win32' ? 'openssl.exe' : 'openssl'
  const dirs = String(process.env.PATH || process.env.Path || '').split(delimiter)
  const fromPath = dirs
    .map((dir) => dir.replace(/^"|"$/g, '').trim())
    .filter((dir) => dir && isAbsolute(dir) && resolve(dir) !== resolve(process.cwd()))
    .map((dir) => join(dir, executable))
  return [...new Set([...OPENSSL_CANDIDATES, ...fromPath].filter((candidate) => isAbsolute(candidate)))]
}

/** @returns {string|null} usable openssl executable */
function findOpenssl() {
  for (const candidate of absolutePathCandidates()) {
    try {
      if (!existsSync(candidate)) continue
      const result = spawnSync(candidate, ['version'], { windowsHide: true, timeout: 5000 })
      if (!result.error && result.status === 0) return candidate
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

function powershellPath() {
  if (process.platform !== 'win32') return null
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const candidate = join(isAbsolute(root) ? root : 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : null
}

function removeFile(file) {
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch {}
}

function secureFile(file) {
  try {
    chmodSync(file, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

function secureDirectory(dir) {
  try {
    chmodSync(dir, 0o700)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * @param {string} stateDir directory that persists across restarts
 * @returns {{key?: Buffer, cert?: Buffer, pfx?: Buffer, passphrase?: string}|null}
 */
export function ensureTlsMaterials(stateDir) {
  lastTlsError = null
  try {
    const dir = join(stateDir, 'tls')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    secureDirectory(dir)
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    if (existsSync(keyPath) && existsSync(certPath)) {
      secureFile(keyPath)
      secureFile(certPath)
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
    }

    const openssl = findOpenssl()
    if (openssl) {
      const confPath = join(dir, 'openssl.cnf')
      if (!existsSync(confPath)) writeFileSync(confPath, '[req]\ndistinguished_name = dn\n[dn]\n', { mode: 0o600 })
      secureFile(confPath)
      const keyTemp = keyPath + '.part'
      const certTemp = certPath + '.part'
      removeFile(keyTemp)
      removeFile(certTemp)
      const result = spawnSync(
        openssl,
        [
          'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
          '-config', confPath,
          '-keyout', keyTemp, '-out', certTemp,
          '-days', '3650',
          '-subj', '/CN=dsh-remote-gateway',
          '-addext', `subjectAltName=${SUBJECT_ALT_NAMES}`
        ],
        { windowsHide: true, timeout: 30000, env: toolEnvironment({ OPENSSL_CONF: confPath }) }
      )
      if (!result.error && result.status === 0 && existsSync(keyTemp) && existsSync(certTemp)) {
        secureFile(keyTemp)
        secureFile(certTemp)
        removeFile(keyPath)
        removeFile(certPath)
        renameSync(keyTemp, keyPath)
        renameSync(certTemp, certPath)
        secureFile(keyPath)
        secureFile(certPath)
        return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
      }
      lastTlsError = `openssl status=${result.status} error=${result.error ? result.error.message : 'none'} stderr=${String(result.stderr || '').slice(-200)}`
      removeFile(keyTemp)
      removeFile(certTemp)
    }

    const pfxPath = join(dir, 'gateway.pfx')
    const passphrasePath = join(dir, 'gateway.pfx-password')
    const scriptPath = join(dir, 'create-gateway-certificate.ps1')
    let passphrase = null
    if (existsSync(pfxPath)) {
      try {
        passphrase = readFileSync(passphrasePath, 'utf8').trim()
      } catch {}
    }
    if (!existsSync(pfxPath) || !passphrase) {
      removeFile(pfxPath)
      removeFile(passphrasePath)
      const powershell = powershellPath()
      if (!powershell) {
        lastTlsError = '未找到系统 PowerShell 或 OpenSSL'
        return null
      }
      passphrase = randomBytes(32).toString('base64url')
      writeFileSync(passphrasePath, passphrase, { mode: 0o600 })
      secureFile(passphrasePath)
      const hostNames = ['localhost', 'frp-cat.com', 'dx.frp-cat.com', 'yd.frp-cat.com', 'lt.frp-cat.com']
        .map(powerShellLiteral)
        .join(',')
      const script = [
        `$cert = New-SelfSignedCertificate -Subject ${powerShellLiteral('CN=dsh-remote-gateway')} -DnsName @(${hostNames}) -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(10)`,
        `$pwd = ConvertTo-SecureString -String ${powerShellLiteral(passphrase)} -AsPlainText -Force`,
        `Export-PfxCertificate -Cert $cert -FilePath ${powerShellLiteral(pfxPath)} -Password $pwd | Out-Null`,
        `Remove-Item -Path ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint)`
      ].join('; ')
      writeFileSync(scriptPath, script, { mode: 0o600 })
      secureFile(scriptPath)
      let result
      try {
        result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
          windowsHide: true,
          timeout: 60000,
          env: toolEnvironment()
        })
      } finally {
        removeFile(scriptPath)
      }
      if (result.error || result.status !== 0) {
        lastTlsError = `PowerShell status=${result.status} error=${result.error ? result.error.message : 'none'} stderr=${String(result.stderr || '').slice(-200)}`
        removeFile(pfxPath)
        removeFile(passphrasePath)
        return null
      }
    }
    if (existsSync(pfxPath) && passphrase) {
      secureFile(pfxPath)
      secureFile(passphrasePath)
      return { pfx: readFileSync(pfxPath), passphrase }
    }
    return null
  } catch (error) {
    lastTlsError = error instanceof Error ? error.message : String(error)
    return null
  }
}
