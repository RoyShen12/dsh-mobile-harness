// Navigation stays network-only. No sessions, API responses, or assets are cached.
const OFFLINE_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1014">
<title>DSH Remote · 连接中断</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0e1014;color:#e8eaee;font:16px system-ui,sans-serif;text-align:center}main{padding:24px;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))}p{color:#a5a9b5;line-height:1.6}button{border:0;border-radius:8px;padding:12px 24px;color:white;background:#2f6bff;font:inherit;cursor:pointer}</style>
</head><body><main><h1>连接中断</h1><p>请检查网络或远程入口，然后重试。</p><button type="button" onclick="location.reload()">重试</button></main></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(OFFLINE_PAGE, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })))
})
