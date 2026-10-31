#!/usr/bin/env node
/**
 * dsh-tunnel-proxy — put an internet tunnel in front of a loopback-only DeepSeek Harness
 * web server WITHOUT weakening DSH's own Host/Origin fence and WITHOUT handing remote
 * devices DSH's owner cookie.
 *
 * Design (validated against DSH 0.2.1-rc.3):
 *   1. On start it calls the loopback token URL once, receives the 30-day `dsh-auth-*`
 *      cookie and keeps it in memory. Remote devices never see that cookie.
 *   2. Every proxied request is re-addressed to the loopback authority
 *      (`Host: 127.0.0.1:<port>`), so DSH's browser-trust fence treats it as local and the
 *      cookie authority matches. The remote device's `Origin` header (naming the public
 *      host) is dropped, because DSH requires Origin and Host to be the same authority.
 *   3. Remote devices log in to *this proxy* with a password; the proxy issues its own
 *      signed cookie. A cookie (not Basic auth) is used on purpose: browser WebSocket
 *      handshakes carry cookies but cannot attach an Authorization header.
 *   4. WebSocket upgrades (`/api/remote.mux`) are relayed raw.
 *
 * State: --state-dir holds `state.json` (signing secret + password hash, mode 600) so a
 * proxy restart does NOT log devices out, and `password.txt` with the generated password
 * for convenience. Use --reset-password to rotate.
 *
 * Usage:
 *   node dsh-tunnel-proxy.mjs \
 *     --listen 63200 \
 *     --upstream 127.0.0.1:62854 \
 *     --token-url "http://127.0.0.1:62854/?token=..." \
 *     [--pass 'choose-a-password'] [--state-dir C:\Users\me\.dsh\remote-access] \
 *     [--secure-cookie] [--session-hours 720] [--reset-password]
 */
import http from 'node:http';
import net from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHmac, timingSafeEqual, scryptSync } from 'node:crypto';

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.flags.add(key);
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv);
const listenPort = Number(args.listen ?? 63200);
const upstream = args.upstream ?? '127.0.0.1:62854';
const tokenUrl = args['token-url'];
const cookieOverride = args.cookie;
const secureCookie = args.flags.has('secure-cookie');
const sessionHours = Number(args['session-hours'] ?? 720);
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const stateDir = resolve(args['state-dir'] ?? join(dshHome, 'remote-access'));
if ((!tokenUrl && !cookieOverride)) {
  console.error('required: --token-url <url>  (or --cookie "dsh-auth-…=…")');
  process.exit(2);
}
const [upHost, upPortText] = upstream.split(':');
const upPort = Number(upPortText);
const upstreamAuthority = `${upHost}:${upPort}`;
const SESSION_COOKIE = 'dsh-gw';
const MAX_AGE = Math.max(60, Math.floor(sessionHours * 3600));
const STATE_FILE = join(stateDir, 'state.json');
const PASSWORD_FILE = join(stateDir, 'password.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── persistent state: session signing secret + password hash ─────────────────
function hashPassword(password, salt) {
  return scryptSync(password, salt, 32).toString('base64url');
}

function loadOrCreateState() {
  mkdirSync(stateDir, { recursive: true });
  let state;
  if (existsSync(STATE_FILE) && !args.flags.has('reset-password')) {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (state.version !== 1 || typeof state.secret !== 'string' || !state.password) {
      throw new Error(`unrecognised state file: ${STATE_FILE}`);
    }
    console.log(`state: reusing ${STATE_FILE} (devices stay logged in)`);
    return state;
  }
  const password = args.pass ?? randomBytes(9).toString('base64url');
  const salt = randomBytes(16).toString('base64url');
  state = {
    version: 1,
    secret: randomBytes(32).toString('base64url'),
    password: { salt, hash: hashPassword(password, salt) },
    createdAt: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  writeFileSync(PASSWORD_FILE, `${password}\n`, { mode: 0o600 });
  try { chmodSync(STATE_FILE, 0o600); chmodSync(PASSWORD_FILE, 0o600); } catch { /* Windows ACLs */ }
  console.log(`state: created ${STATE_FILE}`);
  console.log(`password: ${password}   (also saved to ${PASSWORD_FILE})`);
  return state;
}

const state = loadOrCreateState();
const sessionSecret = Buffer.from(state.secret, 'base64url');

function verifyPassword(candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(state.password.hash, 'base64url');
  const actual = Buffer.from(hashPassword(candidate, state.password.salt), 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function makeSession() {
  const issuedAt = Date.now();
  return `${issuedAt}.${sign(String(issuedAt))}`;
}

function sessionValid(raw) {
  if (typeof raw !== 'string') return false;
  const [body, signature] = raw.split('.');
  if (!body || !signature) return false;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const issuedAt = Number(body);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < MAX_AGE * 1000;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const segment of header.split(';')) {
    const index = segment.indexOf('=');
    if (index !== -1 && segment.slice(0, index).trim() === name) return segment.slice(index + 1).trim();
  }
  return undefined;
}

// ── DSH owner cookie bootstrap ───────────────────────────────────────────────
async function bootstrapCookie() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(tokenUrl, { redirect: 'manual', headers: { host: upstreamAuthority } });
      const setCookie = response.headers.get('set-cookie');
      if (response.status === 303 && setCookie) return setCookie.split(';')[0].trim();
      if (response.status === 401) throw new Error('token rejected (401): is the token URL from the current DSH process?');
      throw new Error(`unexpected status ${response.status}`);
    } catch (error) {
      if (attempt === 20) throw error;
      console.error(`bootstrap attempt ${attempt} failed: ${error.message}; retrying`);
      await sleep(1000);
    }
  }
  throw new Error('unreachable');
}

