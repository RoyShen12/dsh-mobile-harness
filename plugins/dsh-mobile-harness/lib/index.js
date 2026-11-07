/**
 * Host half of the in-app remote-access switch.
 *
 * Registers three owner-only routes on the authenticated Connection carrier and owns the
 * `RemoteService` lifecycle:
 *
 *   GET  /api/dsh-mobile-harness.status    -> snapshot (phase, URL, password, QR matrix, clients…)
 *   GET  /api/dsh-mobile-harness.pending   -> lightweight approval state (+ ETag/304, ?wait long poll)
 *   POST /api/dsh-mobile-harness.toggle    -> { enabled: boolean }
 *   POST /api/dsh-mobile-harness.password  -> { password?: string } (rotate)
 */
import { RemoteService, PLUGIN_VERSION, PENDING_WAIT_MAX_MS, etagFor, ifNoneMatch, pendingResponse } from './service.js'
import { createPhoneTool } from './phone-tool.js'
import { contentDisposition } from './files.js'
import { Readable } from 'node:stream'

export const name = 'dsh-mobile-harness'
export const inject = ['webServer', 'connection', 'tools']

export const STATUS_PATH = '/api/dsh-mobile-harness.status'
export const PENDING_PATH = '/api/dsh-mobile-harness.pending'
export const TOGGLE_PATH = '/api/dsh-mobile-harness.toggle'
export const PASSWORD_PATH = '/api/dsh-mobile-harness.password'
export const EXTERNAL_PATH = '/api/dsh-mobile-harness.external'
export const RESET_PATH = '/api/dsh-mobile-harness.reset'
export const DEVICES_PATH = '/api/dsh-mobile-harness.devices'
export const CLOUDFLARED_PATH = '/api/dsh-mobile-harness.cloudflared'
export const SELFCHECK_PATH = '/api/dsh-mobile-harness.selfcheck'
export const LAN_PATH = '/api/dsh-mobile-harness.lan'
export const UI_PATH = '/api/dsh-mobile-harness.ui'
export const UPDATE_PATH = '/api/dsh-mobile-harness.update'
export const FILES_PATH = '/api/dsh-mobile-harness.files'
export const FILE_UPLOAD_PATH = '/api/dsh-mobile-harness.upload'
export const FILE_DOWNLOAD_PATH = '/api/dsh-mobile-harness.file'
export const FILE_DELETE_PATH = '/api/dsh-mobile-harness.delete'
export const FILE_POOL_PATH = '/api/dsh-mobile-harness.pool'
export const FILE_POOL_PICK_PATH = '/api/dsh-mobile-harness.poolpick'

/**
 * Which device this request came from, used to tell two phones apart when each wants a different
 * layout. The gateway stamps `x-dsh-device-id`: it replaces the browser's cookies with the owner
 * cookie upstream, so the real device cookie cannot travel. The cookie stays as a fallback for a
 * direct call. The owner's window on 47291 has neither.
 * @returns {string|null}
 */
function readDeviceCookie(request) {
  const stamped = request.headers.get('x-dsh-device-id')
  if (typeof stamped === 'string' && stamped.length >= 6) return stamped
  const raw = request.headers.get('cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() !== 'dsh-device') continue
    const value = part.slice(at + 1).trim()
    return value.length >= 6 ? value : null
  }
  return null
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  })
}

/**
 * JSON answer with an ETag. `no-cache` keeps the client revalidating: the browser may store the
 * body, but every use has to ask, which is exactly the conditional request we want.
 */
function jsonWithEtag(value, request) {
  const text = JSON.stringify(value)
  const etag = etagFor(text)
  if (ifNoneMatch(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { 'cache-control': 'no-cache', etag } })
  }
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      etag
    }
  })
}

function idleSnapshot(message) {
  return {
    pluginVersion: PLUGIN_VERSION,
    phase: 'error',
    enabled: false,
    busy: null,
    tunnel: 'tailscale',
    publicUrl: null,
    lastPublicUrl: null,
    passwordEnabled: true,
    qrText: null,
    qr: null,
    proxyPort: null,
    tlsPort: null,
    externalUrl: null,
    clients: 0,
    since: null,
    lastError: message,
    webPort: null,
    tailscale: { dnsName: null, backendState: 'Unknown', available: false },
    cloudflare: { state: 'idle', url: null, binary: 'missing', downloadPercent: null, lastError: null, restarts: 0, pid: null }
  }
}

