#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { hasNativeMobileLayout, readHostRelease } from '../lib/ui-compat.js'
import { injectViewport } from '../lib/proxy.js'
import { injectPwa } from '../lib/pwa.js'

const source = readFileSync(new URL('../lib/client.mobile-skin.js', import.meta.url), 'utf8')
const htmlFor = (version) => `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({ release: { version } })}</script><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>`

function skinFixture(version, { mode = 'tablet', canvas = false } = {}) {
  let factory
  let probe
  let nativeDrawer = false
  let writes = 0
  let observing = false
  const mediaListeners = new Set()
  const frame = { querySelector: () => ({}) }
  const context = {
    __ModuleLoader__: { load: (registration) => { factory = registration.factory } },
    __DSH_BOOT__: version ? { release: { version } } : {},
    MutationObserver: class {
      constructor(callback) { probe = callback }
      observe() { observing = true }
      disconnect() { observing = false }
    },
    document: {
      body: {},
      documentElement: { getAttribute: () => mode },
      querySelector: (selector) => selector === '[data-sidebar-drawer]'
        ? nativeDrawer ? frame : null
        : selector === 'meta[name="viewport"]' ? { getAttribute: () => canvas ? 'width=1280' : 'width=device-width' } : null,
      createElement() { writes += 1; throw new Error('native host must not install legacy DOM') }
    },
    window: {
      matchMedia: () => ({ matches: true, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) })
    }
  }
  runInNewContext(source, context)
  const api = factory()
  return {
    context, api,
    get writes() { return writes },
    get observing() { return observing },
    get mediaListeners() { return mediaListeners.size },
    showDrawer() { nativeDrawer = true; probe?.() },
    hideDrawer() { nativeDrawer = false; context.__dshMobileSkin.refresh() }
  }
}

test('native UI version threshold compares numeric components and prereleases', () => {
  for (const version of ['0.2.1-rc.5', '0.2.2-beta.9', '0.2.2-rc.0', undefined, 'local-build']) assert.equal(hasNativeMobileLayout(version), false, String(version))
  for (const version of ['0.2.2-rc.1', '0.2.2-rc.10', '0.2.2', '0.2.2+build.1', '0.2.3', '0.10.0', '1.0.0']) assert.equal(hasNativeMobileLayout(version), true, version)
})

test('client generation selection agrees with gateway version selection', () => {
  for (const version of ['0.2.1-rc.5', '0.2.2-beta.9', '0.2.2-rc.0', '0.2.2-rc.1', '0.2.2-rc.10', '0.2.2', '0.2.2+build.1', '0.2.3', '0.10.0', '1.0.0', 'local-build']) {
    const f = skinFixture(version, { mode: 'compat', canvas: true })
    const dispose = f.api.installMobileSkin('body{}')
    assert.equal(f.context.__dshMobileSkin.getState().compatibility === 'native', hasNativeMobileLayout(version), version)
    dispose()
  }
})

test('native host skips skin, navigation fold, viewport writes, and event interception', () => {
  for (const version of ['0.2.2-rc.1', '0.2.2', '0.10.0']) {
    for (const mode of ['phone', 'tablet', null, 'compat']) {
      const f = skinFixture(version, { mode, canvas: mode === 'compat' })
      const dispose = f.api.installMobileSkin('body{}')
      const state = f.context.__dshMobileSkin.getState()
      assert.equal(state.active, false)
      assert.equal(state.compatibility, 'native')
      assert.equal(state.layout, mode === 'compat' ? 'compat' : 'native')
      assert.equal(state.hostVersion, version)
      assert.equal(f.writes, 0)
      assert.equal(f.observing, false)
      dispose()
      assert.equal(f.mediaListeners, 0)
      assert.equal(f.context.__dshMobileSkin, undefined)
    }
  }
})

test('unversioned native drawer is detected after mount and remains native on widening', () => {
  const f = skinFixture(undefined, { mode: 'compat', canvas: true })
  const dispose = f.api.installMobileSkin('body{}')
  assert.equal(f.observing, true)
  f.showDrawer()
  assert.equal(f.context.__dshMobileSkin.getState().compatibility, 'native')
  assert.equal(f.observing, false)
  f.hideDrawer()
  assert.equal(f.context.__dshMobileSkin.getState().compatibility, 'native')
  assert.equal(f.writes, 0)
  dispose()
})

test('legacy host retains compat-canvas opt out and inactive diagnostics', () => {
  const f = skinFixture('0.2.1-rc.5', { mode: 'compat', canvas: true })
  const dispose = f.api.installMobileSkin('body{}')
  assert.equal(f.context.__dshMobileSkin.getState().active, false)
  assert.equal(f.context.__dshMobileSkin.getState().compatibility, 'inactive')
  assert.equal(f.writes, 0)
  dispose()
})

test('gateway reads JSON release metadata without executing script text', () => {
  assert.equal(readHostRelease(htmlFor('0.2.2-rc.1')), '0.2.2-rc.1')
  assert.equal(readHostRelease('<script>window.__DSH_BOOT__={"release":{"version":"0.2.2"}};</script>'), '0.2.2')
  assert.equal(readHostRelease('<script>globalThis["__DSH_BOOT__"] = (()=>{throw Error()})()</script>'), undefined)
})

test('gateway preserves native viewport while legacy skin keeps resizes-content', () => {
  const native = injectViewport(htmlFor('0.2.2-rc.1'), 'tablet')
  assert.match(native, /data-dru-ui="tablet"/)
  assert.match(native, /content="width=device-width, initial-scale=1"/)
  assert.doesNotMatch(native, /interactive-widget/)
  assert.match(injectViewport(htmlFor('0.2.1-rc.5'), 'phone'), /interactive-widget=resizes-content/)
  assert.match(injectViewport(htmlFor('0.2.2-rc.1'), 'compat'), /width=1280/)
})

test('native PWA metadata is replaced once while boot release remains readable', () => {
  const html = htmlFor('0.2.2-rc.1').replace('</head>', '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head>')
  const remote = injectPwa(injectViewport(html, 'phone'))
  assert.equal((remote.match(/rel="manifest"/g) ?? []).length, 1)
  assert.match(remote, /href="\/__pwa\/manifest.webmanifest"/)
  assert.equal(readHostRelease(remote), '0.2.2-rc.1')
})
