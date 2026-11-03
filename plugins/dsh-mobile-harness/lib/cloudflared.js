/**
 * cloudflared quick tunnel: the zero-config public entry.
 *
 * Why this exists: Tailscale needs an account on both phones, and SakuraFrp needs a hosted
 * tunnel plus a signed certificate. A Cloudflare quick tunnel needs neither — one binary, one
 * outbound connection, an https://<random>.trycloudflare.com address. The trade-off is that the
 * address is new on every restart and Cloudflare may rate-limit it, so it is an OPTION next to
 * the other two entries, never the default.
 *
 * Everything here is best-effort and self-healing: the binary is downloaded on demand into the
 * plugin state dir, the URL is scraped from cloudflared's own log line, and an unexpected exit
 * is retried with backoff (each retry publishes a new URL through onUrl).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { isAbsolute, join } from 'node:path'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'

export const CLOUDFLARED_VERSION = '2026.10.7'
const RELEASE_ROOT = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`

const MIRROR_PROXIES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://hk.gh-proxy.com/',
  'https://github.moeyy.xyz/',
  'https://gh.llkk.cc/'
]

const RELEASE_ASSETS = {
  win32: {
    x64: { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
    ia32: { file: 'cloudflared-windows-386.exe', sha256: '88c6b972b410db0e26745f593510d772c825a13c5a2374819e3f13a05b333082' }
  },
  darwin: {
    x64: { file: 'cloudflared-darwin-amd64.tgz', sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848', binarySha256: '5c55e77da7012cebca19170357e196176c48c9647cc2ead404702fa125ddbd86' },
    arm64: { file: 'cloudflared-darwin-arm64.tgz', sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd', binarySha256: '2136431d5eb467bf447d2ee514b713e192719b143aec1d9e09bf7dc290d5bb12' }
  },
  linux: {
    x64: { file: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
    ia32: { file: 'cloudflared-linux-386', sha256: '4823d2f038395617e04e4070601ab45c0c43f31f15ee7586be299e19ef49d46e' },
    arm64: { file: 'cloudflared-linux-arm64', sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775' },
    arm: { file: 'cloudflared-linux-arm', sha256: '74f690f6707182839b63e0465726c7776dd63f0a174390b911d5d71f35cab94e' }
  }
}

function releaseAsset(platform = process.platform, arch = process.arch) {
  const asset = RELEASE_ASSETS[platform]?.[arch]
  if (!asset) return null
  return {
    ...asset,
    binarySha256: asset.binarySha256 || asset.sha256,
    archive: asset.file.endsWith('.tgz')
  }
}

export function downloadUrls(env = process.env, platform = process.platform, arch = process.arch) {
  const asset = releaseAsset(platform, arch)
  if (!asset) return []
  const official = `${RELEASE_ROOT}/${asset.file}`
  const mirrors = MIRROR_PROXIES.map((proxy) => proxy + official)
  const mirrorHost = official.replace('https://github.com/', 'https://kkgithub.com/')
  const custom = String(env?.DSH_CLOUDFLARED_URL || '').trim()
  let customUrl = null
  if (custom) {
    try {
      const parsed = new URL(custom)
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) customUrl = parsed.toString()
    } catch {}
  }
  return [...new Set([...(customUrl ? [customUrl] : []), official, ...mirrors, mirrorHost])]
}

export const QUICK_TUNNEL_DOWNLOAD_URLS = downloadUrls(process.env)

const QUICK_HOST_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/
const MIN_BINARY_BYTES = 8 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
const MAX_BINARY_BYTES = 200 * 1024 * 1024
const START_TIMEOUT_MS = 35000
const MAX_RESTARTS = 8

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function childEnvironment(extra = {}) {
  const result = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']) {
    if (typeof process.env[key] === 'string') result[key] = process.env[key]
  }
  return { ...result, ...extra }
}

function validateVersion(exe) {
  const result = spawnSync(exe, ['--version'], {
    encoding: 'utf8',
    env: childEnvironment(),
    timeout: 8000,
    windowsHide: true
  })
  if (result.error || result.status !== 0) {
    throw new Error(`cloudflared --version 失败：${result.error ? result.error.message : `exit ${result.status}`}`)
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const found = output.match(/\bversion\s+(\d{4}\.\d+\.\d+)\b/)
  if (!found || found[1] !== CLOUDFLARED_VERSION) {
    throw new Error(`cloudflared 版本不匹配，需要 ${CLOUDFLARED_VERSION}`)
  }
}

function tarString(header, start, length) {
  const end = header.indexOf(0, start)
  return header.toString('utf8', start, end === -1 || end >= start + length ? start + length : end)
}

function extractMacBinary(archivePath, target) {
  const content = gunzipSync(readFileSync(archivePath), { maxOutputLength: MAX_BINARY_BYTES * 2 })
  let offset = 0
  while (offset + 512 <= content.length) {
    const header = content.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const sizeText = tarString(header, 124, 12).trim()
    const size = Number.parseInt(sizeText || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BINARY_BYTES) throw new Error('cloudflared 压缩包格式无效')
    const dataStart = offset + 512
    if (path === 'cloudflared' && (header[156] === 0 || header[156] === 48)) {
      if (size < MIN_BINARY_BYTES) throw new Error('cloudflared 文件太小')
      writeFileSync(target, content.subarray(dataStart, dataStart + size), { flag: 'wx', mode: 0o700 })
      try {
        chmodSync(target, 0o700)
      } catch (error) {
        if (process.platform !== 'win32') throw error
      }
      return size
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new Error('cloudflared 压缩包缺少可执行文件')
}

/** Host name of a download URL, for the "downloading from …" line in the panel. */
function hostOfUrl(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** Pull the public URL out of a chunk of cloudflared output; null when it is not there yet. */
export function parseQuickUrl(text) {
  if (typeof text !== 'string' || !text) return null
  const match = text.match(QUICK_HOST_PATTERN)
  if (!match) return null
  return match[0].endsWith('/') ? match[0] : match[0] + '/'
}

/** Stream one URL to a file, following redirects; resolves with the byte count.
 * Exported for the progress-bar test (and so the panel can be checked without real downloads). */
export function downloadToFile(url, target, onProgress, options = {}) {
  // options.signal lets the panel stop a download that is going nowhere (every mirror can hang).
  const signal = options.signal || null
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const done = (bytes) => {
      if (settled) return
      settled = true
      resolve(bytes)
    }
    const attempt = (current, hops) => {
      if (settled) return
      if (signal && signal.aborted) {
        fail(new Error('下载已取消'))
        return
      }
      let parsedCurrent
      try {
        parsedCurrent = new URL(current)
      } catch {
        fail(new Error('下载地址无效'))
        return
      }
      const localHttp = parsedCurrent.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedCurrent.hostname)
      if (parsedCurrent.protocol !== 'https:' && !localHttp) {
        fail(new Error('下载地址必须使用 HTTPS'))
        return
      }
      let intentionalDestroy = false
      const fetchUrl = localHttp ? httpGet : httpsGet
      const request = fetchUrl(current, { headers: { 'user-agent': 'dsh-mobile-harness' } }, (response) => {
        response.on('error', (error) => {
          if (!intentionalDestroy) fail(error)
        })
        const status = response.statusCode || 0
        if (status >= 300 && status < 400 && response.headers.location && hops < 5) {
          response.resume()
          let next
          let parsedNext
          try {
            next = new URL(response.headers.location, current).toString()
            parsedNext = new URL(next)
          } catch {
            fail(new Error('下载重定向地址无效'))
            return
          }
          const nextLocalHttp = parsedNext.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedNext.hostname)
          if (parsedNext.protocol !== 'https:' && !nextLocalHttp) {
            fail(new Error('下载重定向必须使用 HTTPS'))
            return
          }
          attempt(next, hops + 1)
          return
        }
        if (status !== 200) {
          response.resume()
          fail(new Error('HTTP ' + status + ' 下载失败'))
          return
        }
        const total = Number(response.headers['content-length'] || 0)
        if (total > MAX_DOWNLOAD_BYTES) {
          intentionalDestroy = true
          response.destroy()
          fail(new Error('下载文件过大'))
          return
        }
        let seen = 0
        let lastEmit = 0
        const sink = createWriteStream(target, { mode: 0o600 })
        sink.on('error', fail)
        const onAbort = () => {
          intentionalDestroy = true
          try { response.destroy() } catch { /* already gone */ }
          // Wait for the write stream to close before failing: on Windows an unlink of a file
          // that is still open just fails, and install() would leave a .part behind.
          try {
            if (!sink.closed && !sink.destroyed) {
              sink.once('close', () => fail(new Error('下载已取消')))
              sink.destroy()
              return
            }
          } catch { /* fall through */ }
          fail(new Error('下载已取消'))
        }
        if (signal) {
          if (signal.aborted) {
            onAbort()
            return
          }
          signal.addEventListener('abort', onAbort, { once: true })
          sink.on('close', () => signal.removeEventListener('abort', onAbort))
        }
        response.on('data', (chunk) => {
          seen += chunk.length
          if (seen > MAX_DOWNLOAD_BYTES) {
            intentionalDestroy = true
            response.unpipe(sink)
            response.destroy()
            const error = new Error('下载文件过大')
            sink.once('close', () => fail(error))
            sink.destroy()
            return
          }
          const now = Date.now()
          // Throttled so a 50 MB download does not rewrite the panel 1000 times a second.
          if (typeof onProgress === 'function' && now - lastEmit >= 250) {
            lastEmit = now
            onProgress({ received: seen, total })
          }
        })
        response.pipe(sink)
        sink.on('finish', () => {
          if (signal) signal.removeEventListener('abort', onAbort)
          if (typeof onProgress === 'function') onProgress({ received: seen, total })
          done(seen)
        })
      })
      request.on('error', (error) => {
        if (!intentionalDestroy) fail(error)
      })
      request.setTimeout(30000, () => request.destroy(new Error('下载超时')))
    }
    attempt(url, 0)
  })
}

