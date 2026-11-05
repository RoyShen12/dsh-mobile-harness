/** Run with `node tools/test-upstream.mjs`; uses only temporary local listeners and certificates. */
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { networkInterfaces } from 'node:os'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { GatewayProxy } from '../lib/proxy.js'
import { RemoteService } from '../lib/service.js'
import { connectUpstream, parseUpstreamOrigin, requestUpstream, resolveUpstreamOrigin } from '../lib/upstream.js'

const listen = async (server, host) => {
  server.listen(0, host)
  await once(server, 'listening')
  return server.address().port
}
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})
const readResponse = url => new Promise((resolve, reject) => {
  const req = requestUpstream(url, { agent: false }, res => {
    const chunks = []
    res.on('data', chunk => chunks.push(chunk))
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
  })
  req.on('error', reject)
  req.end()
})

async function relayCase(protocol, host, credentials) {
  let received
  const handler = (req, res) => {
    received = req.headers
    if (req.url === '/?token=launch') {
      res.writeHead(303, { 'set-cookie': 'dsh-owner=test; HttpOnly' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(req.url)
  }
  const upstream = protocol === 'https:' ? https.createServer(credentials, handler) : http.createServer(handler)
  const upstreamSockets = new Set()
  upstream.on('connection', socket => {
    upstreamSockets.add(socket)
    socket.on('close', () => upstreamSockets.delete(socket))
  })
  upstream.on('upgrade', (req, socket) => {
    received = req.headers
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
  })
  let port
  try { port = await listen(upstream, host) } catch (error) {
    if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
      console.log('SKIP IPv6: loopback unavailable')
      return
    }
    throw error
  }
  const origin = `${protocol}//${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`
  const proxy = new GatewayProxy({ getUpstreamOrigin: () => origin })
  proxy.dshCookie = 'dsh-owner=test'
  const gateway = http.createServer((req, res) => proxy.proxyRequest(req, res, null))
  const gatewaySockets = new Set()
  gateway.on('connection', socket => {
    gatewaySockets.add(socket)
    socket.on('close', () => gatewaySockets.delete(socket))
  })
  gateway.on('upgrade', (req, socket) => proxy.connectUpgrade(req, socket, () => {}, 1))
  const gatewayPort = await listen(gateway, '127.0.0.1')
  try {
    const fakeService = { webOrigin: () => origin, ctx: { connection: { authenticatedUrl: base => base + '?token=launch' } } }
    assert.equal(await RemoteService.prototype.resolveDshCookie.call(fakeService), 'dsh-owner=test')
    const response = await readResponse(`http://127.0.0.1:${gatewayPort}/api/check?q=1`)
    assert.deepEqual(response, { status: 200, body: '/api/check?q=1' })
    assert.equal(received.host, new URL(origin).host)
    assert.equal(received.cookie, 'dsh-owner=test')
    const headers = proxy.upstreamHeaders({ url: '/api/check', headers: { origin: 'https://phone.example', referer: 'https://phone.example/api/check' } })
    assert.equal(headers.origin, origin)
    assert.equal(headers.referer, origin + '/api/check')
    const probe = await RemoteService.prototype.probeUrl.call({}, origin + '/')
    assert.equal(probe.code, 200)
    const client = net.connect(gatewayPort, '127.0.0.1')
    client.setTimeout(3000, () => client.destroy(new Error('upgrade timeout')))
    try {
      await once(client, 'connect')
      client.write('GET /api/remote.mux HTTP/1.1\r\nHost: phone\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      const [handshake] = await once(client, 'data')
      assert.match(handshake.toString(), /^HTTP\/1\.1 101/)
      client.write('echo')
      const [echo] = await once(client, 'data')
      assert.equal(echo.toString(), 'echo')
      assert.equal(received.host, new URL(origin).host)
    } finally { client.destroy() }
    console.log(`PASS cookie, HTTP, origin headers, selfcheck, WebSocket: ${protocol} ${host}`)
  } finally {
    for (const socket of upstreamSockets) socket.destroy()
    for (const socket of gatewaySockets) socket.destroy()
    await close(gateway)
    await close(upstream)
    await proxy.stop()
  }
}

async function rejectWrongIdentity(credentials, host) {
  const server = https.createServer(credentials)
  const port = await listen(server, host)
  const origin = `https://${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`
  try {
    await assert.rejects(readResponse(origin), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = connectUpstream(origin, () => { socket.destroy(); resolve() })
      socket.once('error', reject)
    }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
    console.log(`PASS HTTP and WebSocket reject trusted certificate with wrong IP SAN: ${host}`)
  } finally { await close(server) }
}

const fixtureDir = process.argv[2]
if (fixtureDir) {
  const credentials = { key: readFileSync(join(fixtureDir, 'key.pem')), cert: readFileSync(join(fixtureDir, 'cert.pem')) }
  assert.equal(resolveUpstreamOrigin({ getOrigin: () => 'https://[::1]:8443', port: 80 }), 'https://[::1]:8443')
  assert.equal(resolveUpstreamOrigin({ port: 3080 }), 'http://127.0.0.1:3080')
  assert.equal(parseUpstreamOrigin('https://[::1]:8443').hostname, '::1')
  assert.throws(() => resolveUpstreamOrigin({ getOrigin() { throw new Error('not ready') }, port: 3080 }), /not ready/)
  assert.throws(() => parseUpstreamOrigin('file:///tmp/x'))
  await relayCase('http:', '127.0.0.1')
  const interfaceIp = Object.values(networkInterfaces()).flat().find(address => address && address.family === 'IPv4' && !address.internal)?.address
  if (interfaceIp) await relayCase('http:', interfaceIp)
  await relayCase('http:', '::1')
  await relayCase('https:', '127.0.0.1', credentials)
  await relayCase('https:', '::1', credentials)
  const wrongIdentity = { key: readFileSync(join(fixtureDir, 'wrong-key.pem')), cert: readFileSync(join(fixtureDir, 'wrong-cert.pem')) }
  await rejectWrongIdentity(wrongIdentity, '127.0.0.1')
  await rejectWrongIdentity(wrongIdentity, '::1')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-upstream-test-'))
  const checkedDir = realpathSync(dir)
  assert.ok(checkedDir.startsWith(realpathSync(tmpdir()) + '/dsh-upstream-test-'))
  try {
    const cert = join(dir, 'cert.pem')
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1', '-keyout', join(dir, 'key.pem'), '-out', cert], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(cert) })
    const port = await listen(server, '127.0.0.1')
    try {
      await assert.rejects(readResponse(`https://127.0.0.1:${port}/`), /self.signed|certificate/i)
      await assert.rejects(new Promise((resolve, reject) => {
        const socket = connectUpstream(`https://127.0.0.1:${port}`, () => { socket.destroy(); resolve() })
        socket.once('error', reject)
      }), /self.signed|certificate/i)
      console.log('PASS HTTP and WebSocket reject untrusted TLS certificates')
    } finally { await close(server) }
    const wrongCert = join(dir, 'wrong-cert.pem')
    const wrong = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=wrong.example', '-addext', 'subjectAltName=DNS:wrong.example', '-keyout', join(dir, 'wrong-key.pem'), '-out', wrongCert], { encoding: 'utf8' })
    assert.equal(wrong.status, 0, wrong.stderr)
    const trustFile = join(dir, 'trusted.pem')
    writeFileSync(trustFile, Buffer.concat([readFileSync(cert), readFileSync(wrongCert)]))
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), dir], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: trustFile }, encoding: 'utf8', timeout: 20000
    })
    process.stdout.write(child.stdout || '')
    process.stderr.write(child.stderr || '')
    assert.equal(child.status, 0, child.error?.message)
  } finally {
    assert.equal(realpathSync(dir), checkedDir)
    rmSync(resolve(dir), { recursive: true, force: true })
  }
}
