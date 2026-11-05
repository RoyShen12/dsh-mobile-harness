/** Public, non-sensitive PWA resources for the gateway. */
import { readFileSync } from 'node:fs'

const HEAD_TAGS = [
  '<script defer src="/__pwa/client.js"></script>',
  '<link rel="manifest" href="/__pwa/manifest.webmanifest">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/__pwa/apple-touch-icon.png">',
  '<meta name="theme-color" content="#0e1014">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="DSH Remote">'
].join('\n')

const META_NAMES = new Set([
  'theme-color', 'mobile-web-app-capable', 'apple-mobile-web-app-capable',
  'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title'
])

function attributes(tag) {
  const result = {}
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match
  while ((match = pattern.exec(tag))) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return result
}

/** Replace host install metadata and add the gateway's metadata at the start of head. */
export function injectPwa(html) {
  const text = String(html)
  const head = /(<head\b[^>]*>)([\s\S]*?)(<\/head\s*>)/i
  if (!head.test(text)) {
    const newHead = '<head>' + HEAD_TAGS + '</head>'
    if (/<html\b[^>]*>/i.test(text)) return text.replace(/<html\b[^>]*>/i, (tag) => tag + newHead)
    if (/^\s*<!doctype\b[^>]*>/i.test(text)) return text.replace(/^(\s*<!doctype\b[^>]*>)/i, '$1' + newHead)
    return newHead + text
  }
  return text.replace(head, (_, opening, content, closing) => {
    if (content.startsWith(HEAD_TAGS)) content = content.slice(HEAD_TAGS.length)
    // Skip comments and complete script bodies so literal HTML inside them remains untouched.
    const tags = /<!--[\s\S]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>|<(?:link|meta)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
    const cleaned = content.replace(tags, (tag) => {
      if (tag.startsWith('<!--')) return tag
      const attrs = attributes(tag)
      if (/^<link\b/i.test(tag)) {
        const rel = (attrs.rel || '').toLowerCase().split(/\s+/)
        if (rel.includes('manifest') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) return ''
      }
      if (/^<meta\b/i.test(tag) && META_NAMES.has((attrs.name || '').toLowerCase())) return ''
      if (/^<script\b/i.test(tag) && (attrs.src || '').split(/[?#]/)[0] === '/__pwa/client.js') return ''
      return tag
    })
    return opening + HEAD_TAGS + cleaned + closing
  })
}

const ASSETS = new Map([
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['sw.js', 'text/javascript; charset=utf-8'],
  ['client.js', 'text/javascript; charset=utf-8'],
  ['icon-192.png', 'image/png'],
  ['icon-512.png', 'image/png'],
  ['icon-maskable-192.png', 'image/png'],
  ['icon-maskable-512.png', 'image/png'],
  ['apple-touch-icon.png', 'image/png']
].map(([name, type]) => [`/__pwa/${name}`, {
  type,
  body: readFileSync(new URL(`./pwa/${name}`, import.meta.url))
}]))

/** Respond to a known public static path, returning whether it was handled. */
export function servePwa(req, res, pathname) {
  const asset = ASSETS.get(pathname)
  if (!asset) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'allow': 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('Method not allowed.\n')
    return true
  }
  const headers = {
    'content-type': asset.type,
    'content-length': String(asset.body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
  if (pathname === '/__pwa/sw.js') headers['service-worker-allowed'] = '/'
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : asset.body)
  return true
}