export class CloudflaredTunnel {
  constructor(options = {}) {
    this.stateDir = options.stateDir
    this.log = options.log || (() => {})
    this.warn = options.warn || (() => {})
    this.onUrl = options.onUrl || (() => {})
    // Injectable child-process factory so the tests can run without the real binary.
    this.spawnImpl = options.spawn || spawn
    this.child = null
    this.url = null
    /** idle | starting | running | retrying | error */
    this.state = 'idle'
    this.lastError = null
    this.port = null
    this.restarts = 0
    this.wanted = false
    this.downloading = false
    this.downloadPercent = null
    this.downloadReceived = 0
    this.downloadTotal = 0
    this.downloadBps = 0
    this.downloadSource = null
    this.downloadError = null
    this.downloadStartedAt = null
    this.downloadBytes = 0
    this.restartTimer = null
    /** Set by cancelDownload(); install() returns quietly instead of reporting a failure. */
    this.cancelled = false
    this.abortDownload = null
    /** Host names tried during the current/last download, most recent last (panel shows them). */
    this.downloadTried = []
    /** Cached PATH lookup result; undefined means "not looked yet", null means "not there". */
    this.systemBinary = undefined
    this.binaryHashes = new Map()
  }

  binaryPath() {
    return join(this.stateDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  }

  binaryMatchesRelease(file, asset, force = false) {
    try {
      const info = statSync(file)
      if (!info.isFile() || info.size < MIN_BINARY_BYTES || info.size > MAX_BINARY_BYTES) return false
      const key = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
      const cached = this.binaryHashes.get(file)
      if (!force && cached?.key === key) return cached.digest === asset.binarySha256
      const digest = sha256File(file)
      this.binaryHashes.set(file, { key, digest })
      return digest === asset.binarySha256
    } catch {
      return false
    }
  }

  findOnPath(force = false) {
    const asset = releaseAsset()
    if (!asset) return null
    if (this.systemBinary !== undefined && !force) {
      if (this.systemBinary && this.binaryMatchesRelease(this.systemBinary, asset)) return this.systemBinary
      if (!this.systemBinary) return null
    }
    this.systemBinary = null
    const env = process.env
    const dirs = String(env.PATH || env.Path || '').split(process.platform === 'win32' ? ';' : ':')
    const names = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared']
    for (const raw of dirs) {
      const dir = raw.replace(/^"|"$/g, '').trim()
      if (!dir || !isAbsolute(dir)) continue
      for (const name of names) {
        const candidate = join(dir, name)
        if (this.binaryMatchesRelease(candidate, asset, force)) {
          this.systemBinary = candidate
          return candidate
        }
      }
    }
    return null
  }

  resolveBinary(force = false) {
    const asset = releaseAsset()
    if (!asset) return { exe: this.binaryPath(), source: null }
    const own = this.binaryPath()
    if (this.binaryMatchesRelease(own, asset, force)) return { exe: own, source: 'plugin' }
    const system = this.findOnPath(force)
    if (system) return { exe: system, source: 'system' }
    return { exe: own, source: null }
  }

  hasBinary() {
    return this.resolveBinary().source !== null
  }

  /** Public status for the panel snapshot; never contains a token (quick tunnels have none). */
  snapshot() {
    const downloading = this.downloading
    return {
      state: this.state,
      url: this.url,
      binary: this.hasBinary() ? 'ready' : downloading ? 'downloading' : 'missing',
      /** 'plugin' (our own copy), 'system' (found on PATH) or null. */
      binarySource: this.resolveBinary().source,
      /** True while a download can still be stopped from the panel. */
      canCancel: downloading,
      /** Host names this run tried, so a failed download names them instead of saying "failed". */
      downloadTried: downloading ? this.downloadTried.slice() : [],
      downloading,
      downloadPercent: downloading ? this.downloadPercent : this.downloadBytes ? 100 : null,
      downloadReceived: downloading ? this.downloadReceived : null,
      downloadTotal: downloading ? this.downloadTotal : null,
      downloadBps: downloading ? this.downloadBps : null,
      downloadSource: downloading ? this.downloadSource : null,
      downloadError: this.downloadError,
      downloadBytes: this.downloadBytes || null,
      lastError: this.lastError,
      restarts: this.restarts,
      pid: this.child && this.child.pid ? this.child.pid : null
    }
  }

  /** Close out a download run. A plain "return this.snapshot()" inside try{} snapshots before
   * finally{} clears the flag, so the panel would keep showing a progress bar forever. */
  finishDownload() {
    this.downloading = false
    this.abortDownload = null
    return this.snapshot()
  }

  /** Download the binary into <stateDir>/bin, trying every mirror until one answers. */
  async install() {
    if (this.downloading) return this.finishDownload()
    const asset = releaseAsset()
    if (!asset) throw new Error(`当前平台不支持 cloudflared ${CLOUDFLARED_VERSION} 自动下载`)
    this.downloading = true
    this.cancelled = false
    this.abortDownload = new AbortController()
    this.downloadPercent = 0
    this.downloadReceived = 0
    this.downloadTotal = 0
    this.downloadBps = 0
    this.downloadSource = null
    this.downloadError = null
    this.downloadStartedAt = Date.now()
    this.downloadTried = []
    this.lastError = null
    const target = this.binaryPath()
    const temp = target + '.part'
    const downloadTemp = asset.archive ? temp + '.tgz' : temp
    const markProgress = (received, total) => {
      const seconds = Math.max(0.5, (Date.now() - this.downloadStartedAt) / 1000)
      this.downloadReceived = received
      if (total > 0) this.downloadTotal = total
      this.downloadBps = Math.round(received / seconds)
      this.downloadPercent = this.downloadTotal > 0
        ? Math.min(99, Math.round((received / this.downloadTotal) * 100))
        : null
    }
    const dropTemp = () => {
      for (const file of new Set([temp, downloadTemp])) {
        try { if (existsSync(file)) unlinkSync(file) } catch {}
      }
    }
    try {
      const binDir = join(this.stateDir, 'bin')
      mkdirSync(binDir, { recursive: true, mode: 0o700 })
      try {
        chmodSync(binDir, 0o700)
      } catch (error) {
        if (process.platform !== 'win32') throw error
      }
      const urls = downloadUrls()
      const failures = []
      for (const url of urls) {
        // The panel's "停止" button sets this between attempts as well as during one.
        if (this.cancelled) return this.finishDownload()
        const host = hostOfUrl(url)
        try {
          dropTemp()
          this.downloadSource = host
          this.downloadTried.push(host)
          this.downloadStartedAt = Date.now()
          markProgress(0, 0)
          const bytes = await downloadToFile(url, downloadTemp, ({ received, total }) => markProgress(received, total), {
            signal: this.abortDownload ? this.abortDownload.signal : null
          })
          if (bytes < MIN_BINARY_BYTES || bytes > MAX_BINARY_BYTES) throw new Error('下载文件大小异常（' + bytes + ' 字节）')
          if (sha256File(downloadTemp) !== asset.sha256) throw new Error('SHA-256 校验失败')
          if (this.cancelled) {
            dropTemp()
            return this.finishDownload()
          }
          if (asset.archive) extractMacBinary(downloadTemp, temp)
          if (!this.binaryMatchesRelease(temp, asset, true)) throw new Error('cloudflared 二进制 SHA-256 校验失败')
          validateVersion(temp)
          if (this.cancelled) {
            dropTemp()
            return this.finishDownload()
          }
          try { if (existsSync(target)) unlinkSync(target) } catch {}
          renameSync(temp, target)
          try {
            chmodSync(target, 0o700)
          } catch (error) {
            if (process.platform !== 'win32') throw error
          }
          this.binaryHashes.clear()
          this.systemBinary = undefined
          this.downloadPercent = 100
          this.downloadBytes = bytes
          this.downloadBps = 0
          this.log('cloudflared downloaded from ' + host + ' (' + Math.round(bytes / 1048576) + ' MB)')
          return this.finishDownload()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (this.cancelled) {
            dropTemp()
            return this.finishDownload()
          }
          failures.push((host || '地址') + '：' + message)
          this.downloadError = '已试 ' + failures.length + ' 个地址都不行：' + failures.slice(-1)[0]
          this.downloadBps = 0
          dropTemp()
          this.warn('cloudflared download failed from ' + (host || 'address') + ': ' + message)
        }
      }
      this.downloadSource = null
      this.downloadError = `这 ${failures.length} 个地址都失败了。请检查网络，或从 Cloudflare 官方 Release 获取 ${CLOUDFLARED_VERSION} 对应平台文件并校验 SHA-256 后放到 ${target}。`
      this.lastError = '下载 cloudflared 失败：' + failures.slice(0, 3).join('；')
      throw new Error(this.lastError)
    } finally {
      this.downloading = false
      this.abortDownload = null
    }
  }

  /** Stop an in-flight download (the panel's 停止 button); partial bytes are removed. */
  cancelDownload() {
    if (!this.downloading) return this.snapshot()
    this.cancelled = true
    if (this.abortDownload) {
      try { this.abortDownload.abort() } catch { /* ignore */ }
    }
    this.downloadBps = 0
    this.downloadPercent = null
    this.downloadError = null
    this.warn('cloudflared download cancelled from the panel')
    return this.snapshot()
  }

  /**
   * Delete the downloaded binary (panel 删除 button). This is the way out of a corrupt or
   * half-written file: remove it, then download again. A cloudflared found on PATH is not
   * touched — removing that is the user's own file manager's job.
   */
  async removeBinary() {
    if (this.downloading) this.cancelDownload()
    try {
      await this.stop()
    } catch (error) {
      this.warn('cloudflared stop before delete failed: ' + (error instanceof Error ? error.message : String(error)))
    }
    const target = this.binaryPath()
    for (const file of [target, target + '.part', target + '.part.tgz']) {
      try {
        if (existsSync(file)) unlinkSync(file)
      } catch (error) {
        this.lastError = '删除失败：' + (error instanceof Error ? error.message : String(error))
        this.warn('cloudflared delete failed for ' + file + ': ' + this.lastError)
      }
    }
    this.systemBinary = undefined
    this.binaryHashes.clear()
    this.downloadBytes = 0
    this.downloadPercent = null
    this.downloadReceived = 0
    this.downloadTotal = 0
    this.downloadBps = 0
    this.downloadSource = null
    this.downloadError = null
    this.downloadTried = []
    this.state = 'idle'
    this.url = null
    if (!this.lastError) this.log('cloudflared binary deleted')
    return this.snapshot()
  }

  /** Start a quick tunnel to the local gateway port; resolves once the public URL is known. */
  async start(port) {
    if (!this.hasBinary()) {
      this.state = 'error'
      this.lastError = '未安装 cloudflared'
      throw new Error(`未找到经过校验的 cloudflared ${CLOUDFLARED_VERSION}：在面板点「下载 cloudflared」，或把该版本对应平台的文件放到 PATH / ${this.binaryPath()}`)
    }
    await this.stop()
    this.port = port
    this.wanted = true
    this.restarts = 0
    return this.spawnOnce()
  }

  spawnOnce() {
    let exe
    try {
      const binary = this.resolveBinary(true)
      if (!binary.source) throw new Error(`cloudflared SHA-256 校验失败；需要官方版本 ${CLOUDFLARED_VERSION}`)
      exe = binary.exe
      validateVersion(exe)
    } catch (error) {
      this.state = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      return Promise.reject(new Error(this.lastError))
    }
    return new Promise((resolve, reject) => {
      const args = ['tunnel', '--url', 'http://127.0.0.1:' + this.port, '--no-autoupdate']
      this.state = 'starting'
      this.url = null
      let settled = false
      let output = ''
      let child
      try {
        child = this.spawnImpl(exe, args, {
          cwd: this.stateDir,
          env: childEnvironment(),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        this.state = 'error'
        this.lastError = error instanceof Error ? error.message : String(error)
        reject(new Error(this.lastError))
        return
      }
      this.child = child
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.state = 'error'
        this.lastError = 'cloudflared 在 ' + Math.round(START_TIMEOUT_MS / 1000) + ' 秒内没有给出公网地址'
        reject(new Error(this.lastError))
        this.stop().catch(() => {})
      }, START_TIMEOUT_MS)
      const consume = (chunk) => {
        output = (output + String(chunk)).slice(-40000)
        const found = parseQuickUrl(output)
        if (!found || settled) return
        settled = true
        clearTimeout(timer)
        this.url = found
        this.state = 'running'
        this.lastError = null
        this.log('quick tunnel up: ' + found)
        try { this.onUrl(found) } catch { /* UI callback must not break the tunnel */ }
        resolve({ url: found })
      }
      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)
      child.on('error', (error) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.state = 'error'
        reject(new Error(this.lastError))
      })
      child.on('exit', (code) => {
        if (this.child === child) this.child = null
        if (!settled) {
          settled = true
          clearTimeout(timer)
          const tail = output.trim().split(/\r?\n/).slice(-3).join(' / ')
          this.state = 'error'
          this.lastError = 'cloudflared 退出（code ' + code + '）' + (tail ? '：' + tail : '')
          reject(new Error(this.lastError))
          return
        }
        this.log('cloudflared exited (code ' + code + ')')
        if (this.wanted) this.scheduleRestart()
      })
    })
  }

  scheduleRestart() {
    if (!this.wanted) return
    if (this.restarts >= MAX_RESTARTS) {
      this.state = 'error'
      this.lastError = 'cloudflared 反复退出（已重试 ' + this.restarts + ' 次），请检查网络后手动重连'
      this.warn(this.lastError)
      return
    }
    this.restarts += 1
    this.state = 'retrying'
    const delay = Math.min(30000, 2000 * Math.pow(2, this.restarts - 1)) + Math.floor(Math.random() * 800)
    this.log('cloudflared restart in ' + delay + ' ms (attempt ' + this.restarts + ')')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.wanted) return
      this.spawnOnce().catch((error) => {
        this.warn('cloudflared restart failed: ' + (error instanceof Error ? error.message : String(error)))
        this.scheduleRestart()
      })
    }, delay)
  }

  /** Manual reconnect from the panel: stop, reset the backoff counter, start again. */
  async restart() {
    if (!this.port) throw new Error('隧道尚未启用')
    const port = this.port
    await this.stop()
    return this.start(port)
  }

  /** Stop the tunnel and any child processes it spawned (cloudflared spawns none, but be safe). */
  async stop() {
    this.wanted = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    this.url = null
    if (!child) {
      if (this.state !== 'error') this.state = 'idle'
      return
    }
    const pid = child.pid
    await new Promise((resolve) => {
      let done = false
      const finish = () => { if (done) return; done = true; resolve() }
      const timer = setTimeout(finish, 4000)
      child.once('exit', () => { clearTimeout(timer); finish() })
      try {
        if (process.platform === 'win32' && pid) {
          const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
          const taskkill = join(isAbsolute(systemRoot) ? systemRoot : 'C:\\Windows', 'System32', 'taskkill.exe')
          this.spawnImpl(taskkill, ['/pid', String(pid), '/T', '/F'], {
            env: childEnvironment(),
            windowsHide: true,
            stdio: 'ignore'
          }).on('exit', () => finish())
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        finish()
      }
    })
    if (this.state !== 'error') this.state = 'idle'
  }
}
