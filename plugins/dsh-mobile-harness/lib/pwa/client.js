// Expose install and immersive view state; the remote panel owns all user actions.
;(function () {
  if (window.__dshPwa) return

  const secure = window.isSecureContext === true
  const supported = 'serviceWorker' in navigator
  const ua = navigator.userAgent || ''
  const ios = /iPad|iPhone|iPod/i.test(ua)
    || (/Mac/i.test(navigator.platform || ua) && navigator.maxTouchPoints > 1)
  const modes = ['fullscreen', 'standalone', 'minimal-ui'].map((name) => ({
    name, query: typeof window.matchMedia === 'function' ? window.matchMedia(`(display-mode: ${name})`) : null
  }))
  const launchedAsApp = Boolean(navigator.standalone) || modes.some((mode) => mode.query?.matches && !fullscreenElement())
  let deferredPrompt = null
  let installedByEvent = false
  let error = null
  let fullscreenError = null

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement
  }

  function displayMode() {
    // API fullscreen may also match the media query; keep its lifetime separate from PWA launch mode.
    return navigator.standalone ? 'standalone' : modes.find((mode) => mode.query?.matches)?.name || 'browser'
  }

  function installed() {
    return installedByEvent || launchedAsApp || Boolean(navigator.standalone)
      || modes.some((mode) => mode.query?.matches && (mode.name !== 'fullscreen' || !fullscreenElement()))
  }

  function fullscreenSupported() {
    const root = document.documentElement
    return Boolean((root.requestFullscreen && document.fullscreenEnabled !== false)
      || (root.webkitRequestFullscreen && document.webkitFullscreenEnabled !== false))
  }

  function getState() {
    const isInstalled = installed()
    return {
      supported, installed: isInstalled, canPrompt: Boolean(deferredPrompt && !isInstalled), ios, secure, error,
      displayMode: displayMode(), fullscreen: Boolean(fullscreenElement()),
      fullscreenSupported: fullscreenSupported(), fullscreenError
    }
  }

  function changed() {
    // black-translucent leaves system glyphs over the page: give them a stable dark backdrop.
    document.documentElement.toggleAttribute('data-dsh-pwa-ios', Boolean(ios && navigator.standalone))
    document.documentElement.toggleAttribute('data-dsh-pwa-android', /Android/i.test(ua))
    window.dispatchEvent(new Event('dsh-pwa-change'))
  }

  async function enterFullscreen() {
    fullscreenError = null
    try {
      if (!fullscreenSupported()) throw new Error('当前浏览器未开放页面全屏。请从主屏幕启动 PWA。')
      if (navigator.userActivation && !navigator.userActivation.isActive) throw new Error('请点击「进入全屏」以授权本次全屏显示。')
      const root = document.documentElement
      // Call before any await so the click's transient activation is preserved. Never auto-retry.
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' })
      else await root.webkitRequestFullscreen()
      return true
    } catch (reason) {
      fullscreenError = '进入全屏失败：' + String(reason?.message || reason)
      return false
    } finally {
      changed()
    }
  }

  async function exitFullscreen() {
    fullscreenError = null
    try {
      if (fullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen()
        else await document.webkitExitFullscreen()
      }
      return true
    } catch (reason) {
      fullscreenError = '退出全屏失败：' + String(reason?.message || reason)
      return false
    } finally {
      changed()
    }
  }

  async function install() {
    if (!deferredPrompt || installed()) return false
    const prompt = deferredPrompt
    deferredPrompt = null
    changed()
    try {
      const result = await prompt.prompt()
      const choice = result?.outcome ? result : await prompt.userChoice
      return choice?.outcome === 'accepted'
    } catch (reason) {
      error = String(reason?.message || reason)
      changed()
      return false
    }
  }

  window.__dshPwa = { getState, install, enterFullscreen, exitFullscreen }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    if (!installed()) deferredPrompt = event
    changed()
  })
  window.addEventListener('appinstalled', () => {
    installedByEvent = true
    deferredPrompt = null
    changed()
  })
  for (const { query } of modes) {
    if (query?.addEventListener) query.addEventListener('change', changed)
    else if (query?.addListener) query.addListener(changed)
  }
  document.addEventListener('fullscreenchange', changed)
  document.addEventListener('webkitfullscreenchange', changed)
  const failed = () => {
    fullscreenError = '浏览器拒绝了全屏请求。请点击重试，或从主屏幕启动 PWA。'
    changed()
  }
  document.addEventListener('fullscreenerror', failed)
  document.addEventListener('webkitfullscreenerror', failed)
  window.addEventListener('pageshow', changed)
  window.addEventListener('focus', changed)
  changed()

  if (secure && supported) {
    try {
      navigator.serviceWorker.register('/__pwa/sw.js', { scope: '/' }).catch((reason) => {
        error = String(reason?.message || reason)
        changed()
      })
    } catch (reason) {
      error = String(reason?.message || reason)
      changed()
    }
  }
})()
