#!/usr/bin/env node
/**
 * Phone network measurement over Chrome DevTools Protocol.
 *
 * Usage:
 *   adb -s <device> forward tcp:9222 localabstract:chrome_devtools_remote
 *   node tools/measure-network.mjs --seconds 20            # 观察当前页面
 *   node tools/measure-network.mjs --reload --seconds 30   # 普通刷新
 *   node tools/measure-network.mjs --cold --seconds 60     # 绕过 HTTP 缓存
 *
 * Reports per-URL request count, encoded/decoded bytes, content-encoding and
 * cache-control, plus WebSocket handshake extensions and frame payload sizes.
 * This tool only reads the browser; it never touches the DSH host.
 */
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf('--' + name)
  return at === -1 ? fallback : args[at + 1]
}
const port = Number(option('port', 9222))
const seconds = Number(option('seconds', 20))
const reload = args.includes('--reload') || args.includes('--cold')
const cold = args.includes('--cold')
const outFile = option('out', '')

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const page = targets.find((entry) => entry.type === 'page')
if (!page) throw new Error('no page target; is adb forward pointing at Chrome?')

const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const resources = new Map()
const sockets = new Map()
const handshakes = []

socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }
  const params = message.params ?? {}
  switch (message.method) {
    case 'Network.requestWillBeSent': {
      const row = resources.get(params.requestId) ?? {}
      row.url = params.request.url
      row.method = params.request.method
      row.type = params.type
      row.requestAt = params.timestamp
      row.requestHeaders = params.request.headers
      resources.set(params.requestId, row)
      break
    }
    case 'Network.responseReceived': {
      const row = resources.get(params.requestId) ?? {}
      row.status = params.response.status
      row.mimeType = params.response.mimeType
      row.protocol = params.response.protocol
      row.responseHeaders = params.response.headers
      row.responseAt = params.timestamp
      row.fromDiskCache = params.response.fromDiskCache === true
      resources.set(params.requestId, row)
      break
    }
    case 'Network.loadingFinished': {
      const row = resources.get(params.requestId) ?? {}
      row.encodedDataLength = params.encodedDataLength
      resources.set(params.requestId, row)
      break
    }
    case 'Network.webSocketCreated':
      sockets.set(params.requestId, { url: params.url })
      break
    case 'Network.webSocketWillSendHandshakeRequest':
      sockets.set(params.requestId, { ...sockets.get(params.requestId), requestHeaders: params.request.headers })
      break
    case 'Network.webSocketHandshakeResponseReceived':
      handshakes.push({
        url: sockets.get(params.requestId)?.url,
        status: params.response.status,
        headers: params.response.headers
      })
      break
    case 'Network.webSocketFrameSent':
    case 'Network.webSocketFrameReceived': {
      const row = sockets.get(params.requestId) ?? {}
      const direction = message.method.endsWith('Sent') ? 'sentBytes' : 'receivedBytes'
      row[direction] = (row[direction] ?? 0) + Buffer.byteLength(params.response.payloadData ?? '', 'utf8')
      sockets.set(params.requestId, row)
      break
    }
  }
}

await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})

await send('Network.enable', { maxTotalBufferSize: 200_000_000, maxResourceBufferSize: 100_000_000 })
await send('Page.enable')
if (reload) await send('Page.reload', { ignoreCache: cold })
await new Promise((resolve) => setTimeout(resolve, seconds * 1000))

const rows = [...resources.values()].filter((row) => row.url)
const groups = new Map()
for (const row of rows) {
  const key = row.url.includes('/') ? row.url.replace(/^https?:\/\/[^/]+/, '') : row.url
  const group = groups.get(key) ?? { count: 0, encoded: 0, decoded: 0, status: row.status, encoding: '', cache: '', type: row.type }
  group.count += 1
  group.encoded += row.encodedDataLength ?? 0
  group.status = row.status ?? group.status
  const headers = row.responseHeaders ?? {}
  group.encoding = headers['content-encoding'] ?? headers['Content-Encoding'] ?? ''
  group.cache = headers['cache-control'] ?? headers['Cache-Control'] ?? ''
  group.type = row.type ?? group.type
  groups.set(key, group)
}

// Chrome reports decoded body bytes on responseReceived.encodedDataLength for
// HTTP/2 differently, so the authoritative transfer counter is loadingFinished.
const summary = [...groups.entries()]
  .map(([path, group]) => ({ path, ...group }))
  .sort((left, right) => right.encoded - left.encoded)
const totalEncoded = summary.reduce((sum, row) => sum + row.encoded, 0)
const byEncoding = {}
for (const row of summary) byEncoding[row.encoding || 'identity'] = (byEncoding[row.encoding || 'identity'] ?? 0) + row.encoded

const report = {
  url: page.url,
  seconds,
  cold,
  totalEncoded,
  byEncoding,
  resources: summary,
  webSockets: [...sockets.values()].filter((entry) => entry.url),
  webSocketHandshakes: handshakes
}

if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(`page ${report.url}`)
console.log(`window ${seconds}s${cold ? ' (cold)' : reload ? ' (reload)' : ''}, transfer ${totalEncoded} bytes`)
console.log(`encodings ${JSON.stringify(byEncoding)}`)
console.log('')
console.log('count'.padStart(5), 'transfer'.padStart(11), 'state'.padEnd(8), 'encoding'.padEnd(9), 'path')
for (const row of summary.slice(0, 40)) {
  console.log(
    String(row.count).padStart(5),
    String(row.encoded).padStart(11),
    String(row.status ?? '').padEnd(8),
    (row.encoding || 'identity').padEnd(9),
    row.path.slice(0, 140)
  )
}
for (const ws of report.webSockets) {
  console.log(`ws ${ws.url} sent=${ws.sentBytes ?? 0} received=${ws.receivedBytes ?? 0}`)
}
for (const handshake of handshakes) {
  const extensions = handshake.headers?.['Sec-Websocket-Extensions'] ?? handshake.headers?.['sec-websocket-extensions'] ?? '(none)'
  console.log(`ws handshake ${handshake.status} ${handshake.url} extensions=${extensions}`)
}
socket.close()
