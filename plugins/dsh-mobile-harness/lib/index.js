/**
 * Host half of the in-app remote-access switch.
 *
 * Registers three owner-only routes on the authenticated Connection carrier and owns the
 * `RemoteService` lifecycle:
 *
 *   GET  /api/dsh-mobile-harness.status    -> snapshot (phase, URL, password, QR matrix, clients…)
 *   POST /api/dsh-mobile-harness.toggle    -> { enabled: boolean }
 *   POST /api/dsh-mobile-harness.password  -> { password?: string } (rotate)
 */
import { RemoteService, PLUGIN_VERSION } from './service.js'
import { createPhoneTool } from './phone-tool.js'

export const name = 'dsh-mobile-harness'
export const inject = ['webServer', 'connection', 'tools']

export const STATUS_PATH = '/api/dsh-mobile-harness.status'
export const TOGGLE_PATH = '/api/dsh-mobile-harness.toggle'
export const PASSWORD_PATH = '/api/dsh-mobile-harness.password'
export const EXTERNAL_PATH = '/api/dsh-mobile-harness.external'
export const RESET_PATH = '/api/dsh-mobile-harness.reset'
export const DEVICES_PATH = '/api/dsh-mobile-harness.devices'
export const CLOUDFLARED_PATH = '/api/dsh-mobile-harness.cloudflared'

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
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
    password: '',
    passwordEnabled: false,
    qrText: null,
    qr: null,
    proxyPort: null,
    tlsPort: null,
    externalUrl: null,
    clients: 0,
    since: null,
    lastError: message,
    stateDir: null,
    webPort: null,
    tailscale: { dnsName: null, backendState: 'Unknown', available: false },
    cloudflare: { state: 'idle', url: null, binary: 'missing', downloadPercent: null, lastError: null, restarts: 0, pid: null }
  }
}

export function apply(ctx) {
  /** @type {RemoteService | null} */
  let service = null

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
      ctx.connection.fetch.register({
        path: STATUS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => {
          if (!service) return json(idleSnapshot('远程服务尚未初始化'))
          return json(service.snapshot())
        }
      }),
    'dsh-mobile-harness: status route'
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
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
            if (typeof body?.tunnel === 'string' && ['tailscale', 'external', 'quick', 'none'].includes(body.tunnel)) {
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
      ctx.connection.fetch.register({
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
      ctx.connection.fetch.register({
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
            if (body?.action === 'restart') return json(await service.restartCloudflared())
            return json({ error: '未知操作' }, 400)
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
      }),
    'dsh-mobile-harness: cloudflared route'
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
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
      ctx.connection.fetch.register({
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
      ctx.connection.fetch.register({
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
          if (typeof body?.enabled === 'boolean') return json(service.setPasswordEnabled(body.enabled))
          const password = typeof body?.password === 'string' ? body.password : undefined
          const result = await service.rotatePassword(password)
          return json(result)
        }
      }),
    'dsh-mobile-harness: password route'
  )
}
