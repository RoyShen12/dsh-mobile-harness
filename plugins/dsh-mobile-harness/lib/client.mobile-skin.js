globalThis.__ModuleLoader__.load({
  id: 'dsh-mobile-harness',
  chunk: 'client.mobile-skin.js',
  factory() {
const MOBILE_SKIN_VERSION = '2.0.0'

const EDGE_SWIPE_ZONE = 64
const MOBILE_QUERY = '(max-width: 640px), (any-pointer: coarse) and (max-width: 1366px)'
const SELECTORS = {
  frame: '[class*="_frame"][style*="grid-template-columns"]',
  sidebar: '[class*="_sidebarCol"]',
  center: '[class*="_centerCol"]',
  rightbar: '[data-rightbar-col], [class*="_rightbarCol"]',
  header: 'header',
  'header-leading': '[data-conversation-header-leading], [class*="_headerLeading"]',
  'header-actions': '[class*="_headerActions"]',
  'header-utilities': '[class*="_headerUtilities"]',
  'title-row': '[class*="_titleRow"]',
  'title-cluster': '[class*="_titleCluster"]',
  'header-corner': '[class*="_headerCorner"]',
  crumbs: 'nav[aria-label="session hierarchy"], nav[aria-label="会话层级"]',
  tabs: '[class*="_tabs"]',
  composer: '[data-composer-seat], [class*="_composerSeat"]',
  'chat-scroll': '[data-conversation-scroll]'
}
const ACTIONS = {
  openSidebar: ['打开侧边栏', '展开侧边栏', 'Open sidebar', 'Expand sidebar'],
  closeSidebar: ['收起侧边栏', '关闭侧边栏', 'Collapse sidebar', 'Close sidebar'],
  closeRightbar: ['收起右侧边栏', '关闭右侧边栏', 'Close right sidebar', 'Collapse right sidebar']
}

function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value)
}

function setProperty(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
}

function editableElement(target) {
  if (!(target instanceof Element)) return null
  const editable = target.closest('input, textarea, [contenteditable="true"]')
  if (!editable || editable.matches('input[type="button"], input[type="checkbox"], input[type="radio"], input[type="file"], input[type="range"], input[type="color"]')) return null
  return editable
}

function isComposer(target) {
  return target instanceof Element && Boolean(target.closest('[role="textbox"][contenteditable="true"]'))
}

function installMobileSkin(css) {
  if (typeof css !== 'string' || !css) throw new Error('Mobile stylesheet unavailable')
  const query = window.matchMedia(MOBILE_QUERY)
  let activeSkin = null
  const sync = () => {
    if (query.matches && !activeSkin) activeSkin = setupMobileSkin(css)
    else if (!query.matches && activeSkin) {
      activeSkin.dispose()
      activeSkin = null
    }
  }
  const diagnostics = {
    version: MOBILE_SKIN_VERSION,
    getState: () => activeSkin?.getState() ?? { active: false, layout: 'desktop', version: MOBILE_SKIN_VERSION },
    refresh: () => activeSkin?.refresh()
  }
  globalThis.__dshMobileSkin = diagnostics
  query.addEventListener('change', sync)
  sync()
  return () => {
    query.removeEventListener('change', sync)
    activeSkin?.dispose()
    activeSkin = null
    if (globalThis.__dshMobileSkin === diagnostics) delete globalThis.__dshMobileSkin
  }
}

function setupMobileSkin(css) {
  const root = document.documentElement
  const body = document.body
  const style = document.createElement('style')
  style.id = 'dru-mobile-style'
  style.textContent = css
  document.head.appendChild(style)
  const originalViewport = document.querySelector('meta[name="viewport"]')
  const viewport = originalViewport ?? document.createElement('meta')
  const previousViewport = originalViewport?.getAttribute('content') ?? null
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'
  if (!originalViewport) document.head.appendChild(viewport)
  setAttribute(root, 'data-dru-mobile', '')

  const ownedParts = new Map()
  const parts = new Map()
  const cleanups = []
  const historyKey = '__dshMobilePanel'
  const historyId = crypto.randomUUID?.() ?? `dru-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let disposed = false
  let scheduled = 0
  let warningTimer = 0
  let focusTimer = 0
  let syncCount = 0
  let missing = []
  let lastMissing = ''
  let overlay = null
  let historyClosing = false
  let focusReturn = null
  let centerWasInert = false
  let baselineWidth = window.innerWidth
  let baselineHeight = window.visualViewport?.height ?? window.innerHeight
  let keyboardOpen = false
  let gesture = null
  let suppressClickUntil = 0
  let currentFrame = null
  let currentCenter = null
  let currentHeader = null

  const listen = (target, type, listener, options) => {
    target.addEventListener(type, listener, options)
    cleanups.push(() => target.removeEventListener(type, listener, options))
  }
  const mark = (element, part) => {
    if (!element) return
    const tokens = (element.getAttribute('data-dru-part') ?? '').split(/\s+/).filter(Boolean)
    if (!tokens.includes(part)) {
      setAttribute(element, 'data-dru-part', [...tokens, part].join(' '))
      const owned = ownedParts.get(element) ?? new Set()
      owned.add(part)
      ownedParts.set(element, owned)
    }
  }
  const unmark = (element, part) => {
    const owned = ownedParts.get(element)
    if (!owned?.has(part)) return
    const tokens = (element.getAttribute('data-dru-part') ?? '').split(/\s+/).filter((token) => token && token !== part)
    if (tokens.length) setAttribute(element, 'data-dru-part', tokens.join(' '))
    else element.removeAttribute('data-dru-part')
    owned.delete(part)
    if (!owned.size) ownedParts.delete(element)
  }
  const assignPart = (part, element) => {
    const previous = parts.get(part)
    if (previous !== element) {
      if (previous) unmark(previous, part)
      if (element) parts.set(part, element)
      else parts.delete(part)
    }
    mark(element, part)
  }
  const findAction = (action) => {
    const labels = ACTIONS[action]
    const scopes = [parts.get('sidebar'), parts.get('rightbar'), parts.get('header')].filter(Boolean)
    for (const scope of scopes) {
      if (action === 'closeRightbar') {
        const toggle = scope.querySelector('button[data-sidebar-right-toggle]')
        if (toggle) return toggle
      }
      const button = [...scope.querySelectorAll('button[aria-label], button[title]')].find((candidate) =>
        !candidate.classList.contains('dru-mobile-launcher') &&
        labels.some((label) => candidate.getAttribute('aria-label') === label || candidate.getAttribute('title') === label)
      )
      if (button) return button
    }
    return null
  }
  const clickAction = (action) => {
    const button = findAction(action)
    button?.click()
    schedule()
    return Boolean(button)
  }
  const closePanels = () => {
    if (root.classList.contains('dru-drawer-open') && !root.classList.contains('dru-sidebar-docked')) clickAction('closeSidebar')
    if (root.classList.contains('dru-right-open')) clickAction('closeRightbar')
    schedule()
  }

  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.className = 'dru-mobile-launcher'
  launcher.setAttribute('aria-label', '打开导航')
  launcher.setAttribute('aria-expanded', 'false')
  const launcherIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [name, value] of Object.entries({ width: '22', height: '22', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' })) launcherIcon.setAttribute(name, value)
  const launcherPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  for (const [name, value] of Object.entries({ d: 'M4 6h16M4 12h16M4 18h16', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' })) launcherPath.setAttribute(name, value)
  launcherIcon.appendChild(launcherPath)
  launcher.appendChild(launcherIcon)
  listen(launcher, 'click', () => clickAction('openSidebar'))
  body.appendChild(launcher)
  const backdrop = document.createElement('button')
  backdrop.type = 'button'
  backdrop.className = 'dru-mobile-backdrop'
  backdrop.setAttribute('aria-label', '关闭导航或工具面板')
  backdrop.tabIndex = -1
  backdrop.hidden = true
  listen(backdrop, 'click', closePanels)
  body.appendChild(backdrop)
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'dru-mobile-panel-close'
  closeButton.setAttribute('aria-label', '关闭工具面板')
  closeButton.textContent = '×'
  closeButton.hidden = true
  listen(closeButton, 'click', () => clickAction('closeRightbar'))
  body.appendChild(closeButton)

  const frameWatch = new MutationObserver(() => schedule())
  const structureWatch = new MutationObserver(() => schedule())
  const centerWatch = new MutationObserver(() => schedule())
  const resizeWatch = new ResizeObserver(() => schedule())
  const portalWatch = new MutationObserver(() => schedule())
  const bodyWatch = new MutationObserver(() => schedule())
  bodyWatch.observe(body, { childList: true })
  const bootstrapWatch = new MutationObserver(() => schedule())
  bootstrapWatch.observe(body, { childList: true, subtree: true })

  function schedule() {
    if (!disposed && !scheduled) scheduled = requestAnimationFrame(sync)
  }

  function updateViewport() {
    const visual = window.visualViewport
    if (visual && Math.abs(visual.scale - 1) > 0.05) return
    const width = document.documentElement.clientWidth || window.innerWidth
    const height = Math.round(visual?.height ?? window.innerHeight)
    const top = Math.max(0, Math.round(visual?.offsetTop ?? 0))
    const focused = Boolean(editableElement(document.activeElement))
    if (Math.abs(width - baselineWidth) > 64) {
      baselineWidth = width
      baselineHeight = Math.max(height, window.innerHeight)
    }
    if (!focused) baselineHeight = Math.max(baselineHeight, height)
    const gap = Math.max(0, window.innerHeight - height - top)
    keyboardOpen = focused && (gap > 90 || baselineHeight - height > 130)
    root.classList.toggle('dru-keyboard-open', keyboardOpen)
    setAttribute(root, 'data-dru-layout', width > 640 ? 'expanded' : 'compact')
    setProperty(root, '--dru-vh', `${height}px`)
    setProperty(root, '--dru-vtop', `${top}px`)
    setProperty(root, '--dru-kb', `${gap}px`)
  }

  function bindShell(frame, center, header) {
    if (currentFrame !== frame) {
      frameWatch.disconnect()
      structureWatch.disconnect()
      currentFrame = frame
      if (frame) {
        frame.appendChild(backdrop)
        frame.appendChild(closeButton)
        bootstrapWatch.disconnect()
        frameWatch.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'], childList: true })
        let ancestor = frame.parentElement
        while (ancestor && ancestor !== body) {
          structureWatch.observe(ancestor, { childList: true })
          ancestor = ancestor.parentElement
        }
      } else bootstrapWatch.observe(body, { childList: true, subtree: true })
    }
    if (currentCenter !== center) {
      centerWatch.disconnect()
      currentCenter = center
      if (center) centerWatch.observe(center, { childList: true })
    }
    if (currentHeader !== header) {
      resizeWatch.disconnect()
      currentHeader = header
      if (frame) resizeWatch.observe(frame)
      if (header) resizeWatch.observe(header)
    }
  }

  function probe() {
    const frame = document.querySelector(SELECTORS.frame)
    const center = frame?.querySelector(SELECTORS.center) ?? null
    const sidebar = frame?.querySelector(SELECTORS.sidebar) ?? null
    const rightbar = frame?.querySelector(SELECTORS.rightbar) ?? null
    const header = center?.querySelector(SELECTORS.header) ?? null
    assignPart('frame', frame)
    assignPart('center', center)
    assignPart('sidebar', sidebar)
    assignPart('rightbar', rightbar)
    assignPart('header', header)
    for (const part of ['header-leading', 'header-actions', 'header-utilities', 'title-row', 'title-cluster', 'header-corner', 'crumbs', 'tabs']) {
      assignPart(part, header?.querySelector(SELECTORS[part]) ?? null)
    }
    const textbox = center?.querySelector('[role="textbox"][contenteditable="true"]')
    assignPart('composer', textbox?.closest(SELECTORS.composer) ?? null)
    assignPart('chat-scroll', center?.querySelector(SELECTORS['chat-scroll']) ?? null)
    bindShell(frame, center, header)
    missing = ['frame', 'center', 'sidebar'].filter((part) => !parts.get(part))
    const template = frame?.style.getPropertyValue('grid-template-columns') ?? ''
    if (frame && !/^\s*[\d.]+px\s/.test(template)) missing.push('frame-columns')
    setAttribute(root, 'data-dru-skin-state', missing.length ? 'partial' : 'ready')
    const warning = missing.join(',')
    if (warning !== lastMissing) {
      lastMissing = warning
      clearTimeout(warningTimer)
      if (warning) warningTimer = setTimeout(() => {
        if (!disposed && missing.length) console.warn(`[dsh-mobile-harness] mobile skin ${MOBILE_SKIN_VERSION}: layout adapter unavailable (${missing.join(', ')}); native layout retained`)
      }, 4000)
    }
    return { template, width: root.clientWidth }
  }

  function syncPortals() {
    portalWatch.disconnect()
    for (const child of body.children) {
      if (child === launcher || child === backdrop || child === closeButton || child.contains(currentFrame) || child === currentFrame || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue
      portalWatch.observe(child, { childList: true, subtree: true })
    }
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const nav = [...dialog.children].find((child) => child.tagName === 'NAV')
      if (!nav) continue
      mark(dialog, 'settings-dialog')
      mark(nav, 'settings-nav')
      mark(nav.querySelector('[class*="_navList"]'), 'settings-nav-list')
      for (const cell of nav.querySelectorAll('[class*="_navCell"]')) mark(cell, 'settings-nav-cell')
      for (const child of dialog.children) if (child !== nav) mark(child, 'settings-content')
    }
    for (const menu of document.querySelectorAll('[role="menu"], [role="listbox"], [role="tree"][aria-label], ul[aria-label]')) {
      if (currentFrame?.contains(menu) && !menu.matches('[role="menu"], [role="listbox"]')) continue
      let surface = menu
      let ancestor = menu.parentElement
      while (ancestor && ancestor !== body && !ancestor.contains(currentFrame)) {
        if (ancestor.matches('[role="dialog"]')) break
        if (ancestor.matches('[class*="_menu"], [class*="-menu"]')) surface = ancestor
        ancestor = ancestor.parentElement
      }
      mark(surface, 'menu')
    }
    for (const [element] of ownedParts) if (!element.isConnected) ownedParts.delete(element)
  }

  function syncOverlay(next) {
    if (overlay === next) return
    const previous = overlay
    overlay = next
    root.classList.toggle('dru-overlay-open', Boolean(next))
    backdrop.hidden = !next
    closeButton.hidden = next !== 'rightbar'
    const center = parts.get('center')
    if (next && !previous) {
      focusReturn = document.activeElement
      centerWasInert = Boolean(center?.inert)
      if (center) center.inert = true
      if (history.state?.[historyKey] !== historyId && !historyClosing) {
        history.pushState({ ...(history.state ?? {}), [historyKey]: historyId }, '', location.href)
      }
    } else if (!next && previous) {
      if (center) center.inert = centerWasInert
      if (history.state?.[historyKey] === historyId && !historyClosing) {
        historyClosing = true
        history.back()
      }
      if (focusReturn instanceof HTMLElement && focusReturn.isConnected && !focusReturn.closest('[inert]') && !editableElement(focusReturn)) focusReturn.focus({ preventScroll: true })
      focusReturn = null
    }
    if (next) {
      const panel = parts.get(next === 'sidebar' ? 'sidebar' : 'rightbar')
      if (panel instanceof HTMLElement) {
        if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1
        panel.focus({ preventScroll: true })
      }
    }
  }

  function sync() {
    scheduled = 0
    if (disposed) return
    syncCount += 1
    updateViewport()
    const { template, width } = probe()
    const sidebarWidth = Number(template.match(/^\s*([\d.]+)px/)?.[1] ?? 0)
    const pixelValues = [...template.matchAll(/([\d.]+)px/g)]
    const rightWidth = Number(pixelValues.at(-1)?.[1] ?? 0)
    const ready = missing.length === 0
    const drawerOpen = ready && sidebarWidth > 90
    const rightOpen = ready && (rightWidth > 90 || parts.get('frame')?.hasAttribute('data-rightbar-fullscreen'))
    const docked = drawerOpen && width >= 1040
    root.classList.toggle('dru-drawer-open', drawerOpen)
    root.classList.toggle('dru-sidebar-docked', docked)
    root.classList.toggle('dru-right-open', rightOpen)
    launcher.hidden = !ready || width > 640
    launcher.disabled = !findAction('openSidebar')
    launcher.setAttribute('aria-expanded', String(drawerOpen))
    if (!rightOpen && drawerOpen && !docked) syncOverlay('sidebar')
    else if (rightOpen) syncOverlay('rightbar')
    else syncOverlay(null)
    const header = parts.get('header')
    if (header) setProperty(root, '--dru-header-height', `${Math.round(header.getBoundingClientRect().bottom)}px`)
    syncPortals()
  }

  const revealEditable = () => {
    const editable = editableElement(document.activeElement)
    if (!editable) return
    const bounds = editable.getBoundingClientRect()
    const visual = window.visualViewport
    const bottom = (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight)
    if (bounds.bottom > bottom - 12 || bounds.top < (visual?.offsetTop ?? 0)) editable.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  }
  listen(window, 'resize', schedule)
  listen(window, 'orientationchange', schedule)
  if (window.visualViewport) {
    listen(window.visualViewport, 'resize', schedule)
    listen(window.visualViewport, 'scroll', schedule)
  }
  listen(document, 'focusin', (event) => {
    if (!editableElement(event.target)) return
    schedule()
    clearTimeout(focusTimer)
    focusTimer = setTimeout(revealEditable, 180)
  }, true)
  listen(document, 'focusout', schedule, true)
  listen(window, 'popstate', () => {
    if (overlay) {
      historyClosing = true
      closePanels()
    }
    historyClosing = false
    schedule()
  })
  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && overlay) {
      event.preventDefault()
      closePanels()
      return
    }
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !isComposer(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    event.target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true }))
  }, true)
  listen(document, 'dblclick', (event) => {
    if (!(event.target instanceof Element) || editableElement(event.target) || !event.target.closest('[role="treeitem"][data-row-key^="session:"], [class*="_sessionRow"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  listen(document, 'click', (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (!(event.target instanceof Element) || overlay !== 'sidebar') return
    const row = event.target.closest('[role="treeitem"][data-row-key^="session:"], [class*="_sessionRow"]')
    if (!row || event.target.closest('[class*="_rowActions"], [aria-haspopup], input, textarea, [contenteditable="true"]')) return
    requestAnimationFrame(() => { if (!disposed) closePanels() })
  }, true)
  const trackedTouch = (list) => gesture ? [...list].find((touch) => touch.identifier === gesture.touchId) : undefined
  listen(document, 'touchstart', (event) => {
    gesture = null
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1.05 || !(event.target instanceof Element)) return
    if (event.target.closest('input, textarea, [contenteditable], pre, code, table, [role="dialog"], [role="menu"]')) return
    const touch = event.touches[0]
    const opening = !overlay && touch.clientX <= EDGE_SWIPE_ZONE
    const closing = overlay === 'sidebar' && event.target.closest('[data-dru-part~="sidebar"]')
    if (opening || closing) gesture = { touchId: touch.identifier, startX: touch.clientX, startY: touch.clientY, opening: Boolean(opening), horizontal: false }
  }, { passive: true })
  listen(document, 'touchmove', (event) => {
    const touch = trackedTouch(event.touches)
    if (!touch) return
    const horizontal = touch.clientX - gesture.startX
    const vertical = touch.clientY - gesture.startY
    if (Math.abs(vertical) > 32 && !gesture.horizontal) { gesture = null; return }
    if (Math.abs(horizontal) > 14 && Math.abs(horizontal) > Math.abs(vertical) * 1.6) gesture.horizontal = true
    if (gesture.horizontal && event.cancelable) event.preventDefault()
  }, { passive: false })
  listen(document, 'touchend', (event) => {
    const touch = trackedTouch(event.changedTouches)
    if (!touch) return
    const horizontal = touch.clientX - gesture.startX
    const vertical = touch.clientY - gesture.startY
    if (gesture.horizontal && Math.abs(vertical) < 56 && ((gesture.opening && horizontal > 56) || (!gesture.opening && horizontal < -56))) {
      if (gesture.opening) clickAction('openSidebar')
      else closePanels()
      suppressClickUntil = Date.now() + 350
      if (event.cancelable) event.preventDefault()
    }
    gesture = null
  })
  listen(document, 'touchcancel', () => { gesture = null })
  sync()

  return {
    refresh: schedule,
    getState: () => ({ active: true, version: MOBILE_SKIN_VERSION, layout: root.getAttribute('data-dru-layout'), compatibility: root.getAttribute('data-dru-skin-state'), missing: [...missing], keyboardOpen, overlay, syncCount, viewport: { width: root.clientWidth, height: window.visualViewport?.height ?? window.innerHeight } }),
    dispose() {
      disposed = true
      cancelAnimationFrame(scheduled)
      clearTimeout(warningTimer)
      clearTimeout(focusTimer)
      frameWatch.disconnect()
      structureWatch.disconnect()
      centerWatch.disconnect()
      resizeWatch.disconnect()
      portalWatch.disconnect()
      bodyWatch.disconnect()
      bootstrapWatch.disconnect()
      for (const cleanup of cleanups) cleanup()
      if (overlay && parts.get('center')) parts.get('center').inert = centerWasInert
      if (history.state?.[historyKey] === historyId) {
        const state = { ...history.state }
        delete state[historyKey]
        history.replaceState(state, '', location.href)
      }
      for (const [element, owned] of [...ownedParts]) for (const part of [...owned]) unmark(element, part)
      root.classList.remove('dru-drawer-open', 'dru-right-open', 'dru-sidebar-docked', 'dru-keyboard-open', 'dru-overlay-open')
      for (const attribute of ['data-dru-mobile', 'data-dru-layout', 'data-dru-skin-state']) root.removeAttribute(attribute)
      for (const property of ['--dru-vh', '--dru-vtop', '--dru-kb', '--dru-header-height']) root.style.removeProperty(property)
      launcher.remove()
      backdrop.remove()
      closeButton.remove()
      style.remove()
      if (originalViewport) {
        if (previousViewport === null) originalViewport.removeAttribute('content')
        else originalViewport.setAttribute('content', previousViewport)
      } else viewport.remove()
    }
  }
}

return { installMobileSkin, MOBILE_SKIN_VERSION }
  }
})
