#!/usr/bin/env node
/**
 * Tests for the gateway's HTTP compression, cache policy and read-response cache.
 * Run: node --test tools/test-compression.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import {
  MIN_COMPRESS_BYTES,
  compressBuffer,
  compressionHeaders,
  isCompressibleType,
  mergeVary,
  negotiateEncoding,
  shouldCompressResponse,
  weakenEtag
} from '../lib/compress.js'
import { servePwa } from '../lib/pwa.js'
import { GatewayProxy } from '../lib/proxy.js'

const IMMUTABLE = 'public, max-age=31536000, immutable'

test('Accept-Encoding negotiation honours q values and prefers br on ties', () => {
  const cases = [
    [undefined, null],
    ['', null],
    ['   ', null],
    ['identity', null],
    ['gzip;q=0.5, br;q=0', 'gzip'],
    ['*;q=0.5', 'gzip'],
    ['br, gzip', 'br'],
    ['gzip', 'gzip'],
    ['GZIP;Q=0.8', 'gzip'],
    ['br;q=0.5, gzip;q=0.9', 'gzip'],
    ['br;q=0.5, gzip;q=0.5', 'br'],
    ['br;q=0, gzip;q=0', null],
    ['deflate, zstd', null],
    ['br;q=0, *;q=0.2', 'gzip'],
    ['gzip;q=0, *;q=0', null]
  ]
  for (const [header, expected] of cases) {
    assert.equal(negotiateEncoding(header), expected, `Accept-Encoding: ${header}`)
  }
})

test('MIME filter compresses text and SVG but not streams, images, fonts, media or archives', () => {
  const compressible = [
    'text/html',
    'text/html; charset=utf-8',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/json; charset=utf-8',
    'application/manifest+json',
    'application/xml',
    'application/atom+xml',
    'image/svg+xml'
  ]
  const skipped = [
    'text/event-stream',
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'video/mp4',
    'font/woff2',
    'application/font-woff',
    'application/zip',
    'application/gzip',
    'application/x-brotli',
    'application/pdf',
    'application/octet-stream',
    ''
  ]
  for (const type of compressible) assert.equal(isCompressibleType(type), true, type)
  for (const type of skipped) assert.equal(isCompressibleType(type), false, type)
})

test('shouldCompressResponse skips HEAD, non-200, ranges, no-transform and tiny bodies', () => {
  const base = { method: 'GET', status: 200, contentType: 'text/html; charset=utf-8', contentLength: '5000' }
  assert.equal(shouldCompressResponse(base), true)
  assert.equal(shouldCompressResponse({ ...base, method: 'HEAD' }), false)
  assert.equal(shouldCompressResponse({ ...base, status: 204 }), false)
  assert.equal(shouldCompressResponse({ ...base, status: 206 }), false)
  assert.equal(shouldCompressResponse({ ...base, status: 304 }), false)
  assert.equal(shouldCompressResponse({ ...base, contentEncoding: 'gzip' }), false)
  assert.equal(shouldCompressResponse({ ...base, contentRange: 'bytes 0-99/5000' }), false)
  assert.equal(shouldCompressResponse({ ...base, cacheControl: 'no-store, no-transform' }), false)
  assert.equal(shouldCompressResponse({ ...base, contentType: 'text/event-stream' }), false)
  assert.equal(shouldCompressResponse({ ...base, contentLength: '100' }), false)
  assert.equal(shouldCompressResponse({ ...base, contentLength: undefined }), true)
})

test('compressBuffer only returns a payload when the compressed form is smaller', () => {
  const html = Buffer.from('<div>' + 'compress me '.repeat(2000) + '</div>')
  for (const encoding of ['br', 'gzip']) {
    const compressed = compressBuffer(html, encoding)
    assert.ok(compressed, `${encoding} should compress repetitive HTML`)
    assert.ok(compressed.length < html.length)
    const restored = encoding === 'br' ? brotliDecompressSync(compressed) : gunzipSync(compressed)
    assert.equal(restored.toString('utf8'), html.toString('utf8'))
  }
  assert.equal(compressBuffer(html, null), null)
  // Below the 1 KiB threshold the answer is always identity.
  assert.equal(compressBuffer(Buffer.alloc(100, 65), 'gzip'), null)
  // Incompressible bytes: the encoder must not be adopted when it grows the body.
  assert.equal(compressBuffer(randomBytes(4096), 'gzip'), null)
})

test('compression headers drop the stale length, weaken the ETag and merge Vary', () => {
  assert.equal(weakenEtag('"v1"'), 'W/"v1"')
  assert.equal(weakenEtag('W/"v1"'), 'W/"v1"')
  assert.equal(weakenEtag(undefined), undefined)
  assert.equal(mergeVary(undefined), 'Accept-Encoding')
  assert.equal(mergeVary('Accept-Encoding'), 'Accept-Encoding')
  assert.equal(mergeVary('Cookie, Accept-Encoding'), 'Cookie, Accept-Encoding')
  assert.equal(mergeVary('Cookie'), 'Cookie, Accept-Encoding')
  assert.equal(mergeVary('*'), '*')

  const headers = compressionHeaders({
    'content-type': 'text/html',
    'content-length': '10000',
    etag: '"v1"',
    vary: 'Cookie'
  }, 'br')
  assert.equal(headers['content-encoding'], 'br')
  assert.equal(headers['content-length'], undefined)
  assert.equal(headers['transfer-encoding'], undefined)
  assert.equal(headers.etag, 'W/"v1"')
  assert.equal(headers.vary, 'Cookie, Accept-Encoding')
})

test('cachePolicy only marks content-addressed plugin assets as immutable', () => {
  const proxy = new GatewayProxy({})
  assert.equal(proxy.cachePolicy('/plugins/events', 200), null)
  assert.equal(proxy.cachePolicy('/plugins/events?since=1', 200), null)
  assert.equal(proxy.cachePolicy('/plugins/', 200), null)
  assert.equal(proxy.cachePolicy('/plugins', 200), null)
  assert.equal(proxy.cachePolicy('/plugins/foo', 200), null)
  assert.equal(proxy.cachePolicy('/plugins/foo/client.js', 200), null)
  assert.equal(proxy.cachePolicy('/plugins/??pkg-a,pkg-b&rev=abc123', 200), IMMUTABLE)
  assert.equal(proxy.cachePolicy('/plugins/??pkg-a,pkg-b', 200), null)
  assert.equal(proxy.cachePolicy('/plugins/foo/client.a1b2c3d4.js', 200), IMMUTABLE)
  assert.equal(proxy.cachePolicy('/plugins/foo/client.a1b2c3d4.js?v=2', 200), IMMUTABLE)
  assert.equal(proxy.cachePolicy('/plugins/foo/assets/app.js', 200), IMMUTABLE)
  assert.equal(proxy.cachePolicy('/assets/index-a1b2c3d4.js', 200), IMMUTABLE)
  assert.equal(proxy.cachePolicy('/assets/', 200), null)
  assert.equal(proxy.cachePolicy('/assets/x.js', 404), null)
  assert.equal(proxy.cachePolicy('/manifest.webmanifest', 200), 'public, max-age=86400')
})

test('read cache honours the 5s TTL and the 2 MiB per-entry limit', () => {
  const proxy = new GatewayProxy({})
  const payload = { status: 200, headers: {}, body: Buffer.from('x'.repeat(2048)), cacheable: true }
  proxy.readCacheSet('key', payload)
  assert.equal(proxy.readCacheGet('key')?.payload, payload)
  assert.equal(proxy.readCacheBytes, 2048)
  proxy.readCache.get('key').expiresAt = Date.now() - 1
  assert.equal(proxy.readCacheGet('key'), null)
  assert.equal(proxy.readCacheBytes, 0)

  const tooLarge = { status: 200, headers: {}, body: Buffer.alloc(2 * 1024 * 1024 + 1), cacheable: true }
  proxy.readCacheSet('large', tooLarge)
  assert.equal(proxy.readCache.has('large'), false)
  assert.ok(MIN_COMPRESS_BYTES < tooLarge.body.length)
})

test('PWA text assets are compressed while no-store stays intact', () => {
  const original = readFileSync(new URL('../lib/pwa/client.js', import.meta.url))
  const response = () => {
    const captured = {}
    return {
      captured,
      writeHead(status, headers) { captured.status = status; captured.headers = headers },
      end(body) { captured.body = body }
    }
  }

  const compressed = response()
  assert.equal(servePwa({ method: 'GET', headers: { 'accept-encoding': 'gzip' } }, compressed, '/__pwa/client.js'), true)
  assert.equal(compressed.captured.headers['content-encoding'], 'gzip')
  assert.equal(compressed.captured.headers['cache-control'], 'no-store')
  assert.ok(Number(compressed.captured.headers['content-length']) < original.length)
  assert.equal(gunzipSync(compressed.captured.body).toString('utf8'), original.toString('utf8'))

  // manifest.webmanifest is under the 1 KiB threshold: identity and still no-store.
  const identity = response()
  assert.equal(servePwa({ method: 'GET', headers: { 'accept-encoding': 'br' } }, identity, '/__pwa/manifest.webmanifest'), true)
  assert.equal(identity.captured.headers['content-encoding'], undefined)
  assert.equal(identity.captured.headers['cache-control'], 'no-store')
})

function fakeRequest({ method = 'GET', url = '/', headers = {}, body = '' }) {
  const req = Readable.from(body ? [Buffer.from(body)] : [])
  req.method = method
  req.url = url
  req.headers = headers
  return req
}

class FakeResponse extends EventEmitter {
  constructor() {
    super()
    this.chunks = []
    this.headersSent = false
    this.writableFinished = false
    this.destroyed = false
    this.done = new Promise((resolve) => { this.resolveDone = resolve })
  }
  writeHead(status, headers) {
    this.statusCode = status
    this.headers = headers
    this.headersSent = true
  }
  write(chunk) {
    this.chunks.push(Buffer.from(chunk))
    return true
  }
  end(chunk) {
    if (chunk !== undefined) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    this.writableFinished = true
    this.emit('finish')
    this.emit('close')
    this.resolveDone()
  }
  destroy() {
    this.destroyed = true
    this.emit('close')
    this.resolveDone()
  }
  get body() {
    return Buffer.concat(this.chunks)
  }
}

function decodeBody(response) {
  const encoding = response.headers['content-encoding']
  if (encoding === 'br') return brotliDecompressSync(response.body).toString('utf8')
  if (encoding === 'gzip') return gunzipSync(response.body).toString('utf8')
  return response.body.toString('utf8')
}

test('read POST cache ignores rpcId, shares one upstream call and replays each caller rpcId', async () => {
  let hits = 0
  const upstreamEncodings = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      hits += 1
      upstreamEncodings.push(req.headers['accept-encoding'])
      let message = null
      try { message = JSON.parse(raw) } catch { /* non-RPC body */ }
      if (!message) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"type":"client-response","rpcId":null,"payload":{"raw":true}}')
        return
      }
      const body = JSON.stringify({
        type: 'client-response',
        rpcId: message.rpcId,
        payload: { args: message.payload?.args ?? {}, value: 'z'.repeat(20000) }
      })
      setTimeout(() => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(Buffer.byteLength(body)),
          'set-cookie': 'dsh-session=stale; Path=/',
          etag: '"rpc-response"'
        })
        res.end(body)
      }, 20)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const proxy = new GatewayProxy({ upstreamHost: '127.0.0.1', upstreamPort: server.address().port, log: () => {} })
  const message = (rpcId, args = {}) => JSON.stringify({
    type: 'client-request',
    rpcId,
    method: 'settings/describe',
    payload: { args }
  })
  const call = async (rpcId, encoding, args) => {
    const response = new FakeResponse()
    const req = fakeRequest({
      method: 'POST',
      url: '/api/settings/describe',
      headers: { 'content-type': 'application/json', 'accept-encoding': encoding, cookie: 'dsh-gw=session' },
      body: message(rpcId, args)
    })
    proxy.proxyRequest(req, response, { id: 'device-a', isNew: false })
    await response.done
    return response
  }

  try {
    const first = await call('rpc-one', 'br, gzip')
    const second = await call('rpc-two', 'gzip')
    const third = await call('rpc-three', 'identity')
    assert.equal(hits, 1, 'same RPC method/payload must hit the upstream once')
    assert.equal(JSON.parse(decodeBody(first)).rpcId, 'rpc-one')
    assert.equal(JSON.parse(decodeBody(second)).rpcId, 'rpc-two')
    assert.equal(JSON.parse(decodeBody(third)).rpcId, 'rpc-three')
    assert.equal(first.headers['content-encoding'], 'br')
    assert.equal(second.headers['content-encoding'], 'gzip')
    assert.equal(third.headers['content-encoding'], undefined)
    for (const response of [first, second, third]) {
      assert.equal(response.headers['set-cookie'], undefined, 'cached set-cookie must not replay')
    }

    // Different payload is a different key.
    await call('rpc-four', 'gzip', { model: 'other' })
    assert.equal(hits, 2)

    // Concurrent callers with a fresh payload share one in-flight upstream request.
    const [left, right] = await Promise.all([
      call('rpc-left', 'gzip', { fresh: true }),
      call('rpc-right', 'gzip', { fresh: true })
    ])
    assert.equal(hits, 3)
    assert.equal(JSON.parse(decodeBody(left)).rpcId, 'rpc-left')
    assert.equal(JSON.parse(decodeBody(right)).rpcId, 'rpc-right')

    // A body that is not an RPC envelope is forwarded but never cached or merged.
    const response = new FakeResponse()
    const req = fakeRequest({
      method: 'POST',
      url: '/api/settings/describe',
      headers: { 'content-type': 'application/json', 'content-length': '9' },
      body: 'not-json!'
    })
    proxy.proxyRequest(req, response, { id: 'device-a', isNew: false })
    await response.done
    assert.equal(hits, 4)
    assert.equal(JSON.parse(response.body.toString()).payload.raw, true)

    // RPC requests reach the upstream as identity: the gateway owns br/gzip negotiation.
    assert.ok(upstreamEncodings.slice(0, 3).every((encoding) => encoding === 'identity'))
  } finally {
    server.close()
  }
})

