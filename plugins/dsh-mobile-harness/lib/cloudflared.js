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
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'

/** The one official release asset; every mirror below serves a copy of it. */
const OFFICIAL_DOWNLOAD_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

/** GitHub proxies, in rough order of how often they answer from mainland China. A proxy is only a
 * prefix: https://<proxy>/<the full github url>. None of them is guaranteed, which is why this is a
 * list and why the panel can stop the download and retry. */
const MIRROR_PROXIES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://hk.gh-proxy.com/',
  'https://github.moeyy.xyz/',
  'https://gh.llkk.cc/'
]

/** Hosts that mirror github.com itself: same path, different domain. */
const MIRROR_HOSTS = [
  'https://kkgithub.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
]

export const QUICK_TUNNEL_DOWNLOAD_URLS = [
  OFFICIAL_DOWNLOAD_URL,
  ...MIRROR_PROXIES.map((proxy) => proxy + OFFICIAL_DOWNLOAD_URL),
  ...MIRROR_HOSTS
]

/** Download order for one run: an explicit DSH_CLOUDFLARED_URL wins (for a LAN mirror or an
 * accelerator the user already trusts), then the built-in list. */
export function downloadUrls(env = process.env) {
  const custom = String(env.DSH_CLOUDFLARED_URL || '').trim()
  const urls = custom ? [custom, ...QUICK_TUNNEL_DOWNLOAD_URLS] : QUICK_TUNNEL_DOWNLOAD_URLS.slice()
  return [...new Set(urls)]
}

const QUICK_HOST_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/
const MIN_BINARY_BYTES = 8 * 1024 * 1024
const START_TIMEOUT_MS = 35000
const MAX_RESTARTS = 8

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
      // http is only used by the tests' local stand-in server; production URLs are https.
      const fetchUrl = current.startsWith('http://') ? httpGet : httpsGet
      const request = fetchUrl(current, { headers: { 'user-agent': 'dsh-mobile-harness' } }, (response) => {
        const status = response.statusCode || 0
        if (status >= 300 && status < 400 && response.headers.location && hops < 5) {
          response.resume()
          const next = new URL(response.headers.location, current).toString()
          attempt(next, hops + 1)
          return
        }
        if (status !== 200) {
          response.resume()
          fail(new Error('HTTP ' + status + ' 下载失败'))
          return
        }
        const total = Number(response.headers['content-length'] || 0)
        let seen = 0
        let lastEmit = 0
        const sink = createWriteStream(target)
        const onAbort = () => {
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
          const now = Date.now()
          // Throttled so a 50 MB download does not rewrite the panel 1000 times a second.
          if (typeof onProgress === 'function' && now - lastEmit >= 250) {
            lastEmit = now
            onProgress({ received: seen, total })
          }
        })
        response.pipe(sink)
        sink.on('error', fail)
        sink.on('finish', () => {
          if (signal) signal.removeEventListener('abort', onAbort)
          if (typeof onProgress === 'function') onProgress({ received: seen, total })
          done(seen)
        })
      })
      request.on('error', (error) => fail(error))
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
  }

  binaryPath() {
    return join(this.stateDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  }

  /** A cloudflared already installed on the machine (PATH) is used as-is: no 50 MB download for
   * people who have it, and a way out when every mirror is blocked. */
  findOnPath() {
    if (this.systemBinary !== undefined) return this.systemBinary
    this.systemBinary = null
    const env = process.env
    const dirs = String(env.PATH || env.Path || '').split(process.platform === 'win32' ? ';' : ':')
    const names = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared']
    for (const raw of dirs) {
      const dir = raw.replace(/^"|"$/g, '').trim()
      if (!dir) continue
      for (const name of names) {
        const candidate = join(dir, name)
        try {
          const info = statSync(candidate)
          if (info.isFile() && info.size >= MIN_BINARY_BYTES) {
            this.systemBinary = candidate
            return candidate
          }
        } catch {
          /* keep looking */
        }
      }
    }
    return null
  }

  /** Which binary a tunnel would use: the plugin's copy first, then one on PATH. */
  resolveBinary() {
    const own = this.binaryPath()
    try {
      if (statSync(own).size >= MIN_BINARY_BYTES) return { exe: own, source: 'plugin' }
    } catch {
      /* not downloaded yet */
    }
    const system = this.findOnPath()
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
      try { if (existsSync(temp)) unlinkSync(temp) } catch { /* ignore */ }
    }
    try {
      mkdirSync(join(this.stateDir, 'bin'), { recursive: true })
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
          const bytes = await downloadToFile(url, temp, ({ received, total }) => markProgress(received, total), {
            signal: this.abortDownload ? this.abortDownload.signal : null
          })
          if (bytes < MIN_BINARY_BYTES) throw new Error('文件太小（' + bytes + ' 字节），镜像可能返回了错误页')
          if (this.cancelled) {
            dropTemp()
            return this.finishDownload()
          }
          try { if (existsSync(target)) unlinkSync(target) } catch { /* ignore */ }
          renameSync(temp, target)
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
          this.warn('cloudflared download failed from ' + url + ': ' + message)
        }
      }
      this.downloadSource = null
      this.downloadError = '这 ' + failures.length + ' 个地址都失败了。可以把 cloudflared.exe 手动放到 ' + target + '，或者设置 DSH_CLOUDFLARED_URL 指向你自己能连的镜像。'
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
    for (const file of [target, target + '.part']) {
      try {
        if (existsSync(file)) unlinkSync(file)
      } catch (error) {
        this.lastError = '删除失败：' + (error instanceof Error ? error.message : String(error))
        this.warn('cloudflared delete failed for ' + file + ': ' + this.lastError)
      }
    }
    this.systemBinary = undefined
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
      throw new Error('未安装 cloudflared：在面板点「下载 cloudflared」（约 50 MB），或把 cloudflared.exe 放到 PATH / ' + this.binaryPath())
    }
    await this.stop()
    this.port = port
    this.wanted = true
    this.restarts = 0
    return this.spawnOnce()
  }

  spawnOnce() {
    return new Promise((resolve, reject) => {
      const exe = this.resolveBinary().exe
      const args = ['tunnel', '--url', 'http://127.0.0.1:' + this.port, '--no-autoupdate']
      this.state = 'starting'
      this.url = null
      let settled = false
      let output = ''
      let child
      try {
        child = this.spawnImpl(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
          this.spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('exit', () => finish())
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