/**
 * HTTP compression helpers for the gateway.
 *
 * DSH's own webserver may answer with identity bodies; the gateway is the compression
 * fallback for phones on slow relay links. Only node:zlib is used.
 */
import {
  brotliCompressSync,
  constants as zlibConstants,
  createBrotliCompress,
  createGzip,
  gzipSync
} from 'node:zlib'

/** Bodies below this size compress to more bytes than they save. */
export const MIN_COMPRESS_BYTES = 1024

/** On an equal q value brotli wins; against a bare wildcard gzip is the compatible choice. */
const ENCODING_PRIORITY = ['br', 'gzip']

/** MIME types that are worth compressing even though they are not `text/*`. */
const COMPRESSIBLE_APPLICATION = new Set([
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/json',
  'application/xml',
  'application/wasm'
])

/**
 * Pick the best supported content encoding from an Accept-Encoding header.
 * Returns `'br'`, `'gzip'`, or null when the client accepts neither.
 * @param {string|undefined} acceptEncoding
 * @returns {'br'|'gzip'|null}
 */
export function negotiateEncoding(acceptEncoding) {
  if (typeof acceptEncoding !== 'string' || acceptEncoding.trim() === '') return null
  const weights = new Map()
  for (const item of acceptEncoding.split(',')) {
    const sections = item.split(';')
    const token = (sections.shift() || '').trim().toLowerCase()
    if (!token) continue
    let q = 1
    for (const parameter of sections) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter)
      if (!match) continue
      const parsed = Number(match[1])
      q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0
    }
    // A duplicated token is malformed; the highest q is the only sane interpretation.
    if (!weights.has(token) || q > weights.get(token)) weights.set(token, q)
  }
  const wildcard = weights.get('*') ?? 0
  let best = null
  let bestQ = 0
  for (const encoding of ENCODING_PRIORITY) {
    const explicit = weights.get(encoding)
    // `*` stands in for gzip only: a bare wildcard gets the most compatible encoding.
    const q = explicit ?? (encoding === 'gzip' ? wildcard : 0)
    if (q > 0 && q > bestQ) {
      best = encoding
      bestQ = q
    }
  }
  return best
}

/**
 * Whether a Content-Type is worth compressing. Images (except SVG), audio, video,
 * fonts and already-compressed archives are skipped.
 * @param {string|undefined} contentType
 * @returns {boolean}
 */
export function isCompressibleType(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (!mime) return false
  if (mime === 'text/event-stream') return false
  if (mime.startsWith('text/')) return true
  if (mime === 'image/svg+xml') return true
  if (COMPRESSIBLE_APPLICATION.has(mime)) return true
  if (mime.endsWith('+json') || mime.endsWith('+xml')) return true
  return false
}

/**
 * Decide from response metadata whether a body may be compressed at all.
 * @param {{method?: string, status?: number, contentType?: string, contentEncoding?: string,
 *          contentRange?: string, cacheControl?: string, contentLength?: string|number}} options
 * @returns {boolean}
 */
export function shouldCompressResponse(options = {}) {
  if (String(options.method || 'GET').toUpperCase() === 'HEAD') return false
  // 200 only: 204/304 have no body, 206 is a partial representation, errors are tiny.
  if (options.status !== 200) return false
  if (options.contentEncoding) return false
  if (options.contentRange) return false
  if (/no-transform/i.test(String(options.cacheControl || ''))) return false
  if (!isCompressibleType(options.contentType)) return false
  const length = Number(options.contentLength)
  if (Number.isFinite(length) && length >= 0 && length < MIN_COMPRESS_BYTES) return false
  return true
}

/**
 * Combined check: the response is compressible and the client accepts an encoding.
 * @param {string|undefined} acceptEncoding
 * @param {{method?: string, status?: number, contentType?: string, contentEncoding?: string,
 *          contentRange?: string, cacheControl?: string, contentLength?: string|number}} options
 * @returns {'br'|'gzip'|null}
 */
export function compressionFor(acceptEncoding, options = {}) {
  if (!shouldCompressResponse(options)) return null
  return negotiateEncoding(acceptEncoding)
}

/**
 * Append Accept-Encoding to a Vary header without duplicating it.
 * @param {string|string[]|undefined} current
 * @returns {string}
 */
export function mergeVary(current) {
  const values = Array.isArray(current) ? current.join(', ') : String(current ?? '')
  if (!values.trim()) return 'Accept-Encoding'
  const tokens = values.split(',').map((token) => token.trim()).filter(Boolean)
  if (tokens.includes('*')) return values
  if (tokens.some((token) => token.toLowerCase() === 'accept-encoding')) return values
  return `${values}, Accept-Encoding`
}

/**
 * A compressed representation is a different entity, so its validator must be weak.
 * @param {string|undefined} etag
 * @returns {string|undefined}
 */
export function weakenEtag(etag) {
  if (etag === undefined || etag === null) return etag
  const text = String(etag)
  if (!text || /^w\//i.test(text)) return text
  return `W/${text}`
}

/**
 * Response headers for a compressed body: drop the now-stale length, keep a weak ETag,
 * and advertise Accept-Encoding in Vary.
 * @param {Record<string, any>} headers
 * @param {'br'|'gzip'} encoding
 * @returns {Record<string, any>}
 */
export function compressionHeaders(headers, encoding) {
  const out = { ...headers, 'content-encoding': encoding }
  delete out['content-length']
  delete out['transfer-encoding']
  if (out.etag !== undefined) out.etag = weakenEtag(out.etag)
  out.vary = mergeVary(out.vary)
  return out
}

/**
 * Streaming encoder for a response body. Brotli uses quality 4 (fast enough for a phone
 * relay, still much smaller than identity); gzip uses level 6.
 * @param {'br'|'gzip'|null} encoding
 * @returns {import('node:zlib').Transform|null}
 */
export function createEncoder(encoding) {
  if (encoding === 'br') return createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } })
  if (encoding === 'gzip') return createGzip({ level: 6 })
  return null
}

/**
 * Compress a buffered body and only adopt the result when it is actually smaller.
 * @param {Buffer|string} body
 * @param {'br'|'gzip'|null} encoding
 * @returns {Buffer|null} compressed bytes, or null to keep identity
 */
export function compressBuffer(body, encoding) {
  const input = Buffer.isBuffer(body) ? body : Buffer.from(body)
  if (input.length < MIN_COMPRESS_BYTES) return null
  let compressed
  if (encoding === 'br') {
    compressed = brotliCompressSync(input, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } })
  } else if (encoding === 'gzip') {
    compressed = gzipSync(input, { level: 6 })
  } else {
    return null
  }
  return compressed.length < input.length ? compressed : null
}
