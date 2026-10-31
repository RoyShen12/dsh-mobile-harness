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

/** Official release first, then a mirror that is reachable from mainland China. */
export const QUICK_TUNNEL_DOWNLOAD_URLS = [
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  'https://ghfast.top/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
]

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
export function downloadToFile(url, target, onProgress) {
  return new Promise((resolve, reject) => {
    const attempt = (current, hops) => {
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
          reject(new Error('HTTP ' + status + ' 下载失败'))
          return
        }
        const total = Number(response.headers['content-length'] || 0)
        let seen = 0
        let lastEmit = 0
        const sink = createWriteStream(target)
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
        sink.on('error', reject)
        sink.on('finish', () => {
          if (typeof onProgress === 'function') onProgress({ received: seen, total })
          resolve(seen)
        })
      })
      request.on('error', reject)
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
  }

  binaryPath() {
    return join(this.stateDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  }

  hasBinary() {
    try {
      const info = statSync(this.binaryPath())
      return info.size >= MIN_BINARY_BYTES
    } catch {
      return false
    }
  }

  /** Public status for the panel snapshot; never contains a token (quick tunnels have none). */
  snapshot() {
    const downloading = this.downloading
    return {
      state: this.state,
      url: this.url,
      binary: this.hasBinary() ? 'ready' : downloading ? 'downloading' : 'missing',
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

  /** Download the binary into <stateDir>/bin (official URL, then a mirror). */
  async install() {
    if (this.downloading) return this.snapshot()
    this.downloading = true
    this.downloadPercent = 0
    this.downloadReceived = 0
    this.downloadTotal = 0
    this.downloadBps = 0
    this.downloadSource = null
    this.downloadError = null
    this.downloadStartedAt = Date.now()
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
    try {
      mkdirSync(join(this.stateDir, 'bin'), { recursive: true })
      let lastError = null
      for (const url of QUICK_TUNNEL_DOWNLOAD_URLS) {
        try {
          try { if (existsSync(temp)) unlinkSync(temp) } catch { /* ignore */ }
          this.downloadSource = hostOfUrl(url)
          this.downloadStartedAt = Date.now()
          markProgress(0, 0)
          const bytes = await downloadToFile(url, temp, ({ received, total }) => markProgress(received, total))
          if (bytes < MIN_BINARY_BYTES) throw new Error('文件太小（' + bytes + ' 字节），镜像可能返回了错误页')
          try { if (existsSync(target)) unlinkSync(target) } catch { /* ignore */ }
          renameSync(temp, target)
          this.downloadPercent = 100
          this.downloadBytes = bytes
          this.downloadBps = 0
          this.log('cloudflared downloaded (' + Math.round(bytes / 1048576) + ' MB)')
          return this.snapshot()
        } catch (error) {
          lastError = error
          this.downloadError = error instanceof Error ? error.message : String(error)
          this.downloadBps = 0
          try { if (existsSync(temp)) unlinkSync(temp) } catch { /* ignore */ }
          this.warn('cloudflared download failed from ' + url + ': ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      this.lastError = lastError instanceof Error ? lastError.message : '下载 cloudflared 失败'
      throw new Error(this.lastError)
    } finally {
      this.downloading = false
    }
  }

  /** Start a quick tunnel to the local gateway port; resolves once the public URL is known. */
  async start(port) {
    if (!this.hasBinary()) {
      this.state = 'error'
      this.lastError = '未安装 cloudflared'
      throw new Error('未安装 cloudflared：请先在面板点「下载 cloudflared」（约 50 MB）')
    }
    await this.stop()
    this.port = port
    this.wanted = true
    this.restarts = 0
    return this.spawnOnce()
  }

  spawnOnce() {
    return new Promise((resolve, reject) => {
      const exe = this.binaryPath()
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
