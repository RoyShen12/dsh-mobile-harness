#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { injectPwa } from '../lib/pwa.js'

const source = readFileSync(new URL('../lib/pwa/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../lib/pwa/manifest.webmanifest', import.meta.url), 'utf8'))

function fixture({ mode = 'browser', ios = false, supported = true, activation = true } = {}) {
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
  const navigator = { userAgent: ios ? 'iPhone' : 'Android', platform: ios ? 'iPhone' : 'Linux', maxTouchPoints: 1, standalone: ios && mode === 'standalone', userActivation: { isActive: activation } }
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
  assert.match(result, /html:not\(\[data-dru-mobile\]\) #root/)
  assert.match(result, /env\(safe-area-inset-bottom,0px\)/)
  assert.match(result, /@media\(display-mode:fullscreen\)[\s\S]*data-dsh-pwa-android.*padding-top:0/)
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
