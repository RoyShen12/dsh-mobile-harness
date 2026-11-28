#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { injectPwa } from '../lib/pwa.js'

const source = readFileSync(new URL('../lib/pwa/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../lib/pwa/manifest.webmanifest', import.meta.url), 'utf8'))

function fixture({ mode = 'browser', ios = false, standalone = ios && mode === 'standalone', supported = true, activation = true } = {}) {
  const queries = new Map()
  const winListeners = new Map()
  const docListeners = new Map()
  const attributes = new Set()
  const calls = []
  const root = {
    toggleAttribute(name, value) { value ? attributes.add(name) : attributes.delete(name) },
    requestFullscreen: supported ? async function (options) {
      calls.push(options)
      document.fullscreenElement = root
      emitDoc('fullscreenchange')
    } : undefined
  }
  const document = {
    documentElement: root, fullscreenElement: null, fullscreenEnabled: supported,
    addEventListener(name, fn) { docListeners.set(name, fn) },
    async exitFullscreen() { document.fullscreenElement = null; emitDoc('fullscreenchange') }
  }
  const navigator = { userAgent: ios ? 'iPhone' : 'Android', platform: ios ? 'iPhone' : 'Linux', maxTouchPoints: 1, standalone, userActivation: { isActive: activation } }
  const window = {
    isSecureContext: true,
    matchMedia(name) {
      const query = { matches: name === `(display-mode: ${mode})`, addEventListener(_, fn) { query.changed = fn } }
      queries.set(name, query)
      return query
    },
    addEventListener(name, fn) { winListeners.set(name, fn) },
    dispatchEvent() {}
  }
  function emitDoc(name) { docListeners.get(name)?.() }
  runInNewContext(source, { window, navigator, document, Event: class {} })
  return { api: window.__dshPwa, window, navigator, document, root, queries, attributes, calls, emitDoc, emitWin: (name, event) => winListeners.get(name)?.(event) }
}

test('manifest requests fullscreen with explicit standalone fallback and stable public URLs', () => {
  assert.equal(manifest.display, 'fullscreen')
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone'])
  for (const key of ['id', 'scope', 'start_url']) assert.equal(manifest[key], '/')
})

