/** HTTP(S) transport and address normalization for the bound DSH Web listener. */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { X509Certificate } from 'node:crypto'

/** Check IP SANs directly; Node's DNS-oriented verifier can misclassify IPv6 literals. */
function checkUpstreamIdentity(hostname, certificate) {
  if (!net.isIP(hostname)) return tls.checkServerIdentity(hostname, certificate)
  if (new X509Certificate(certificate.raw).checkIP(hostname)) return undefined
  const error = new Error(`Upstream certificate does not match IP address ${hostname}`)
  error.code = 'ERR_TLS_CERT_ALTNAME_INVALID'
  return error
}

/** Resolve a root HTTP(S) origin into URL authority and socket address forms. */
export function parseUpstreamOrigin(raw) {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('宿主 Web 地址必须是无凭据和路径的 HTTP(S) origin')
  }
  return {
    origin: url.origin,
    authority: url.host,
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    protocol: url.protocol
  }
}

/** Prefer the listener's own origin; older hosts expose only their loopback port. */
export function resolveUpstreamOrigin(webServer) {
  if (typeof webServer?.getOrigin === 'function') return parseUpstreamOrigin(webServer.getOrigin()).origin
  const port = webServer?.port
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('宿主 Web 服务尚未就绪')
  return parseUpstreamOrigin(`http://127.0.0.1:${port}`).origin
}

/** Issue an HTTP(S) request using Node's normal certificate and hostname checks. */
export function requestUpstream(rawUrl, options, onResponse) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported upstream protocol')
  const transport = url.protocol === 'https:' ? https : http
  return transport.request(url, { ...options, rejectUnauthorized: true, checkServerIdentity: checkUpstreamIdentity }, onResponse)
}

/** Connect a WebSocket byte relay after TCP connect or a verified TLS handshake. */
export function connectUpstream(origin, onConnect) {
  const target = parseUpstreamOrigin(origin)
  const address = { host: target.hostname, port: target.port }
  return target.protocol === 'https:'
    ? tls.connect({ ...address, rejectUnauthorized: true, checkServerIdentity: checkUpstreamIdentity, ...(net.isIP(target.hostname) ? {} : { servername: target.hostname }) }, onConnect)
    : net.connect(address, onConnect)
}
