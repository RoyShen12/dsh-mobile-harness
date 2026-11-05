// Expose installation state to the remote panel; the panel owns all install UI.
;(function () {
  if (window.__dshPwa) return

  const secure = window.isSecureContext === true
  const supported = 'serviceWorker' in navigator
  const ua = navigator.userAgent || ''
  const ios = /iPad|iPhone|iPod/i.test(ua)
    || (/Mac/i.test(navigator.platform || ua) && navigator.maxTouchPoints > 1)
  const displayMode = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null
  let deferredPrompt = null
  let installedByEvent = false
  let error = null

  function installed() {
    return installedByEvent || Boolean(navigator.standalone || displayMode?.matches)
  }

  function getState() {
    const isInstalled = installed()
    return { supported, installed: isInstalled, canPrompt: Boolean(deferredPrompt && !isInstalled), ios, secure, error }
  }

  function changed() {
    window.dispatchEvent(new Event('dsh-pwa-change'))
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

  window.__dshPwa = { getState, install }
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
  if (displayMode?.addEventListener) displayMode.addEventListener('change', changed)
  else if (displayMode?.addListener) displayMode.addListener(changed)
  window.addEventListener('pageshow', changed)
  window.addEventListener('focus', changed)

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