const dshCookie = cookieOverride ? cookieOverride.split(';')[0].trim() : await bootstrapCookie();
console.log(`bootstrap ok: upstream=${upstreamAuthority} dshCookie=${dshCookie.slice(0, 20)}…`);

// ── login page ───────────────────────────────────────────────────────────────
function loginPage(message = '') {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="theme-color" content="#0e1014"/>
<title>DeepSeek Harness · Remote</title>
<style>
  html,body{margin:0;height:100%;background:#0e1014;color:#e8eaee;
    font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center}
  form{width:min(92vw,360px);background:#171a21;border:1px solid #2c323d;border-radius:14px;
    padding:26px 22px;box-shadow:0 18px 60px #0008}
  h1{font-size:17px;margin:0 0 6px;font-weight:650}
  p{font-size:12px;color:#9aa3b2;margin:0 0 18px;line-height:1.6}
  input{width:100%;box-sizing:border-box;background:#11141a;border:1px solid #2c323d;color:#e8eaee;
    border-radius:9px;padding:12px 13px;font-size:15px;margin-bottom:12px}
  input:focus{outline:none;border-color:#4c8dff}
  button{width:100%;border:0;border-radius:9px;padding:12px;font-size:14px;font-weight:650;
    background:#4c8dff;color:#08101f;cursor:pointer}
  .err{color:#ff8a70;font-size:12px;min-height:16px;margin-bottom:8px}
  .hint{font-size:11px;color:#5a6473;margin-top:14px;line-height:1.5}
</style></head><body>
<form method="POST" action="__login">
  <h1>DeepSeek Harness · 远程访问</h1>
  <p>请输入远程访问密码。这是本机隧道代理的独立口令，与 DeepSeek 账号无关。</p>
  <div class="err">${message}</div>
  <input type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus required/>
  <button type="submit">进入</button>
  <div class="hint">仅限本人设备使用。</div>
</form>
</body></html>`;
}

function upstreamHeaders(req) {
  const headers = { ...req.headers, host: upstreamAuthority, cookie: dshCookie };
  delete headers.origin;
  delete headers.referer;
  delete headers.authorization;
  return headers;
}

function proxyRequest(req, res) {
  const upstreamRequest = http.request(
    { host: upHost, port: upPort, method: req.method, path: req.url, headers: upstreamHeaders(req) },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstreamRequest.on('error', (error) => {
    console.error('upstream error:', error.message);
    if (!res.headersSent) res.writeHead(502);
    res.end('upstream error\n');
  });
  req.pipe(upstreamRequest);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://dsh.invalid');
  if (url.pathname === '/__login' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const submitted = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password') ?? '';
      if (!verifyPassword(submitted)) {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(loginPage('密码不正确'));
        return;
      }
      const attributes = `${SESSION_COOKIE}=${makeSession()}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Strict${secureCookie ? '; Secure' : ''}`;
      res.writeHead(303, { location: './', 'set-cookie': attributes, 'cache-control': 'no-store' });
      res.end();
    });
    return;
  }
  if (!sessionValid(readCookie(req, SESSION_COOKIE))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(loginPage());
    return;
  }
  proxyRequest(req, res);
});

server.on('upgrade', (req, socket) => {
  if (!sessionValid(readCookie(req, SESSION_COOKIE))) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstreamSocket = net.connect(upPort, upHost, () => {
    const headers = upstreamHeaders(req);
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) {
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstreamSocket.on('error', () => socket.destroy());
  socket.on('error', () => upstreamSocket.destroy());
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`dsh-tunnel-proxy listening on http://127.0.0.1:${listenPort} -> ${upstreamAuthority}`);
  console.log('remote devices: open the tunnel URL and log in with the password above');
});
