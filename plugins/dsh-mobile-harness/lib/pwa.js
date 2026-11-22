/** Public, non-sensitive PWA resources for the gateway. */
import { readFileSync } from 'node:fs'
import { compressBuffer, compressionHeaders, isCompressibleType, MIN_COMPRESS_BYTES, negotiateEncoding } from './compress.js'

// Native hosts own their keyboard/navigation layout; inset only their root content box.
// Legacy skin already applies env(safe-area-inset-*) to its header, rail and composer.
const SAFE_AREA_STYLE = `<style id="dsh-pwa-safe-area">
html[data-dsh-pwa-ios] body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);background:#0e1014;pointer-events:none;z-index:2147483647}
html:not([data-dru-mobile]) #root{box-sizing:border-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
@media(display-mode:fullscreen){
html[data-dsh-pwa-android]:not([data-dru-mobile]) #root{padding-top:0}
html[data-dsh-pwa-android]:not([data-dru-mobile]) [data-sidebar-right-panel="fullscreen"][data-sidebar-right-open="true"] [class*="_stripChrome_"]:has([data-sidebar-right-toggle]){translate:0 max(0px,calc(env(safe-area-inset-top,0px) - 8px));position:relative;z-index:2}
}
@media(display-mode:fullscreen) and (width <= 640px) and (orientation:portrait){
/* The web exposes the top inset, not the cutout's horizontal bounds. Leave a
   small center corridor on narrow portrait displays, with controls on both sides. */
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_titleRow"]:has(> [class$="_titleCluster"] [class$="_crumbs"]){
  --dsh-cutout-half:min(env(safe-area-inset-top,0px),18px);
  --dsh-title-start:28px;
  display:grid;grid-template-columns:minmax(0,calc(50vw - 20px - var(--dsh-title-start) - var(--dsh-cutout-half))) calc(2 * var(--dsh-cutout-half)) minmax(0,1fr) auto auto;
  padding-inline:var(--dsh-title-start) 0;margin-inline-end:-16px;
}
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_titleCluster"]:has(> [class$="_crumbs"]){display:contents}
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_titleCluster"] > [class$="_crumbs"]{grid-column:1;min-width:0;margin-inline-end:0}
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_titleCluster"] > [class$="_headerActions"]{grid-column:3;min-width:0;gap:2px;overflow:clip}
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_titleRow"]:has(> [class$="_titleCluster"] [class$="_crumbs"]) > [class$="_headerUtilities"]{grid-column:4;gap:2px;margin:0}
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_titleRow"]:has(> [class$="_titleCluster"] [class$="_crumbs"]) > [class$="_headerCorner"]{grid-column:5;margin:0}
}
@media(display-mode:fullscreen) and (width > 640px), (display-mode:fullscreen) and (orientation:landscape){
/* Wide and landscape layouts retain the existing corner-only adjustment. */
html[data-dsh-pwa-android]:not([data-dru-mobile]) header[data-window-drag] [class$="_headerCorner"]{translate:0 max(0px,calc(env(safe-area-inset-top,0px) - 8px));position:relative;z-index:2}
}
</style>`
const DEFAULT_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'

/**
 * Tag `/plugins/events` with the boot graph revision so the gateway can suppress the
 * duplicate full graph the HMR SSE server sends first. Kept tiny and fail-open: if the
 * browser refuses the wrapper, or the server is an older gateway, HMR behaves as before.
 */
const SSE_REV_BRIDGE = `<script>(function(){var Native=window.EventSource;if(typeof Native!=="function"||window.EventSource.__dshGwBridge)return;function GatewayEventSource(url,options){var href=String(url);try{var clean=href.split("?")[0].split("#")[0];if(clean==="plugins/events"||clean.slice(-15)==="/plugins/events"){var rev=window.__DSH_BOOT__&&window.__DSH_BOOT__.rev;if(typeof rev==="string"&&rev&&href.indexOf("gwrev=")===-1){href+=(href.indexOf("?")===-1?"?":"&")+"gwrev="+encodeURIComponent(rev)}}}catch(_error){}return options===undefined?new Native(href):new Native(href,options)}GatewayEventSource.prototype=Native.prototype;try{Object.setPrototypeOf(GatewayEventSource,Native)}catch(_error){}GatewayEventSource.__dshGwBridge=true;window.EventSource=GatewayEventSource})()</script>`

const HEAD_TAGS = [
  '<script defer src="/__pwa/client.js"></script>',
  SSE_REV_BRIDGE,
  '<link rel="manifest" href="/__pwa/manifest.webmanifest">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/__pwa/apple-touch-icon.png">',
  '<meta name="theme-color" content="#0e1014">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="DSH Remote">',
  SAFE_AREA_STYLE
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
    const newHead = '<head>' + HEAD_TAGS + DEFAULT_VIEWPORT + '</head>'
    if (/<html\b[^>]*>/i.test(text)) return text.replace(/<html\b[^>]*>/i, (tag) => tag + newHead)
    if (/^\s*<!doctype\b[^>]*>/i.test(text)) return text.replace(/^(\s*<!doctype\b[^>]*>)/i, '$1' + newHead)
    return newHead + text
  }
  return text.replace(head, (_, opening, content, closing) => {
    if (content.startsWith(HEAD_TAGS)) content = content.slice(HEAD_TAGS.length)
    // Skip comments and complete script bodies so literal HTML inside them remains untouched.
    const tags = /<!--[\s\S]*?-->|<(script|style)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(?:link|meta)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
    let hasViewport = false
    const cleaned = content.replace(tags, (tag) => {
      if (tag.startsWith('<!--')) return tag
      const attrs = attributes(tag)
      if (/^<link\b/i.test(tag)) {
        const rel = (attrs.rel || '').toLowerCase().split(/\s+/)
        if (rel.includes('manifest') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) return ''
      }
      if (/^<meta\b/i.test(tag)) {
        const name = (attrs.name || '').toLowerCase()
        if (META_NAMES.has(name)) return ''
        if (name === 'viewport') {
          if (hasViewport) return ''
          hasViewport = true
          // Preserve width/zoom/interactive-widget policy, adding only edge-to-edge coverage.
          const viewport = (attrs.content || '').split(',').map((part) => part.trim())
            .filter((part) => part && !/^viewport-fit\s*=/i.test(part))
          const value = [...viewport, 'viewport-fit=cover'].join(', ')
          const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
          return `<meta name="viewport" content="${escaped}">`
        }
      }
      if (/^<script\b/i.test(tag) && (attrs.src || '').split(/[?#]/)[0] === '/__pwa/client.js') return ''
      if (/^<style\b/i.test(tag) && attrs.id === 'dsh-pwa-safe-area') return ''
      return tag
    })
    return opening + HEAD_TAGS + (hasViewport ? '' : DEFAULT_VIEWPORT) + cleaned + closing
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
  // 文本型 PWA 资产（manifest、service worker、client.js）走与网关相同的压缩兜底，
  // 但缓存语义保持 no-store：这些文件跟着插件版本走，不能留在浏览器磁盘上。
  let body = asset.body
  const encoding = negotiateEncoding(req.headers['accept-encoding'])
  if (encoding && isCompressibleType(asset.type) && body.length >= MIN_COMPRESS_BYTES) {
    const compressed = compressBuffer(body, encoding)
    if (compressed) {
      body = compressed
      Object.assign(headers, compressionHeaders(headers, encoding), { 'content-length': String(body.length) })
    }
  }
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}
