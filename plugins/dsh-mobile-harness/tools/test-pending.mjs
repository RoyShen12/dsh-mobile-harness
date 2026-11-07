/**
 * Run with `node --test tools/test-pending.mjs`.
 *
 * Covers the lightweight /pending contract: the shape pendingState() may expose (and the big
 * snapshot fields it must not), the bucketed display timestamps, and the ETag/304 + long-poll
 * behaviour of the route helper. No sockets, no real service — a small fake stands in.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RemoteService, bucketLastSeen, bucketUiProbe, etagFor, ifNoneMatch, pendingResponse } from '../lib/service.js'

const PENDING_URL = 'http://dsh.invalid/api/dsh-mobile-harness.pending'

const ENTRY = {
  requestId: 'req-1',
  deviceId: 'device-abcdef',
  label: 'Pixel 9',
  client: 'web',
  clientVersion: '1.2.0',
  code: '482913',
  createdAt: 1700000000000,
  expiresAt: 1700000600000
}

/** A RemoteService stand-in: only the fields pendingState()/pendingResponse() actually touch. */
function fakeService({ phase = 'enabled', busy = null, pendingList = [] } = {}) {
  const calls = { deviceCount: 0, pageCount: 0 }
  const service = {
    phase,
    busy,
    proxy: {
      deviceCount: () => { calls.deviceCount += 1; return 2 },
      pageCount: () => { calls.pageCount += 1; return 1 }
    },
    registry: { pendingList: () => pendingList },
    managementKey: Buffer.from('pending-test-key'),
    deviceReference: RemoteService.prototype.deviceReference,
    managementReferences: RemoteService.prototype.managementReferences,
    pendingState: RemoteService.prototype.pendingState
  }
  return { service, calls }
}

test('pendingState keeps only the small approval fields', () => {
  const { service } = fakeService({ pendingList: [ENTRY] })
  const state = RemoteService.prototype.pendingState.call(service)

  assert.deepEqual(
    Object.keys(state).sort(),
    ['busy', 'devices', 'enabled', 'pages', 'pending', 'phase']
  )
  assert.equal(state.phase, 'enabled')
  assert.equal(state.enabled, true)
  assert.equal(state.busy, null)
  assert.equal(state.devices, 2)
  assert.equal(state.pages, 1)
  assert.equal(state.pending.length, 1)

  const entry = state.pending[0]
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['client', 'clientVersion', 'createdAt', 'deviceId', 'expiresAt', 'label', 'pairCode', 'requestId']
  )
  // Host-side overlay needs the code; the route blanks it for remote clients.
  assert.equal(entry.pairCode, '482913')
  // deviceId is an HMAC reference, never the raw id the registry stores.
  assert.notEqual(entry.deviceId, ENTRY.deviceId)

  // None of the heavyweight snapshot sections may leak into the pending feed.
  for (const key of ['labels', 'audit', 'sessions', 'qr', 'qrText', 'deviceList', 'settings', 'phone']) {
    assert.equal(key in state, false, key + ' must not be in pendingState()')
  }
})

test('pendingState does not touch the gateway counters while disabled', () => {
  const { service, calls } = fakeService({ phase: 'disabled' })
  const state = RemoteService.prototype.pendingState.call(service)
  assert.equal(state.enabled, false)
  assert.equal(state.devices, 0)
  assert.equal(state.pages, 0)
  assert.equal(calls.deviceCount, 0)
  assert.equal(calls.pageCount, 0)
})

test('display lastSeen is bucketed, unknown stays null', () => {
  assert.equal(bucketLastSeen(1700000012345), 1700000010000)
  assert.equal(bucketLastSeen(1700000099999), 1700000090000)
  assert.equal(bucketLastSeen(null), null)
  assert.equal(bucketLastSeen(undefined), null)
  assert.equal(bucketUiProbe({ mode: 'phone', at: 1700000060000 }).at, 1700000040000)
  assert.equal(bucketUiProbe(null), null)
})

test('etagFor is a stable sha1 of the body', () => {
  const first = etagFor('{"phase":"enabled"}')
  assert.match(first, /^"[0-9a-f]{40}"$/)
  assert.equal(etagFor('{"phase":"enabled"}'), first)
  assert.notEqual(etagFor('{"phase":"disabled"}'), first)
})

test('ifNoneMatch accepts exact, weak and listed tags', () => {
  const tag = etagFor('{"a":1}')
  assert.equal(ifNoneMatch(undefined, tag), false)
  assert.equal(ifNoneMatch('', tag), false)
  assert.equal(ifNoneMatch('*', tag), true)
  assert.equal(ifNoneMatch(tag, tag), true)
  assert.equal(ifNoneMatch('W/' + tag, tag), true)
  assert.equal(ifNoneMatch('"other", ' + tag, tag), true)
  assert.equal(ifNoneMatch('"other"', tag), false)
})

test('pendingResponse: 200 with ETag, then 304 for the same tag', async () => {
  const { service } = fakeService({ pendingList: [ENTRY] })
  const first = await pendingResponse(service, new Request(PENDING_URL))
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-cache')
  const tag = first.headers.get('etag')
  assert.match(tag, /^"[0-9a-f]{40}"$/)
  const body = await first.json()
  assert.equal(body.phase, 'enabled')
  assert.equal(body.pending.length, 1)

  const second = await pendingResponse(service, new Request(PENDING_URL, { headers: { 'if-none-match': tag } }))
  assert.equal(second.status, 304)
  assert.equal(await second.text(), '')
  assert.equal(second.headers.get('etag'), tag)
})

test('pendingResponse hides pairing codes from remote/client requests', async () => {
  const { service } = fakeService({ pendingList: [ENTRY] })
  const host = await pendingResponse(service, new Request(PENDING_URL))
  assert.equal((await host.json()).pending[0].pairCode, '482913')

  for (const headers of [{ 'x-dsh-panel-view': 'client' }, { 'x-dsh-mobile-remote': '1' }]) {
    const response = await pendingResponse(service, new Request(PENDING_URL, { headers }))
    const body = await response.json()
    assert.equal(body.pending[0].pairCode, '')
    assert.notEqual(body.pending[0].deviceId, ENTRY.deviceId)
  }
})

test('pendingResponse long poll answers as soon as the queue changes', async () => {
  const { service } = fakeService()
  const first = await pendingResponse(service, new Request(PENDING_URL))
  const tag = first.headers.get('etag')

  const timer = setTimeout(() => {
    service.registry.pendingList = () => [ENTRY]
  }, 150)

  const started = Date.now()
  try {
    const response = await pendingResponse(
      service,
      new Request(PENDING_URL, { headers: { 'if-none-match': tag } }),
      5000
    )
    assert.equal(response.status, 200)
    assert.ok(Date.now() - started < 5000, 'must return on change, not on the wait budget')
    assert.equal((await response.json()).pending.length, 1)
  } finally {
    clearTimeout(timer)
  }
})

test('pendingResponse long poll ends on abort', async () => {
  const { service } = fakeService()
  const first = await pendingResponse(service, new Request(PENDING_URL))
  const tag = first.headers.get('etag')

  const controller = new AbortController()
  const request = new Request(PENDING_URL, {
    headers: { 'if-none-match': tag },
    signal: controller.signal
  })
  const started = Date.now()
  setTimeout(() => controller.abort(), 50)
  const response = await pendingResponse(service, request, 10000)
  assert.equal(response.status, 304)
  assert.ok(Date.now() - started < 2000, 'abort must end the wait immediately')
})