export function apply(ctx) {
  /** @type {RemoteService | null} */
  let service = null

  const register = (route) => ctx.connection.fetch.register({
    ...route,
    fetch: async (request) => {
      // The gateway marks every forwarded request. The status route is the one management route a
      // remote phone must read: it carries view=client so the panel hides host-only controls, and
      // it is redacted below. Everything else here is state-changing and stays host-only; the
      // gateway's HOST_ONLY_API list refuses the same POSTs a second time.
      if (request.headers.get('x-dsh-mobile-remote') && route.path !== STATUS_PATH && route.path !== PENDING_PATH) {
        return json({ error: 'local-management-only' }, 403)
      }
      return route.fetch(request)
    }
  })

  ctx.effect(() => {
    const created = new RemoteService(ctx)
    service = created
    created.init().catch((error) => {
      created.warn(`remote access init failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      const current = created
      service = null
      current.dispose().catch(() => {})
    }
  }, 'dsh-mobile-harness: lifecycle')

  // The phone tool shares the service's DeviceBridge, so the owner's switch, the device token and
  // the command queue are all enforced in one place.
  ctx.effect(
    () => ctx.tools.register(createPhoneTool(() => (service ? service.bridge : null))),
    'dsh-mobile-harness: phone tool'
  )

  ctx.effect(
    () =>
      register({
        path: STATUS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'))
          const snapshot = service.snapshot()
          // The gateway marks every forwarded request; the owner's own window never goes through it.
          const clientView = request.headers.get('x-dsh-panel-view') === 'client'
          snapshot.view = clientView ? 'client' : 'host'
          if (clientView) {
            // A phone may read the state it renders, but the one-time QR ticket and the pairing
            // codes only ever exist on the owner's machine: a page that cannot show them must not
            // receive them either.
            snapshot.qrText = null
            snapshot.qr = null
            snapshot.qrTicketExpiresAt = null
            snapshot.pending = (snapshot.pending || []).map((entry) => ({ ...entry, pairCode: '' }))
            // Local paths and the owner's diagnostic text stay on this machine as well.
            snapshot.filePoolDir = null
            snapshot.lastError = null
          }
          // Which device is asking, and the layout it picked for itself (null = default).
          snapshot.deviceId = readDeviceCookie(request)
          snapshot.deviceUiMode = service.deviceUiMode(snapshot.deviceId)
          return jsonWithEtag(snapshot, request)
        }
      }),
    'dsh-mobile-harness: status route'
  )

  // Lightweight approval feed: the overlay polls this instead of the full status snapshot. It is
  // readable through the gateway on purpose (a phone renders the same overlay) but redacted;
  // `?wait=ms` is the optional long poll.
  ctx.effect(
    () =>
      register({
        path: PENDING_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          const url = new URL(request.url, 'http://dsh.invalid')
          const asked = Number.parseInt(url.searchParams.get('wait') ?? '', 10)
          const waitMs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, PENDING_WAIT_MAX_MS) : 0
          return pendingResponse(service, request, waitMs)
        }
      }),
    'dsh-mobile-harness: pending route'
  )

  ctx.effect(
    () =>
      register({
        path: TOGGLE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body
          try {
            body = await request.json()
          } catch {
            return json({ error: 'bad-request' }, 400)
          }
          if (typeof body?.enabled !== 'boolean' && typeof body?.tunnel !== 'string') {
            return json({ error: 'bad-request' }, 400)
          }
          try {
            if (typeof body?.tunnel === 'string' && ['tailscale', 'external', 'quick', 'lan', 'none'].includes(body.tunnel)) {
              const switched = await service.setTunnel(body.tunnel)
              if (body.enabled === true && !switched.enabled) return json(await service.setEnabled(true))
              if (body.enabled === false && switched.enabled) return json(await service.setEnabled(false))
              return json(switched)
            }
            return json(await service.setEnabled(body.enabled))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: toggle route'
  )

  ctx.effect(
    () =>
      register({
        path: EXTERNAL_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            if (typeof body?.url === 'string') return json(service.setExternalUrl(body.url))
            const detected = service.detectSakuraFrp()
            if (!detected) return json({ error: '未检测到 SakuraFrp 隧道日志，请手动填写外网地址' }, 404)
            return json({ ...service.setExternalUrl(detected.url), detected })
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: external route'
  )

  // Cloudflare quick tunnel: one POST for the two side actions the panel needs — download the
  // binary (~50 MB) and force a reconnect when the host stops responding.
  ctx.effect(
    () =>
      register({
        path: CLOUDFLARED_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            if (body?.action === 'install') return json(await service.installCloudflared())
            if (body?.action === 'cancel') return json(await service.cancelCloudflared())
            if (body?.action === 'delete') return json(await service.removeCloudflared())
            if (body?.action === 'restart') return json(await service.restartCloudflared())
            return json({ error: '未知操作' }, 400)
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: cloudflared route'
  )

  // Pin the lan entry to one adapter address (null clears it). The gateway already listens on
  // 0.0.0.0 in this mode, so this only changes the advertised URL and the QR — no rebind, no
  // reconnect, so the phone can be re-scanned immediately.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LAN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            return json(service.setLanAddress(typeof body?.address === 'string' ? body.address : null))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: lan address route'
  )

  // Pick the viewport phones/tablets get. Takes effect on the next page load; 'auto' sniffs the UA.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: UI_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          // A remote phone may only change its own layout; the owner's window may set the
          // default or target one device by id. Two phones can therefore use different modes.
          const clientView = request.headers.get('x-dsh-panel-view') === 'client'
          const asked = typeof body?.deviceId === 'string' && body.deviceId.length > 0 ? body.deviceId : null
          const deviceId = clientView ? readDeviceCookie(request) : asked
          if (clientView && !deviceId) {
            return json({ error: '这台设备还没被识别，刷新页面再试一次。' }, 400)
          }
          try {
            return json(service.setUiMode(String(body?.mode ?? ''), deviceId))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: ui mode route'
  )

  // Newest published version, for the tab bar badge. POST because it may ask npm; the answer is
  // cached for six hours server-side, so a panel refresh does not cost a registry round trip.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: UPDATE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json({ error: '远程服务尚未初始化' }, 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          return json(await service.checkUpdate(body?.force === true))
        }
      }),
    'dsh-mobile-harness: update route'
  )

  // ── file pool: the phone and this computer share one folder ───────────────
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILES_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json({ error: '远程服务尚未初始化' }, 503)
          try {
            const listing = await service.listFiles()
            // A phone may transfer files, not learn where the pool lives on this disk.
            if (request.headers.get('x-dsh-panel-view') === 'client') delete listing.dir
            return json(listing)
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 500)
          }
        }
      }),
    'dsh-mobile-harness: file list route'
  )

  // Raw body upload: the client posts the File itself, so no multipart parser is needed.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_UPLOAD_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json({ error: '远程服务尚未初始化' }, 503)
          const url = new URL(request.url, 'http://dsh.invalid')
          let bytes
          try {
            bytes = Buffer.from(await request.arrayBuffer())
          } catch (error) {
            return json({ error: '读取上传内容失败：' + (error instanceof Error ? error.message : String(error)) }, 400)
          }
          try {
            return json(await service.saveFile(url.searchParams.get('name') ?? 'upload.bin', bytes))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return json({ error: message }, /太大/.test(message) ? 413 : 400)
          }
        }
      }),
    'dsh-mobile-harness: file upload route'
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_DOWNLOAD_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return new Response('service not ready', { status: 503 })
          const url = new URL(request.url, 'http://dsh.invalid')
          const file = await service.openFileById(url.searchParams.get('id') ?? '')
          if (!file) return new Response('not found', { status: 404 })
          return new Response(Readable.toWeb(file.stream()), {
            status: 200,
            headers: {
              'content-type': file.mime,
              'content-length': String(file.size),
              'content-disposition': contentDisposition(file.name),
              'cache-control': 'no-store'
            }
          })
        }
      }),
    'dsh-mobile-harness: file download route'
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_DELETE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json({ error: '远程服务尚未初始化' }, 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            return json(await service.deleteFileById(String(body?.id ?? '')))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: file delete route'
  )

  // Let the owner move the pool to another drive / a synced folder.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_POOL_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json({ error: '远程服务尚未初始化' }, 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            const result = await service.setFilePoolDir(String(body?.dir ?? ''))
            return json(result, result.ok ? 200 : 400)
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: file pool dir route'
  )

  // Native folder picker so the owner never has to type a path.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_POOL_PICK_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          if (!service) return json({ error: '远程服务尚未初始化' }, 503)
          try {
            const result = await service.pickFilePoolDir()
            return json(result, result.ok ? 200 : 200)
          } catch (error) {
            return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
          }
        }
      }),
    'dsh-mobile-harness: file pool picker route'
  )

  // One-click self-check: walks every hop a phone request crosses (switch, gateway, DSH upstream,
  // tunnel, public URL, admission) and returns a green/amber/red list, so a “can't connect” report
  // becomes a named culprit instead of guesswork.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SELFCHECK_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          try {
            return json(await service.selfCheck())
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: self-check route'
  )

  ctx.effect(
    () =>
      register({
        path: DEVICES_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            return json(service.handleDevices(body))
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: devices route'
  )

  ctx.effect(
    () =>
      register({
        path: RESET_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          try {
            return json(service.resetDevices())
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: reset route'
  )

  ctx.effect(
    () =>
      register({
        path: PASSWORD_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'), 503)
          let body = {}
          try {
            body = await request.json()
          } catch {
            body = {}
          }
          try {
            if (body?.action === 'reveal') return json({ password: service.state.password })
            if (typeof body?.enabled === 'boolean') return json(service.setPasswordEnabled(body.enabled))
            const password = typeof body?.password === 'string' ? body.password : undefined
            const result = await service.rotatePassword(password)
            return json(result)
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: password route'
  )
}
