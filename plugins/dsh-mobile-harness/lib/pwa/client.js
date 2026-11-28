// Expose install, immersive view, asymmetric safe-area, theme-color sync, and iOS PWA viewport recovery.
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
  const isAppMode = ({ name, query }) => query?.matches
    && (name === 'standalone' || (name === 'fullscreen' && !fullscreenElement()))
  const launchedAsApp = Boolean(navigator.standalone) || modes.some(isAppMode)
  const launchedAsInstalled = launchedAsApp || modes.some(({ name, query }) => name === 'minimal-ui' && query?.matches)
  function iosHomeScreen() {
    // Safari historically exposes navigator.standalone; newer WebKit can report
    // the launch through display-mode (separate from a temporary API fullscreen).
    return ios && (Boolean(navigator.standalone) || launchedAsApp || modes.some(isAppMode))
  }

  let deferredPrompt = null
  let installedByEvent = false
  let error = null
  let fullscreenError = null
  let safeArea = { top: 0, right: 0, bottom: 0, left: 0 }
  let sideBarEdge = 'none'
  let keyboardOpen = false
  let keyboardHeight = 0
  let posture = null
  let segmentLayout = 'single'
  let safeProbe = null
  let resyncTimers = []
  let lastThemeColor = null
  let metaObserver = null
  let rootObserver = null

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement
  }

  function displayMode() {
    // API fullscreen may also match the media query; keep its lifetime separate from PWA launch mode.
    return navigator.standalone ? 'standalone' : modes.find((mode) => mode.query?.matches)?.name || 'browser'
  }

  function installed() {
    return installedByEvent || launchedAsInstalled || Boolean(navigator.standalone)
      || modes.some((mode) => mode.query?.matches && (mode.name !== 'fullscreen' || !fullscreenElement()))
  }

  function fullscreenSupported() {
    const root = document.documentElement
    return Boolean((root.requestFullscreen && document.fullscreenEnabled !== false)
      || (root.webkitRequestFullscreen && document.webkitFullscreenEnabled !== false))
  }

  function parsePx(value) {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
  }

  function computeSideBarEdge(sa) {
    if (sa.right >= 40 && sa.right > sa.left + 12) return 'right'
    if (sa.left >= 40 && sa.left > sa.right + 12) return 'left'
    if (sa.left >= 40 && sa.right >= 40) return 'both'
    return 'none'
  }

  function ensureSafeProbe() {
    if (safeProbe && safeProbe.isConnected) return safeProbe
    if (!document.body || typeof document.createElement !== 'function') return null
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('data-dsh-sa-probe', '')
    el.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;z-index:-1;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);box-sizing:border-box'
    document.body.appendChild(el)
    safeProbe = el
    return el
  }

  function measureSafeArea() {
    const root = document.documentElement
    const probe = ensureSafeProbe()
    if (!probe || typeof window.getComputedStyle !== 'function') return false
    const cs = window.getComputedStyle(probe)
    const next = {
      top: parsePx(cs.paddingTop),
      right: parsePx(cs.paddingRight),
      bottom: parsePx(cs.paddingBottom),
      left: parsePx(cs.paddingLeft)
    }
    const nextEdge = computeSideBarEdge(next)
    const same = next.top === safeArea.top && next.right === safeArea.right
      && next.bottom === safeArea.bottom && next.left === safeArea.left && nextEdge === sideBarEdge
    safeArea = next
    sideBarEdge = nextEdge
    if (typeof root.setAttribute === 'function') root.setAttribute('data-dsh-sa-side', sideBarEdge)
    return !same
  }

  function readPostureAndSegments() {
    const root = document.documentElement
    const nextPosture = typeof navigator.devicePosture?.type === 'string' ? navigator.devicePosture.type : null
    let nextSeg = 'single'
    const segs = window.viewport?.segments
    if (Array.isArray(segs) && segs.length >= 2) {
      const a = segs[0]
      const b = segs[1]
      if (a && b) nextSeg = Math.abs(b.left - a.left) >= Math.abs(b.top - a.top) ? 'horizontal-2' : 'vertical-2'
    } else if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(horizontal-viewport-segments: 2)').matches) nextSeg = 'horizontal-2'
      else if (window.matchMedia('(vertical-viewport-segments: 2)').matches) nextSeg = 'vertical-2'
    }
    const same = nextPosture === posture && nextSeg === segmentLayout
    posture = nextPosture
    segmentLayout = nextSeg
    if (typeof root.setAttribute === 'function' && typeof root.removeAttribute === 'function') {
      if (posture) root.setAttribute('data-dsh-posture', posture)
      else root.removeAttribute('data-dsh-posture')
      if (segmentLayout !== 'single') root.setAttribute('data-dsh-segments', segmentLayout)
      else root.removeAttribute('data-dsh-segments')
    }
    return !same
  }

  function isEditable(el) {
    if (!el || typeof el.closest !== 'function') return false
    const editable = el.closest('input, textarea, [contenteditable="true"]')
    if (!editable) return false
    if (editable.tagName === 'INPUT' && /^(button|checkbox|radio|file|range|color|submit|reset)$/i.test(editable.type || '')) return false
    return true
  }

  function syncKeyboard() {
    const root = document.documentElement
    const vv = window.visualViewport
    const winH = Number(window.innerHeight) || 0
    const vvH = vv && Number.isFinite(vv.height) ? Math.round(vv.height) : winH
    const vvTop = vv && Number.isFinite(vv.offsetTop) ? Math.max(0, Math.round(vv.offsetTop)) : 0
    const gap = Math.max(0, winH - vvH - vvTop)
    const focused = isEditable(document.activeElement)
    const nextOpen = Boolean(focused && gap > 100)
    const nextKb = nextOpen ? gap : 0
    const same = nextOpen === keyboardOpen && nextKb === keyboardHeight
    keyboardOpen = nextOpen
    keyboardHeight = nextKb
    if (typeof root.setAttribute === 'function' && typeof root.removeAttribute === 'function') {
      if (keyboardOpen) root.setAttribute('data-dsh-keyboard', 'open')
      else root.removeAttribute('data-dsh-keyboard')
    }
    if (root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty('--dsh-kb-height', `${keyboardHeight}px`)
      if (vvH > 0) root.style.setProperty('--dsh-vv-height', `${vvH}px`)
    }
    return !same
  }

  /** Keep a single <meta name="theme-color"> and <html> canvas aligned with the host's live theme. */
  function syncThemeColor() {
    if (!document.head || typeof document.head.querySelectorAll !== 'function') return
    const metas = [...document.head.querySelectorAll('meta[name="theme-color"]')]
    const hostMeta = metas.find((m) => !m.hasAttribute('data-dsh-pwa-theme-color'))
    const pwaMeta = metas.find((m) => m.hasAttribute('data-dsh-pwa-theme-color'))
    let color = hostMeta?.getAttribute('content')?.trim() || ''
    if (!color && typeof window.getComputedStyle === 'function') {
      const rootVar = window.getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim()
      if (rootVar) color = rootVar
      else if (document.body) {
        const bodyBg = window.getComputedStyle(document.body).backgroundColor
        if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') color = bodyBg
      }
    }
    if (!color) return
    // Deduplicate theme-color tags so Safari/iPhone Duo side bar always reads the live host theme color.
    if (pwaMeta && hostMeta) {
      pwaMeta.setAttribute('content', color)
      for (const extra of metas) {
        if (extra !== pwaMeta && typeof extra.remove === 'function') extra.remove()
      }
    } else if (pwaMeta) {
      if (pwaMeta.getAttribute('content') !== color) pwaMeta.setAttribute('content', color)
    } else if (hostMeta) {
      if (hostMeta.getAttribute('content') !== color) hostMeta.setAttribute('content', color)
    }
    if (color !== lastThemeColor) {
      lastThemeColor = color
      if (document.documentElement?.style) document.documentElement.style.backgroundColor = color
    }
  }

  /**
   * Recover from iOS WebKit standalone PWA resume bugs where returning from the app switcher or
   * rotating/folding leaves #root shrunk with white right/bottom gutters or stray scroll offset.
   */
  function applyViewportResync(forceMetaNudge) {
    const root = document.documentElement
    if (!root || !iosHomeScreen()) return
    const vv = window.visualViewport
    const zoomed = Boolean(vv && Number.isFinite(vv.scale) && Math.abs(vv.scale - 1) > 0.05)
    if (!zoomed && typeof window.scrollTo === 'function' && (window.scrollX || window.scrollY)) {
      window.scrollTo(0, 0)
    }
    const targetW = Math.round(Number(window.innerWidth) || 0)
    const targetH = Math.round(Number(window.innerHeight) || 0)
    if (!(targetW > 0 && targetH > 0)) return
    const appRoot = typeof document.getElementById === 'function' ? document.getElementById('root') : null
    const rect = appRoot && typeof appRoot.getBoundingClientRect === 'function' ? appRoot.getBoundingClientRect() : null
    const shrunk = Boolean(rect && !keyboardOpen && !zoomed && (rect.width < targetW - 2 || rect.height < targetH - 2))
    if (shrunk) {
      if (root.style && typeof root.style.setProperty === 'function') {
        root.style.setProperty('--dsh-pwa-vw', `${targetW}px`)
        root.style.setProperty('--dsh-pwa-vh', `${targetH}px`)
      }
      if (typeof root.setAttribute === 'function') root.setAttribute('data-dsh-pwa-resync', '1')
      if (forceMetaNudge && typeof document.querySelector === 'function') {
        const vp = document.querySelector('meta[name="viewport"]')
        const content = vp?.getAttribute('content')
        if (vp && content) vp.setAttribute('content', content)
      }
    } else if (typeof root.hasAttribute === 'function' && root.hasAttribute('data-dsh-pwa-resync')) {
      if (root.style && typeof root.style.removeProperty === 'function') {
        root.style.removeProperty('--dsh-pwa-vw')
        root.style.removeProperty('--dsh-pwa-vh')
      }
      if (typeof root.removeAttribute === 'function') root.removeAttribute('data-dsh-pwa-resync')
    }
  }

  function resyncViewport(nudge = false) {
    syncThemeColor()
    const saChanged = measureSafeArea()
    const kbChanged = syncKeyboard()
    const posChanged = readPostureAndSegments()
    applyViewportResync(nudge)
    if (saChanged || kbChanged || posChanged) {
      window.dispatchEvent(new Event('dsh-pwa-change'))
    }
  }

  function scheduleResumeResync() {
    for (const id of resyncTimers) clearTimeout(id)
    resyncTimers = []
    resyncViewport(false)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resyncViewport(false))
    }
    if (typeof setTimeout === 'function') {
      resyncTimers.push(setTimeout(() => resyncViewport(true), 120))
      resyncTimers.push(setTimeout(() => resyncViewport(false), 360))
    }
  }

  function getState() {
    const isInstalled = installed()
    return {
      supported, installed: isInstalled, canPrompt: Boolean(deferredPrompt && !isInstalled), ios, secure, error,
      displayMode: displayMode(), iosHomeScreen: iosHomeScreen(), fullscreen: Boolean(fullscreenElement()),
      fullscreenSupported: fullscreenSupported(), fullscreenError,
      safeArea: { ...safeArea }, sideBarEdge, keyboardOpen, keyboardHeight, posture, segments: segmentLayout
    }
  }

  function changed() {
    document.documentElement.toggleAttribute('data-dsh-pwa-ios', iosHomeScreen())
    document.documentElement.toggleAttribute('data-dsh-pwa-android', /Android/i.test(ua))
    syncThemeColor()
    measureSafeArea()
    syncKeyboard()
    readPostureAndSegments()
    applyViewportResync(false)
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

  window.__dshPwa = { getState, install, enterFullscreen, exitFullscreen, resyncViewport }
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
  window.addEventListener('pageshow', scheduleResumeResync)
  window.addEventListener('focus', scheduleResumeResync)
  window.addEventListener('resize', () => resyncViewport(false))
  window.addEventListener('orientationchange', scheduleResumeResync)
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleResumeResync()
    })
    document.addEventListener('focusin', () => resyncViewport(false), true)
    document.addEventListener('focusout', () => resyncViewport(false), true)
  }
  if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
    window.visualViewport.addEventListener('resize', () => resyncViewport(false))
    window.visualViewport.addEventListener('scroll', () => resyncViewport(false))
  }
  if (navigator.devicePosture && typeof navigator.devicePosture.addEventListener === 'function') {
    navigator.devicePosture.addEventListener('change', () => resyncViewport(false))
  }
  if (typeof MutationObserver === 'function') {
    if (document.head) {
      metaObserver = new MutationObserver(() => syncThemeColor())
      metaObserver.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] })
    }
    if (document.documentElement) {
      rootObserver = new MutationObserver(() => syncThemeColor())
      rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme', 'data-ds-theme-source'] })
    }
  }
  changed()
  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => resyncViewport(false), { once: true })
  }

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
