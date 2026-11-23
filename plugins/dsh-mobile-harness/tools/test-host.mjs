import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { RemoteService } from '../lib/service.js'
import { sakuraFrpLogDir, windowsPowerShellPath } from '../lib/windows-paths.js'

const diagnose = fileURLToPath(new URL('./diagnose.mjs', import.meta.url))

async function fixture(t) {
  const prefix = join(await realpath(tmpdir()), 'dsh host 测试-')
  const dir = await mkdtemp(prefix)
  t.after(async () => {
    assert.ok(dir.startsWith(prefix) && (await realpath(dir)) === dir)
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

function post(base, path, body, cookie) {
  return fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(base).origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  })
}

function cookies(response) {
  return response.headers.getSetCookie().filter(value => !/; Max-Age=0(?:;|$)/i.test(value)).map(value => value.split(';')[0]).join('; ')
}

test('Host pairs over a real loopback listener, preserving approval and local-only management', async t => {
  const home = await fixture(t)
  const originalHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
  })

  // Synthetic owner service. Its occupied listen port doubles as the gateway's preferred port.
  const upstream = http.createServer((req, res) => {
    if (req.url === '/?token=test-launch') return res.writeHead(303, { 'set-cookie': 'dsh-owner=test; HttpOnly' }).end()
    if (req.headers.cookie !== 'dsh-owner=test') return res.writeHead(403).end()
    return res.writeHead(200, { 'content-type': 'text/plain' }).end('fixture upstream')
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => new Promise(resolve => {
    upstream.close(resolve)
    upstream.closeAllConnections()
  }))
  const occupiedPort = upstream.address().port
  const service = new RemoteService({
    webServer: { getOrigin: () => `http://127.0.0.1:${occupiedPort}` },
    connection: { authenticatedUrl: base => `${base}?token=test-launch` }
  })
  t.after(() => service.dispose())
  service.state.tunnel = 'none'
  service.state.proxyPort = occupiedPort
  await service.setEnabled(true)
  const { publicUrl, qrText, proxyPort } = service.snapshot()
  assert.equal(service.proxy.server.address().address, '127.0.0.1')
  assert.notEqual(proxyPort, occupiedPort)
  assert.equal(new URL(publicUrl).port, String(proxyPort))
  const state = JSON.parse(await readFile(join(home, 'remote-access', 'plugin-state.json'), 'utf8'))
  assert.equal(state.proxyPort, proxyPort)
  const { stdout } = await promisify(execFile)(process.execPath, [diagnose, '--json'], { timeout: 5000 })
  assert.equal(JSON.parse(stdout).steps.find(step => step.id === 'gateway')?.status, 'ok')

  const scan = new URL(qrText)
  assert.equal(scan.origin, new URL(publicUrl).origin)
  assert.equal(scan.search, '')
  const ticket = new URLSearchParams(scan.hash.slice(1)).get('t')
  assert.ok(ticket)
  const pendingResponse = await post(publicUrl, '/__verify', { ticket })
  assert.equal(pendingResponse.status, 202)
  const pending = await pendingResponse.json()
  const proof = cookies(pendingResponse)
  const signedOut = await fetch(new URL('/fixture', publicUrl), { headers: { cookie: proof }, signal: AbortSignal.timeout(5000) })
  assert.equal(signedOut.status, 401)
  await signedOut.text()
  assert.match(pending.pairCode, /^\d{6}$/)
  const [ownerPending] = service.pendingState().pending
  assert.equal(ownerPending.pairCode, pending.pairCode)
  const differentCode = (Number(pending.pairCode) + 1).toString().padStart(6, '0')
  assert.throws(() => service.handleDevices({ action: 'approve', deviceId: ownerPending.deviceId, code: differentCode }), /配对码不一致/)
  service.handleDevices({ action: 'approve', deviceId: ownerPending.deviceId, code: pending.pairCode })

  const approved = await post(publicUrl, '/__verify/status', { requestId: pending.requestId }, proof)
  assert.equal(approved.status, 200)
  const session = cookies(approved)
  assert.ok((await approved.json()).approved)
  const admitted = await fetch(new URL('/fixture', publicUrl), { headers: { cookie: session }, signal: AbortSignal.timeout(5000) })
  assert.equal(admitted.status, 200)
  assert.equal(await admitted.text(), 'fixture upstream')
  const ownerOnly = await post(publicUrl, '/api/dsh-mobile-harness.toggle', { enabled: false }, session)
  assert.equal(ownerOnly.status, 403)
  await ownerOnly.text()
  const replay = await post(publicUrl, '/__verify', { ticket })
  assert.equal(replay.status, 401)
  assert.equal((await replay.json()).code, 'ticket')
})

test('Windows discovers SakuraFrp under relocated ProgramData and uses the system PowerShell', { skip: process.platform !== 'win32' }, async t => {
  const programData = await fixture(t)
  const previous = process.env.ProgramData
  process.env.ProgramData = programData
  t.after(() => {
    if (previous === undefined) delete process.env.ProgramData
    else process.env.ProgramData = previous
  })
  const logs = join(programData, 'SakuraFrpService', 'Logs')
  await mkdir(logs, { recursive: true })
  await writeFile(join(logs, 'SakuraFrpService.20260101.log'), [
    '2026-01-01 10:00:00 开始加载隧道配置',
    '2026-01-01 10:00:01 Automatic TLS',
    '2026-01-01 10:00:02 使用 >>tunnel.example:8443<< 连接你的隧道',
    '2026-01-01 10:00:03 TCP 隧道启动成功',
    '2026-01-01 10:00:04 连接映射目标 [tcp://127.0.0.1:61234] failed'
  ].join('\r\n'))
  assert.equal(sakuraFrpLogDir(), logs)
  const relay = RemoteService.prototype.detectSakuraFrp.call(null)
  assert.equal(relay.url, 'https://tunnel.example:8443/')
  assert.equal(relay.localPort, 61234)
  const result = spawnSync(process.execPath, [diagnose, '--frp-only'], { encoding: 'utf8', env: { ...process.env, DSH_DIAGNOSE_FRP_DIR: '' } })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).localPort, relay.localPort)

  const exe = windowsPowerShellPath()
  assert.ok(exe?.endsWith('\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
  const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Out.Write($env:ProgramData)'
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const powerShell = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, encoding: 'utf8' })
  assert.equal(powerShell.status, 0, powerShell.stderr)
  assert.equal(powerShell.stdout, programData)
})