test('PWA head adds cover once, preserving host zoom and keyboard directives and literal scripts', () => {
  const literal = '<script>const text = \'<meta name="viewport" content="example">\'</script>'
  const html = `<html><head><meta content='width=1280, maximum-scale=5, interactive-widget=resizes-content, viewport-fit=auto' name='viewport'>${literal}</head><body></body></html>`
  const result = injectPwa(html)
  assert.match(result, /width=1280, maximum-scale=5, interactive-widget=resizes-content, viewport-fit=cover/)
  assert.ok(result.includes(literal))
  assert.equal(injectPwa(result), result)
  assert.match(result, /apple-mobile-web-app-status-bar-style" content="black-translucent/)
  // HMR SSE requests carry the boot graph revision; the gateway drops the duplicate graph.
  assert.match(result, /gwrev=/)
  assert.match(result, /__dshGwBridge/)
  assert.equal((result.match(/__dshGwBridge/g) || []).length, 2)
  assert.match(result, /html:not\(\[data-dru-skin-state="ready"\]\) #root/)
  assert.match(result, /env\(safe-area-inset-bottom,0px\)/)
  assert.match(result, /@media\(display-mode:fullscreen\)[\s\S]*data-dsh-pwa-android.*padding-top:0/)
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(result.includes(`env(safe-area-inset-${edge},0px)`))
  assert.equal(fixture({ mode: 'fullscreen' }).attributes.has('data-dsh-pwa-android'), true)
  assert.match(injectPwa('<html><body></body></html>'), /viewport-fit=cover/)
})

test('fullscreen PWA launch is installed even without an API fullscreen element', () => {
  const f = fixture({ mode: 'fullscreen' })
  assert.equal(f.api.getState().installed, true)
  assert.equal(f.api.getState().fullscreen, false)
  assert.equal(f.api.getState().displayMode, 'fullscreen')
  f.emitWin('beforeinstallprompt', { preventDefault() {} })
  assert.equal(f.api.getState().canPrompt, false)
})

test('iOS home-screen appearance accepts display-mode but not browser fullscreen', async () => {
  for (const mode of ['standalone', 'fullscreen']) {
    const f = fixture({ ios: true, mode, standalone: false })
    assert.equal(f.api.getState().iosHomeScreen, true)
    assert.equal(f.attributes.has('data-dsh-pwa-ios'), true)
  }
  const tab = fixture({ ios: true })
  await tab.api.enterFullscreen()
  tab.queries.get('(display-mode: fullscreen)').matches = true
  tab.emitDoc('fullscreenchange')
  assert.equal(tab.api.getState().iosHomeScreen, false)
  assert.equal(tab.attributes.has('data-dsh-pwa-ios'), false)
})

test('API fullscreen retains user gesture, exit and external exit do not re-enter', async () => {
  const f = fixture()
  assert.equal(f.calls.length, 0)
  const request = f.api.enterFullscreen()
  assert.equal(f.calls.length, 1, 'request happens before the first await')
  assert.equal(f.calls[0].navigationUI, 'hide')
  assert.equal(await request, true)
  f.queries.get('(display-mode: fullscreen)').matches = true
  assert.equal(f.api.getState().fullscreen, true)
  assert.equal(f.api.getState().installed, false, 'API fullscreen in a browser tab is not a PWA install')
  assert.equal(await f.api.exitFullscreen(), true)
  f.queries.get('(display-mode: fullscreen)').matches = false
  f.emitDoc('fullscreenchange')
  f.emitWin('focus')
  assert.equal(f.api.getState().fullscreen, false)
  assert.equal(f.calls.length, 1)
})

test('installed fullscreen launch remains installed during temporary API fullscreen', async () => {
  const f = fixture({ mode: 'fullscreen' })
  await f.api.enterFullscreen()
  assert.equal(f.api.getState().installed, true)
})

test('missing gesture, unavailable API and rejected requests expose errors without retries', async () => {
  const f = fixture({ activation: false })
  assert.equal(await f.api.enterFullscreen(), false)
  assert.equal(f.calls.length, 0)
  assert.match(f.api.getState().fullscreenError, /请点击/)
  const unavailable = fixture({ supported: false, ios: true, mode: 'standalone' })
  assert.equal(unavailable.attributes.has('data-dsh-pwa-ios'), true)
  assert.equal(unavailable.api.getState().fullscreenSupported, false)
  assert.equal(await unavailable.api.enterFullscreen(), false)
  assert.match(unavailable.api.getState().fullscreenError, /未开放/)
  const rejected = fixture()
  let requests = 0
  rejected.root.requestFullscreen = () => { requests += 1; return Promise.reject(new Error('denied')) }
  assert.equal(await rejected.api.enterFullscreen(), false)
  assert.match(rejected.api.getState().fullscreenError, /denied/)
  assert.equal(requests, 1)
  rejected.emitDoc('fullscreenerror')
  assert.match(rejected.api.getState().fullscreenError, /拒绝/)
})

test('iPhone Duo asymmetric safe-area, theme-color dedupe, and iOS PWA resume viewport resync', () => {
  const attrs = new Map()
  const styles = new Map()
  const headMetas = [
    { name: 'theme-color', attrs: new Map([['content', '#0e1014'], ['data-dsh-pwa-theme-color', '']]), removed: false },
    { name: 'theme-color', attrs: new Map([['content', 'rgb(40, 44, 52)']]), removed: false }
  ].map((m) => ({
    hasAttribute: (k) => m.attrs.has(k),
    getAttribute: (k) => m.attrs.get(k) ?? null,
    setAttribute: (k, v) => m.attrs.set(k, String(v)),
    remove() { m.removed = true },
    _raw: m
  }))
  let safePadding = { paddingTop: '0px', paddingRight: '84px', paddingBottom: '34px', paddingLeft: '0px' }
  let rootRect = { width: 382, height: 644 }
  let scrollCalls = 0
  let vpSetCalls = 0
  const vpMeta = {
    content: 'width=device-width, initial-scale=1, viewport-fit=cover',
    getAttribute: () => vpMeta.content,
    setAttribute: (_, v) => { vpSetCalls += 1; vpMeta.content = v }
  }
  const root = {
    style: {
      backgroundColor: '',
      setProperty: (k, v) => styles.set(k, v),
      removeProperty: (k) => styles.delete(k)
    },
    toggleAttribute: (k, v) => { v ? attrs.set(k, '') : attrs.delete(k) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k)
  }
  const body = { children: [], appendChild(el) { el.isConnected = true; this.children.push(el) } }
  const docListeners = new Map()
  const winListeners = new Map()
  const document = {
    documentElement: root,
    body,
    head: { querySelectorAll: (sel) => sel === 'meta[name="theme-color"]' ? headMetas.filter((m) => !m._raw.removed) : [] },
    readyState: 'complete',
    visibilityState: 'visible',
    activeElement: null,
    createElement: () => ({ style: {}, setAttribute() {}, isConnected: false }),
    getElementById: (id) => id === 'root' ? { getBoundingClientRect: () => rootRect } : null,
    querySelector: (sel) => sel === 'meta[name="viewport"]' ? vpMeta : null,
    addEventListener: (name, fn) => docListeners.set(name, fn)
  }
  const window = {
    isSecureContext: true,
    innerWidth: 466,
    innerHeight: 678,
    scrollX: 0,
    scrollY: 18,
    scrollTo: () => { scrollCalls += 1; window.scrollX = 0; window.scrollY = 0 },
    getComputedStyle: (el) => el === root ? { getPropertyValue: () => '' } : safePadding,
    matchMedia: (q) => ({ matches: q === '(display-mode: standalone)', addEventListener() {} }),
    addEventListener: (name, fn) => winListeners.set(name, fn),
    dispatchEvent() {}
  }
  const navigator = { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, standalone: true }
  runInNewContext(source, { window, navigator, document, Event: class {} })

  const state = window.__dshPwa.getState()
  assert.deepEqual({ ...state.safeArea }, { top: 0, right: 84, bottom: 34, left: 0 })
  assert.equal(state.sideBarEdge, 'right')
  assert.equal(attrs.get('data-dsh-sa-side'), 'right')
  // Theme-color deduplicated to single host color and synced to <html> background.
  assert.equal(headMetas.filter((m) => !m._raw.removed).length, 1)
  assert.equal(headMetas[0].getAttribute('content'), 'rgb(40, 44, 52)')
  assert.equal(root.style.backgroundColor, 'rgb(40, 44, 52)')
  // Shrunk #root triggers resync + scrollTo(0, 0).
  assert.equal(attrs.get('data-dsh-pwa-resync'), '1')
  assert.equal(styles.get('--dsh-pwa-vw'), '466px')
  assert.equal(styles.get('--dsh-pwa-vh'), '678px')
  assert.ok(scrollCalls >= 1)
  // Forced nudge refreshes viewport meta when shrunk persists.
  window.__dshPwa.resyncViewport(true)
  assert.equal(vpSetCalls, 1)
  // Once #root matches full viewport again, resync attribute clears cleanly.
  rootRect = { width: 466, height: 678 }
  safePadding = { paddingTop: '0px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '84px' }
  window.__dshPwa.resyncViewport(false)
  assert.equal(attrs.has('data-dsh-pwa-resync'), false)
  assert.equal(window.__dshPwa.getState().sideBarEdge, 'left')
  assert.equal(attrs.get('data-dsh-sa-side'), 'left')
})