test('read POST retries once with a refreshed DSH cookie after upstream 401', async () => {
  let hits = 0
  const cookies = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      hits += 1
      cookies.push(req.headers.cookie)
      const message = JSON.parse(raw)
      if (hits === 1) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"ok":false}')
        return
      }
      const body = JSON.stringify({ type: 'client-response', rpcId: message.rpcId, payload: { ok: true } })
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
      res.end(body)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const proxy = new GatewayProxy({
    upstreamHost: '127.0.0.1',
    upstreamPort: server.address().port,
    log: () => {},
    getDshCookie: async () => 'fresh-cookie'
  })
  proxy.dshCookie = 'stale-cookie'
  try {
    const response = new FakeResponse()
    const req = fakeRequest({
      method: 'POST',
      url: '/api/session/modelCatalog',
      headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'retry-1', method: 'session/modelCatalog', payload: { args: {} } })
    })
    proxy.proxyRequest(req, response, { id: 'device-b', isNew: false })
    await response.done
    assert.equal(hits, 2)
    assert.deepEqual(cookies, ['stale-cookie', 'fresh-cookie'])
    assert.equal(response.statusCode, 200)
    assert.equal(JSON.parse(decodeBody(response)).rpcId, 'retry-1')
  } finally {
    server.close()
  }
})
