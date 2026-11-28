globalThis.__ModuleLoader__.load({
  id: 'dsh-mobile-harness',
  chunk: 'client.mobile-styles.js',
  factory() {
    const MOBILE_CSS = String.raw`
html[data-dru-mobile] {
  --dru-rail-width: calc(64px + env(safe-area-inset-left));
  --dru-docked-sidebar-width: calc(272px + env(safe-area-inset-left));
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  overscroll-behavior: none;
  scroll-padding-block-end: calc(env(safe-area-inset-bottom) + 16px);
}

html[data-dru-mobile] body {
  --dru-surface: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, Canvas));
  --dru-surface-raised: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, Canvas));
  --dru-sidebar-surface: var(--dsw-specific-sidebar-fill, var(--dru-surface));
  --dru-border: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 18%, transparent));
  --dru-text: var(--dsw-alias-label-primary, CanvasText);
  --dru-muted: var(--dsw-alias-label-secondary, GrayText);
  --dru-accent: var(--dsw-alias-state-business-primary, Highlight);
  --dru-panel-shadow: 0 16px 48px rgba(0, 0, 0, .22);
  color: var(--dru-text);
  -webkit-tap-highlight-color: transparent;
}

html[data-dru-mobile] :is(input, textarea, select, [role="textbox"][contenteditable]) {
  font-size: 16px !important;
  scroll-margin-block: 12px calc(env(safe-area-inset-bottom) + 20px);
}

html[data-dru-mobile] :focus-visible {
  outline: 2px solid var(--dru-accent);
  outline-offset: 2px;
}

html[data-dru-mobile].dru-keyboard-open .dshwv-root {
  display: none !important;
}

html[data-dru-mobile] [hidden],
html[data-dru-mobile] .dru-mobile-backdrop[hidden],
html[data-dru-mobile] .dru-mobile-panel-close[hidden] {
  display: none !important;
}

html[data-dru-mobile][data-dru-skin-state="partial"] :is(button, [role="button"], [role="menuitem"]) {
  min-block-size: 44px;
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="frame"] {
  position: fixed !important;
  inset-block-start: var(--dru-vtop, 0px);
  inset-inline: 0;
  box-sizing: border-box;
  inline-size: 100%;
  block-size: var(--dru-vh, 100dvh) !important;
  min-block-size: 0 !important;
  max-block-size: var(--dru-vh, 100dvh);
  min-inline-size: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  --dsh-frame-leading-clearance: 0px;
  overflow: hidden;
  overscroll-behavior: none;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="frame"] > [class*="_handle"] {
  display: none !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="center"] {
  display: flex;
  grid-column: 2;
  grid-row: 1;
  flex-direction: column;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] {
  position: relative;
  z-index: 4;
  box-sizing: border-box;
  flex: 0 0 auto;
  inline-size: 100%;
  max-inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 0 !important;
  padding-block: calc(4px + env(safe-area-inset-top)) 6px;
  padding-inline: max(10px, env(safe-area-inset-left)) max(10px, env(safe-area-inset-right));
  border-block-end: 1px solid var(--dru-border);
  background: color-mix(in srgb, var(--dru-surface) 96%, transparent);
  -webkit-backdrop-filter: saturate(1.12) blur(14px);
  backdrop-filter: saturate(1.12) blur(14px);
  -webkit-app-region: no-drag;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="title-row"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="title-cluster"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-leading"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-actions"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-corner"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="tabs"] {
  min-inline-size: 0;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  gap: 4px;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] > *,
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] [data-slot] > * {
  flex: 0 0 auto;
  white-space: nowrap;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] button {
  white-space: nowrap;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-corner"] {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
  gap: 4px;
  min-block-size: 44px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"] :is([class*="_split"], [class*="_menuA"]),
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] :is([aria-label*="访达"], [aria-label*="资源管理器"], [aria-label*="Finder"], [aria-label*="File Explorer"]) {
  display: none !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-corner"]:empty,
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-leading"]:not(:has(> :not([data-slot]), [data-slot] > *)) {
  display: none;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-corner"] {
  margin-inline-end: 0 !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] button {
  min-inline-size: 44px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="crumbs"] {
  display: flex;
  align-items: center;
  min-inline-size: 0;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="crumbs"] > * {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="tabs"] {
  min-block-size: 44px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="tabs"] [role="tablist"] {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  min-inline-size: max-content;
  min-block-size: 44px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="tabs"] [role="tab"] {
  flex: 0 0 auto;
  min-block-size: 40px;
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="chat-scroll"] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] {
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-padding-block: 12px calc(env(safe-area-inset-bottom) + 20px);
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] :where(p, li, blockquote) {
  font-size: 16px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] :where(a, p, li, blockquote) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] pre {
  max-inline-size: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.55;
  touch-action: pan-x pan-y;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] pre code {
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] :where(table) {
  display: block;
  max-inline-size: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] :where(th, td) {
  overflow-wrap: anywhere;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] :where(img, video, svg) {
  max-inline-size: 100%;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="composer"] {
  position: relative;
  z-index: 7;
  flex: 0 0 auto;
  min-inline-size: 0;
  padding-inline: max(12px, env(safe-area-inset-left)) max(12px, env(safe-area-inset-right));
  padding-block-end: calc(8px + env(safe-area-inset-bottom));
  scroll-margin-block-end: calc(env(safe-area-inset-bottom) + 20px);
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="composer"] :is(button, [role="button"]) {
  min-inline-size: 44px;
  min-block-size: 44px;
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="sidebar"]:focus,
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"]:focus {
  outline: 0;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="sidebar"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] {
  min-inline-size: 0;
  min-block-size: 0;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] [data-sidebar-right-panel] {
  width: 100% !important;
  max-width: 100% !important;
  --dsh-sidebar-width: 100% !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="sidebar"] :is(button, [role="button"], [role="menuitem"]),
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] :is(button:not(button button), [role="button"]:not(button [role="button"]), [role="menuitem"]),
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] :is(button, [role="button"]),
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="menu"] :is(button, [role="button"], [role="menuitem"]) {
  min-block-size: 44px;
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="menu"],
html[data-dru-mobile][data-dru-skin-state="ready"] [role="menu"],
html[data-dru-mobile][data-dru-skin-state="ready"] [role="listbox"] {
  box-sizing: border-box;
  max-inline-size: calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right));
  max-block-size: min(72vh, calc(var(--dru-vh, 100dvh) - var(--dru-header-height, 64px) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px));
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"] {
  box-sizing: border-box;
  color: var(--dru-text);
  border-color: var(--dru-border);
  overscroll-behavior: contain;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"] [role="dialog"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"][role="dialog"] {
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 0;
  color: var(--dru-text);
  border-color: var(--dru-border);
  background: var(--dsw-alias-bg-layer-2, var(--dru-surface));
  box-shadow: var(--dru-panel-shadow);
  overscroll-behavior: contain;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-nav"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] {
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--dru-border) transparent;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] > :last-child {
  scrollbar-width: none;
  flex: 1 1 auto;
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-nav"] :is(button, [role="button"], [role="tab"]),
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] :is(button, [role="button"]) {
  min-block-size: 44px;
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-shell-overlay] {
  z-index: 20;
}

html[data-dru-mobile][data-dru-skin-state="ready"] .dru-mobile-launcher {
  position: fixed;
  inset-block-start: calc(8px + env(safe-area-inset-top));
  inset-inline-start: calc(8px + env(safe-area-inset-left));
  z-index: 26;
  display: inline-grid;
  place-items: center;
  box-sizing: border-box;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: 1px solid var(--dru-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--dru-surface-raised) 94%, transparent);
  color: var(--dru-text);
  box-shadow: 0 4px 16px rgba(0, 0, 0, .14);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-skin-state="ready"] .dru-mobile-launcher :is(svg, img) {
  display: block;
  inline-size: 22px;
  block-size: 22px;
  max-inline-size: 100%;
  color: currentColor;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"]:has([data-sidebar-right-toggle]) ~ .dru-mobile-panel-close {
  display: none !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] :is([data-sidebar-right-toggle], [data-sidebar-right-mode]) {
  position: relative;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] :is([data-sidebar-right-toggle], [data-sidebar-right-mode])::after {
  content: "";
  position: absolute;
  inset: -8px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] [class*="_titleRow"] button {
  position: relative;
  min-block-size: 0 !important;
  block-size: auto;
  min-inline-size: 24px !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] [class*="_titleRow"] button::after {
  content: "";
  position: absolute;
  inset: -12px -10px;
}

/* Opaque mobile menu material keeps underlying chat legible and prevents visual bleed-through. */
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] [role="menu"][data-menu-material] > [class*="_material"] {
  background: var(--dru-surface-raised) !important;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="menu"] [role="menuitem"] {
  display: flex;
  align-items: center;
}

html[data-dru-mobile][data-dru-skin-state="ready"] .dru-mobile-backdrop {
  position: fixed;
  z-index: 10;
  inset: 0;
  display: block;
  inline-size: 100%;
  block-size: var(--dru-vh, 100dvh);
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, .42);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

html[data-dru-mobile][data-dru-skin-state="ready"] .dru-mobile-panel-close {
  position: fixed;
  z-index: 14;
  inset-block-start: calc(8px + env(safe-area-inset-top));
  inset-inline-end: calc(8px + env(safe-area-inset-right));
  display: none;
  place-items: center;
  box-sizing: border-box;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: 1px solid var(--dru-border);
  border-radius: 14px;
  background: var(--dru-surface-raised);
  color: var(--dru-text);
  box-shadow: 0 4px 16px rgba(0, 0, 0, .14);
  touch-action: manipulation;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="frame"] {
  grid-template-columns: 0 minmax(0, 1fr) 0 !important;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="sidebar"],
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] {
  display: none;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"] {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(0, .92fr) auto auto;
  grid-template-rows: minmax(36px, auto) minmax(40px, auto);
  align-content: start;
  column-gap: 4px;
  row-gap: 4px;
  padding-block: calc(6px + env(safe-area-inset-top)) 6px;
  padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right));
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="title-row"],
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="title-cluster"] {
  display: contents;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header-leading"] {
  grid-row: 1;
  grid-column: 1;
  align-items: center;
  margin-inline-start: 52px;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="crumbs"] {
  grid-row: 1;
  grid-column: 1 / 3;
  padding-inline-start: 52px;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"] {
  grid-row: 1;
  grid-column: 3;
  margin-inline-start: 0 !important;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header-corner"] {
  grid-row: 1;
  grid-column: 4;
  margin-inline: 0 !important;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] {
  grid-row: 2;
  grid-column: 1;
  justify-content: flex-start;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="tabs"] {
  grid-row: 2;
  grid-column: 2 / 5;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"] > :not([data-slot]), [data-dru-part~="header-leading"] [data-slot] > *) {
  grid-template-columns: minmax(88px, .72fr) minmax(0, 1fr) auto auto;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"] > :not([data-slot]), [data-dru-part~="header-leading"] [data-slot] > *) [data-dru-part~="crumbs"] {
  grid-column: 2 / 3;
  padding-inline-start: 0;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"] > :not([data-slot]), [data-dru-part~="header-leading"] [data-slot] > *) [data-dru-part~="header-actions"] {
  grid-column: 1 / 3;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"] > :not([data-slot]), [data-dru-part~="header-leading"] [data-slot] > *) [data-dru-part~="tabs"] {
  grid-column: 3 / 5;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] button,
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"] button {
  min-inline-size: 44px;
  min-block-size: 44px;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="sidebar"] {
  position: fixed !important;
  z-index: 12;
  inset-block-start: var(--dru-vtop, 0px);
  inset-inline-start: 0;
  box-sizing: border-box;
  flex-direction: column;
  inline-size: min(340px, 88vw) !important;
  max-inline-size: calc(100vw - 56px);
  block-size: var(--dru-vh, 100dvh);
  padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
  border-inline-end: 1px solid var(--dru-border);
  background: var(--dru-sidebar-surface);
  box-shadow: var(--dru-panel-shadow);
  overflow: auto;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] {
  position: fixed !important;
  z-index: 12;
  inset-block-start: var(--dru-vtop, 0px);
  inset-inline: 0;
  box-sizing: border-box;
  flex-direction: column;
  inline-size: 100% !important;
  max-inline-size: none !important;
  block-size: var(--dru-vh, 100dvh);
  padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
  background: var(--dru-surface);
  box-shadow: var(--dru-panel-shadow);
  overflow: auto;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"],
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-right-open [data-dru-part~="rightbar"] {
  display: flex !important;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-drawer-open .dru-mobile-launcher,
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-right-open .dru-mobile-launcher {
  opacity: 0;
  pointer-events: none;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-drawer-open .dru-mobile-panel-close,
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-right-open .dru-mobile-panel-close {
  display: inline-grid;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"] {
  position: fixed !important;
  z-index: 1000;
  inset-block-start: var(--dru-vtop, 0px) !important;
  inset-inline: 0 !important;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  inline-size: 100% !important;
  max-inline-size: 100% !important;
  block-size: var(--dru-vh, 100dvh) !important;
  max-block-size: var(--dru-vh, 100dvh) !important;
  min-inline-size: 0 !important;
  min-block-size: 0 !important;
  padding: 0;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"] [role="dialog"],
html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"][role="dialog"] {
  display: flex;
  flex-direction: column;
  inline-size: 100% !important;
  max-inline-size: 100% !important;
  block-size: 100% !important;
  max-block-size: 100% !important;
  min-inline-size: 0 !important;
  min-block-size: 0 !important;
  border-radius: 0 !important;
  box-shadow: none;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-nav"] {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  inline-size: 100% !important;
  max-block-size: none;
  gap: 4px;
  padding: calc(8px + env(safe-area-inset-top)) 12px 8px !important;
  border-inline-end: 0;
  border-block-end: 1px solid var(--dru-border);
  overflow: hidden;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-nav-list"] {
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  gap: 6px;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-nav-cell"] {
  flex: 0 0 auto;
  min-inline-size: max-content;
  min-block-size: 44px;
  padding-inline: 12px;
  white-space: nowrap;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] > [class*="_header"] {
  min-block-size: 0;
  block-size: auto !important;
  padding: 0 !important;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] [class*="_close"] {
  position: fixed;
  z-index: 6;
  inset-block-start: calc(env(safe-area-inset-top) + 2px);
  inset-inline-end: max(6px, env(safe-area-inset-right));
  min-inline-size: 44px;
  min-block-size: 44px;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] [class*="_options"] {
  padding-inline: 0 !important;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] {
  flex: 1 1 auto;
  inline-size: 100% !important;
  max-inline-size: 100% !important;
  padding: 14px max(16px, env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) !important;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_logoRow"] {
  box-sizing: border-box;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] > * > [style*="width"] {
  inline-size: 100% !important;
  min-inline-size: 0;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_logoRow"] {
  block-size: 48px !important;
  margin: 0 !important;
  padding-block: 0 !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] button[class*="_newSession"] {
  block-size: 40px;
  min-block-size: 40px;
  margin-block: 0 6px !important;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_panelList"] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 2px;
  margin-block-end: 4px;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_panelList"] > *,
html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_moreAnchor"] > button {
  min-inline-size: 0;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_panelRow"] {
  box-sizing: border-box;
  inline-size: 100%;
  block-size: 40px;
  min-block-size: 40px;
  margin: 0;
  padding-block: 0;
  padding-inline: 8px;
  gap: 6px;
  font-size: 13px;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_regionArea"] {
  flex: 1 1 0;
  min-block-size: 160px;
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-drawer-open [data-dru-part~="sidebar"] [class*="_footArea"] {
  flex: none;
}

/* Compact the resting composer without reducing the 44px main touch targets. */
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="composer"] {
  padding-block-end: calc(4px + env(safe-area-inset-bottom));
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-testid="todo-panel"] > div {
  padding-block: 0;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-testid="todo-panel"] > div > button {
  min-block-size: 44px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-card] {
  gap: 2px;
  padding-block-start: 4px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-card] > [class*="_row"] {
  padding-block: 0 2px;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] {
  gap: 4px;
  padding-block-start: 0;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] :is(button, [role="button"]) {
  min-block-size: 32px;
  block-size: 32px;
}

@media (max-width: 640px) {
  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] {
    gap: 2px;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] button {
    padding-inline: 3px;
    font-size: 11px;
    gap: 0;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] [data-slot="conversation.composer.dock"] {
    display: contents;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] :is([data-composer-stat], span:has(> button[aria-haspopup="dialog"])) {
    flex: 0 0 auto;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="composer"] [data-composer-dock] button {
    min-inline-size: 0;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] {
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-stat] button > svg {
    display: none;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-stat] [class*="_sep"] {
    margin-inline: 2px;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-composer-dock] > span[class*="_root"] > button > svg {
    display: none;
  }
}

@media (max-height: 700px) {
  html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="tabs"],
  html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="tabs"] [role="tablist"] {
    min-block-size: 40px;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] {
    padding-block-end: 2px;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] [data-dru-part~="tabs"] :is(button, [role="tab"]) {
    min-block-size: 40px;
    block-size: 40px;
  }
}

@media (max-height: 520px) {
  html[data-dru-mobile][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="tabs"],
  html[data-dru-mobile][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="composer"] [class*="_composerStack"] section,
  html[data-dru-mobile][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="composer"] div[class*="_dock"] {
    display: none !important;
  }

  html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="header-actions"] {
    display: none !important;
  }

  html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="header"] {
    grid-template-rows: minmax(36px, auto);
  }
}

/* Inner screens keep session navigation on one row; actions retain their native triggers. */
@media (min-width: 641px) and (max-width: 900px) {
  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header"] {
    display: grid !important;
    grid-template-columns: auto minmax(90px, 1fr) auto auto auto auto;
    grid-template-rows: minmax(44px, auto);
    align-content: start;
    column-gap: 4px;
    row-gap: 2px;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] :is([data-dru-part~="title-row"], [data-dru-part~="title-cluster"]) {
    display: contents;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-leading"] {
    grid-row: 1;
    grid-column: 1;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="crumbs"] {
    grid-row: 1;
    grid-column: 2;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"] {
    grid-row: 1;
    grid-column: 5;
    margin-inline-start: 0 !important;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-corner"] {
    grid-row: 1;
    grid-column: 6;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] {
    grid-row: 1;
    grid-column: 3;
    max-inline-size: 132px;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] [data-slot] > span[title]:has(> svg) {
    display: none;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] button {
    justify-content: center;
    box-sizing: border-box;
    inline-size: 40px;
    min-inline-size: 40px;
    padding-inline: 4px;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] button > span {
    display: none;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] button[aria-haspopup="tree"]::before {
    content: "";
    inline-size: 18px;
    block-size: 18px;
    background: currentColor;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cg fill='none' stroke='black' stroke-width='1.5'%3E%3Crect x='7' y='1.5' width='6' height='5' rx='1'/%3E%3Crect x='1.5' y='13.5' width='6' height='5' rx='1'/%3E%3Crect x='12.5' y='13.5' width='6' height='5' rx='1'/%3E%3Cpath d='M10 6.5v4H4.5v3m5.5-3h5.5v3'/%3E%3C/g%3E%3C/svg%3E") center / contain no-repeat;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] button[aria-haspopup="tree"] > svg {
    display: none;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="tabs"] {
    grid-row: 1;
    grid-column: 4;
    inline-size: auto;
    max-inline-size: 116px;
    min-block-size: 44px;
    margin: 0;
    padding: 0;
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="tabs"] [role="tablist"] {
    min-block-size: 44px;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="tabs"] :is([role="tab"], button[aria-haspopup="menu"]) {
    box-sizing: border-box;
    margin: 0;
    block-size: 44px;
    min-block-size: 44px;
    padding-block: 0;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="tabs"] [class*="_viewsMoreAnchor"] {
    margin: 0;
  }
}

@media (min-width: 641px) and (max-width: 900px) and (max-height: 520px) {
  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="header-actions"] {
    display: none !important;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-keyboard-open [data-dru-part~="header"] {
    grid-template-rows: minmax(44px, auto);
  }
}

@media (min-width: 641px) and (any-pointer: coarse) {
html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] .dru-mobile-launcher {
  display: none !important;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="frame"] {
  grid-template-columns: var(--dru-rail-width) minmax(0, 1fr) 0 !important;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="sidebar"] {
  display: flex;
  grid-column: 1;
  grid-row: 1;
  inline-size: var(--dru-rail-width);
  min-inline-size: var(--dru-rail-width);
  max-inline-size: var(--dru-rail-width);
  block-size: 100%;
  padding-inline-start: env(safe-area-inset-left);
  padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
  overflow: hidden;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] {
  display: none;
  grid-column: 3;
  grid-row: 1;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-drawer-open.dru-sidebar-docked [data-dru-part~="frame"] {
  grid-template-columns: var(--dru-docked-sidebar-width) minmax(0, 1fr) 0 !important;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-sidebar-docked [data-dru-part~="sidebar"] {
  position: relative !important;
  inset: auto !important;
  z-index: auto;
  grid-column: 1;
  min-inline-size: 0;
  max-inline-size: none;
  inline-size: var(--dru-docked-sidebar-width) !important;
  block-size: 100%;
  padding-inline-start: env(safe-area-inset-left);
  border-inline-end: 1px solid var(--dru-border);
  background: var(--dru-sidebar-surface);
  box-shadow: none;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-drawer-open.dru-sidebar-docked [data-dru-part~="center"] {
  grid-column: 2;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-drawer-open:not(.dru-sidebar-docked) [data-dru-part~="sidebar"] {
  position: fixed !important;
  z-index: 12;
  inset-block-start: var(--dru-vtop, 0px);
  inset-inline-start: 0;
  box-sizing: border-box;
  display: flex !important;
  flex-direction: column;
  inline-size: min(340px, calc(100vw - 64px)) !important;
  min-inline-size: min(280px, calc(100vw - 64px));
  max-inline-size: calc(100vw - 64px);
  block-size: var(--dru-vh, 100dvh);
  padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
  border-inline-end: 1px solid var(--dru-border);
  background: var(--dru-sidebar-surface);
  box-shadow: var(--dru-panel-shadow);
  overflow: auto;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-right-open [data-dru-part~="rightbar"] {
  position: fixed !important;
  z-index: 12;
  inset-block-start: var(--dru-vtop, 0px);
  inset-inline-end: 0;
  box-sizing: border-box;
  display: flex !important;
  flex-direction: column;
  inline-size: min(52vw, 520px) !important;
  min-inline-size: min(360px, calc(100vw - 64px));
  max-inline-size: calc(100vw - 64px);
  block-size: var(--dru-vh, 100dvh);
  padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
  border-inline-start: 1px solid var(--dru-border);
  background: var(--dru-surface);
  box-shadow: var(--dru-panel-shadow);
  overflow: auto;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-right-open [data-dru-part~="frame"][data-rightbar-fullscreen] [data-dru-part~="rightbar"] {
  inline-size: 100% !important;
  max-inline-size: 100% !important;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-drawer-open:not(.dru-sidebar-docked) .dru-mobile-panel-close,
html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-right-open .dru-mobile-panel-close {
  display: inline-grid;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-drawer-open.dru-sidebar-docked:not(.dru-right-open) .dru-mobile-backdrop {
  display: none !important;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="composer"] {
  padding-inline: max(clamp(16px, 3vw, 56px), env(safe-area-inset-left)) max(clamp(16px, 3vw, 56px), env(safe-area-inset-right));
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"] [role="dialog"],
html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="settings-dialog"][role="dialog"] {
  inline-size: min(920px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right))) !important;
  max-inline-size: min(920px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right))) !important;
  block-size: min(820px, calc(var(--dru-vh, 100dvh) - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom))) !important;
  max-block-size: calc(var(--dru-vh, 100dvh) - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
  min-inline-size: min(640px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right))) !important;
  min-block-size: 0 !important;
  flex-direction: row;
  border-radius: 18px;
  overflow: hidden;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="settings-nav"] {
  flex: 0 0 220px;
  inline-size: 220px;
  max-block-size: 100%;
  overflow: auto;
  border-inline-end: 1px solid var(--dru-border);
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="settings-nav-list"] {
  flex-direction: column;
  min-block-size: 0;
  overflow: auto;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="settings-nav-cell"] {
  flex: 0 0 auto;
  min-block-size: 44px;
}

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] {
  padding: 20px;
}
}

html[data-dru-mobile][data-dru-skin-state="ready"].dru-overlay-open,
html[data-dru-mobile][data-dru-skin-state="ready"].dru-overlay-open body {
  overflow: hidden !important;
  overscroll-behavior: none;
}

@media (max-width: 640px) {
  html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] {
    padding-inline: max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-right)) !important;
  }
}

@media (orientation: landscape) and (max-height: 520px) {
  html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header"] {
    padding-block-start: env(safe-area-inset-top);
  }

  html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"] {
    grid-template-rows: minmax(34px, auto) minmax(40px, auto);
    row-gap: 2px;
  }

  html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="tabs"] {
    max-block-size: 44px;
  }

  html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] {
    inline-size: min(58vw, 520px) !important;
  }
}

@media (hover: none) {
  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] {
    display: flex;
    align-items: center;
    min-block-size: 44px;
    height: auto !important;
    gap: 4px;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] > :nth-child(2) {
    flex: 1 1 auto;
    min-inline-size: 0;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] > :nth-child(3) {
    flex: 0 1 4em;
    max-inline-size: 4em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] > :has(> button[aria-label]) {
    display: inline-flex !important;
    flex: 0 0 auto;
    align-items: center;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] button[aria-label] {
    inline-size: 44px;
    min-inline-size: 44px;
    block-size: 44px;
    min-block-size: 44px;
    touch-action: manipulation;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] [class*="_rowActions"] {
    display: inline-flex !important;
    position: static !important;
    flex: 0 0 auto;
    align-items: center;
    inline-size: auto !important;
    max-inline-size: none !important;
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="session:"] [class*="_rowActions"] > div {
    display: none !important;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="workspace:"] button {
    position: relative;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [role="treeitem"][data-row-key^="workspace:"] button::after {
    content: "";
    position: absolute;
    inset: -10px;
  }

  html[data-dru-mobile][data-dru-skin-state="ready"] [data-conversation-scroll] :is(button[aria-label*="Copy"], button[aria-label*="copy"], button[aria-label*="复制"], button[aria-label*="Retry"], button[aria-label*="retry"], button[aria-label*="重试"], button[aria-label*="Delete"], button[aria-label*="delete"], button[aria-label*="删除"], button[title*="Copy"], button[title*="复制"], button[title*="Retry"], button[title*="重试"]) {
    opacity: 1 !important;
    visibility: visible !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  html[data-dru-mobile] :is([data-dru-part~="frame"], [data-dru-part~="sidebar"], [data-dru-part~="center"], [data-dru-part~="rightbar"], [data-dru-part~="header"], [data-dru-part~="composer"], [data-dru-part~="settings-dialog"], [data-dru-part~="menu"], .dru-mobile-launcher, .dru-mobile-backdrop, .dru-mobile-panel-close),
  html[data-dru-mobile] :is([data-dru-part~="frame"], [data-dru-part~="sidebar"], [data-dru-part~="center"], [data-dru-part~="rightbar"], [data-dru-part~="header"], [data-dru-part~="composer"], [data-dru-part~="settings-dialog"], [data-dru-part~="menu"], .dru-mobile-launcher, .dru-mobile-backdrop, .dru-mobile-panel-close)::before,
  html[data-dru-mobile] :is([data-dru-part~="frame"], [data-dru-part~="sidebar"], [data-dru-part~="center"], [data-dru-part~="rightbar"], [data-dru-part~="header"], [data-dru-part~="composer"], [data-dru-part~="settings-dialog"], [data-dru-part~="menu"], .dru-mobile-launcher, .dru-mobile-backdrop, .dru-mobile-panel-close)::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`;
    // Use the allocated chat width: safe areas, fold transitions, and side panes can all change it.
    // Also provides native-mode full-screen space optimization, Apple HIG side control rail for
    // wide-short displays (e.g. iPhone Duo outer portrait / inner landscape), composer cleanup,
    // keyboard-state compaction, and progressive viewport-segment posture rules.
    const NATIVE_COMPOSER_CSS = String.raw`
html:not([data-dru-ui="compat"]) [data-composer-seat] {
  container-name: dsh-mobile-composer;
  container-type: inline-size;
}
@container dsh-mobile-composer (310px <= width <= 640px) {
  [data-slot="conversation.input.model"] {
    --dsh-composer-model-text-display: block;
    --dsh-composer-model-icon-display: none;
    flex: 0 1 auto;
    min-inline-size: 0;
  }
  [data-slot="conversation.input.model"] button {
    max-inline-size: clamp(64px, calc(100cqi - 204px), 210px);
    padding-inline: 5px;
    gap: 4px;
  }
  [class*="_row"]:has(> [class*="_trailing"] [data-slot="conversation.input.model"]) {
    flex-wrap: nowrap;
    gap: 6px;
  }
  [class*="_trailing"]:has([data-slot="conversation.input.model"]) {
    flex: 1 1 auto;
    justify-content: flex-end;
    gap: 6px;
    min-inline-size: 0;
  }
  [data-slot="conversation.input.model"] > * {
    min-inline-size: 0;
  }
  [data-slot="conversation.input.model"] :is(.lgmp-effort, .qol-effort-name) {
    display: none;
  }
  [data-composer-dock] {
    flex-wrap: nowrap;
    column-gap: 4px;
  }
  [data-composer-dock] :is([data-composer-stat="activity"], .dshbill-anchor) {
    flex: 0 0 auto;
  }
  [data-composer-stat="activity"] button > span {
    display: none;
  }
}
@container dsh-mobile-composer (width <= 400px) {
  [data-composer-placeholder] {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* Fix phantom semi-transparent disabled circle next to the Send button on touch/mobile screens. */
html[data-dsh-touch-mobile="1"]:not([data-dru-ui="compat"]) [data-composer-card] .qol-enhance-trigger:disabled:not([aria-expanded="true"]) {
  display: none !important;
}
html[data-dsh-touch-mobile="1"]:not([data-dru-ui="compat"]) [data-composer-card] .qol-enhance-trigger:not(:disabled) {
  width: 30px;
  height: 30px;
  transform: none;
}

/* Phase 2: Full-screen vertical space optimization on compact / wide-short touch viewports. */
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-seat] {
  --dsh-composer-text-max-height: min(136px, 26dvh);
  padding-top: 2px;
}
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-card] {
  padding-top: 4px !important;
  gap: 2px;
  border-radius: 22px;
}
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-card] [class*="_scroll"] {
  min-height: 0 !important;
}
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-input] {
  min-height: 34px !important;
  padding-top: 4px !important;
  padding-bottom: 2px !important;
}
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-card] > [class*="_row"] {
  padding: 2px 6px 5px !important;
  gap: 6px;
}
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-card] [class*="_primary"] {
  transform: none;
}

/* Compact dock badge on short touch viewports: keep cost + context visible without truncation; tap to expand. */
html[data-dsh-dock-compact="collapsed"]:not([data-dru-ui="compat"]) [data-composer-dock] {
  min-height: 20px !important;
  margin-block-start: 4px !important;
  padding: 1px 6px !important;
  gap: 6px;
  justify-content: center;
  cursor: pointer;
}
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-seat] {
  background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 88%, transparent) 68%, var(--dsw-alias-bg-base, #fff) 100%) !important;
}
/* Cap expanded todo-panel height on short screens so it does not swallow half the conversation. */
html[data-dsh-touch-compact="1"]:not([data-dru-ui="compat"]) [data-composer-seat] section[data-testid="todo-panel"] > div:last-child {
  max-height: 112px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* iOS WebKit ignores SVG backdrop-filter: url(#lgf-...) from Liquid Glass, leaving glass cards
   nearly transparent over scrolled text. Provide native CSS frosted blur + legible translucent tint. */
@supports (-webkit-touch-callout: none) {
  html:not([data-dru-ui="compat"]) [data-composer-seat] section[data-testid="todo-panel"]::before,
  html:not([data-dru-ui="compat"]) [data-composer-card]::before,
  html:not([data-dru-ui="compat"]) [data-composer-dock]::before,
  html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
    -webkit-backdrop-filter: blur(22px) saturate(1.65) !important;
    backdrop-filter: blur(22px) saturate(1.65) !important;
    background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #fff)) 84%, transparent) !important;
  }
}
html[data-dsh-pwa-ios]:not([data-dru-ui="compat"]) [data-composer-seat] section[data-testid="todo-panel"]::before,
html[data-dsh-pwa-ios]:not([data-dru-ui="compat"]) [data-composer-card]::before,
html[data-dsh-pwa-ios]:not([data-dru-ui="compat"]) [data-composer-dock]::before,
html[data-dsh-pwa-ios][data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
  -webkit-backdrop-filter: blur(22px) saturate(1.65) !important;
  backdrop-filter: blur(22px) saturate(1.65) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #fff)) 84%, transparent) !important;
}
html[data-dsh-dock-compact="collapsed"]:not([data-dru-ui="compat"]) [data-composer-dock] [data-composer-stat="activity"],
html[data-dsh-dock-compact="collapsed"]:not([data-dru-ui="compat"]) [data-composer-dock] [data-composer-stat="usage"],
html[data-dsh-dock-compact="collapsed"]:not([data-dru-ui="compat"]) [data-composer-dock] [data-composer-stat="tokens"] {
  display: none !important;
}
html[data-dsh-dock-compact="collapsed"]:not([data-dru-ui="compat"]) [data-composer-dock] button {
  height: 20px;
  min-height: 20px;
  padding-block: 0;
  font-size: 11px;
}

/* Native-mode compact single-row horizontal header when side rail is off (e.g. inner portrait / narrow Safari). */
html[data-dsh-touch-mobile="1"]:not([data-dsh-side-rail]):not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_tabs"]) {
  min-height: 44px;
  padding-top: max(6px, var(--dsh-sa-top, 0px));
  padding-bottom: 4px;
}
html[data-dsh-touch-mobile="1"]:not([data-dsh-side-rail]):not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] {
  margin-top: 4px;
  gap: 8px 12px;
}
/* Reclaim top empty band on wide portrait iOS PWA (e.g. iPhone Duo inner portrait 669x951):
   system clock/battery only occupies top-right ~125pt, so move header up to y=10px and reserve
   only the top-right corner instead of pushing the entire bar down by safe-area-inset-top. */
html[data-dsh-corner-status="1"]:not([data-dsh-side-rail]):not([data-dru-ui="compat"]) header[data-window-drag] {
  padding-top: 10px !important;
  padding-right: 140px !important;
  padding-left: calc(20px + var(--dsh-sa-left, 0px)) !important;
  padding-bottom: 6px !important;
}
html[data-dsh-corner-status="1"]:not([data-dsh-side-rail]):not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
  top: 11px !important;
  left: calc(12px + var(--dsh-sa-left, 0px)) !important;
}
html[data-dsh-corner-status="1"]:not([data-dsh-side-rail]):not([data-dru-ui="compat"]) [data-conversation-scroll] {
  padding-top: 72px !important;
}

/* Native-mode keyboard compaction: reclaim bottom safe area and auxiliary strips. */
html[data-dsh-keyboard="open"]:not([data-dru-ui="compat"]) [data-composer-dock],
html[data-dsh-keyboard="open"]:not([data-dru-ui="compat"]) [data-composer-seat] section[data-testid="todo-panel"] {
  display: none !important;
}
html[data-dsh-keyboard="open"]:not([data-dru-ui="compat"]) [data-composer-seat] {
  padding-bottom: 2px !important;
}

/* Phase 3: Apple HIG Side Control Rail for iPhone Duo outer portrait, outer landscape, and inner landscape.
   Moves top bar controls & view tabs onto a compact vertical capsule along the trailing (or leading)
   safe-area edge, preserving full vertical height for the conversation stream. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) {
  --dsh-rail-w: 48px;
  --dsh-rail-gap: 6px;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-phase="active"] header[data-window-drag],
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
  position: fixed !important;
  top: max(8px, var(--dsh-sa-top, 0px));
  bottom: auto;
  max-height: calc(100dvh - max(16px, var(--dsh-sa-top, 0px) + var(--dsh-sa-bottom, 0px)));
  width: var(--dsh-rail-w) !important;
  min-width: var(--dsh-rail-w) !important;
  min-height: 0 !important;
  padding: 6px 3px !important;
  margin: 0 !important;
  box-sizing: border-box;
  display: flex !important;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  border: 0.5px solid var(--lg-glass-rim, var(--dsw-alias-border-l2, rgba(255, 255, 255, .14))) !important;
  border-radius: 24px;
  background: var(--lg-glass-fill-bar, color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1b1e24) 86%, transparent)) !important;
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: var(--lg-glass-shadow-md, 0 8px 28px rgba(0, 0, 0, .28));
  z-index: 30;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -webkit-app-region: no-drag;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag]::before {
  border-radius: inherit;
}
html[data-dsh-side-rail="right"]:not([data-dru-ui="compat"]) [data-phase="active"] header[data-window-drag],
html[data-dsh-side-rail="right"]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
  right: calc(var(--dsh-sa-right, 0px) + var(--dsh-rail-gap));
  left: auto !important;
}
html[data-dsh-side-rail="left"]:not([data-dru-ui="compat"]) [data-phase="active"] header[data-window-drag],
html[data-dsh-side-rail="left"]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
  left: calc(var(--dsh-sa-left, 0px) + var(--dsh-rail-gap));
  right: auto !important;
}

/* When drawer mode is active (outer screen), move the native sidebar opener to the top of the side rail. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-sidebar-drawer] header[data-window-drag]:has([class*="_titleRow"]) {
  padding-top: 48px !important;
}
html[data-dsh-side-rail="right"]:not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
  position: fixed !important;
  top: calc(max(8px, var(--dsh-sa-top, 0px)) + 5px) !important;
  right: calc(var(--dsh-sa-right, 0px) + var(--dsh-rail-gap) + 4px) !important;
  left: auto !important;
  z-index: 36 !important;
}
html[data-dsh-side-rail="left"]:not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
  position: fixed !important;
  top: calc(max(8px, var(--dsh-sa-top, 0px)) + 5px) !important;
  left: calc(var(--dsh-sa-left, 0px) + var(--dsh-rail-gap) + 4px) !important;
  right: auto !important;
  z-index: 36 !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-sidebar-drawer] [data-sidebar-opener] {
  width: 40px !important;
  height: 40px !important;
  border-radius: 999px !important;
  display: inline-grid;
  place-items: center;
}

/* Reflow header children vertically inside the 48px side rail without cloning controls. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] :is([class*="_titleRow"], [class*="_titleCluster"], [data-slot="conversation.session.header"]) {
  display: contents !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerLeading"]:not(:has(*)) {
  display: none !important;
}
/* Hide long horizontal breadcrumb text inside the vertical rail; keep compact title button when present. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_crumbs"] {
  display: none !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerActions"] {
  display: flex !important;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin: 0 !important;
  padding: 0 !important;
  order: 2;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerActions"]:not(:has(button)) {
  display: none !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerActions"] > :not(button):not(:has(button)) {
  display: none !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerActions"] button {
  width: 38px !important;
  min-width: 0 !important;
  max-width: 38px !important;
  height: 38px !important;
  padding: 0 !important;
  gap: 0 !important;
  border-radius: 999px;
  display: inline-grid !important;
  place-items: center;
  font-size: 0 !important;
  overflow: hidden;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerActions"] button > span {
  display: none !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerActions"] svg {
  width: 16px;
  height: 16px;
  flex: none;
}

/* View tabs stacked vertically in the middle section of the side rail. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] {
  display: flex !important;
  flex-direction: column;
  align-items: center;
  width: 100% !important;
  margin: 2px 0 !important;
  padding: 5px 0 !important;
  gap: 4px !important;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .24));
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .24));
  order: 3;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tablist"] {
  display: flex !important;
  flex-direction: column !important;
  align-items: center;
  width: 100%;
  gap: 3px;
  padding: 2px !important;
  border-radius: 16px !important;
  background: transparent !important;
  box-shadow: none !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tab"] {
  width: 40px !important;
  min-width: 40px !important;
  height: 32px !important;
  padding: 0 2px !important;
  margin: 0 !important;
  border-radius: 12px !important;
  justify-content: center;
  font-size: 11px !important;
  line-height: 1 !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tablist"]::after {
  display: none !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tab"][aria-selected="true"] {
  background: var(--lg-selected-fill, var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .24))) !important;
  color: var(--dsw-alias-label-primary) !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] > button,
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [class*="_viewsMoreAnchor"] button {
  width: 34px !important;
  height: 28px !important;
  border-radius: 999px;
}

/* Trailing utility & rightbar toggle buttons stacked in the lower section of the side rail. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerUtilities"],
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerCorner"] {
  display: flex !important;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 0 !important;
  padding: 0 !important;
  width: 100%;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerCorner"] {
  order: 4;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerUtilities"] {
  order: 5;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] :is([class*="_headerUtilities"], [class*="_headerCorner"]) button {
  width: 38px !important;
  height: 38px !important;
  border-radius: 999px !important;
  display: inline-grid;
  place-items: center;
}
@media (max-width: 600px) {
  html[data-dsh-side-rail]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_headerUtilities"] button:is([aria-label="分屏"], [title="分屏"], [aria-label="Split"], [title="Split"]) {
    display: none !important;
  }
}

/* Offset scrollable message content asymmetrically away from the side rail and reclaim top 76px.
   Apply padding on [data-conversation-scroll] itself (bypassing display:contents slot wrappers),
   and pull the bottom composer back to full safe width with matching negative margin. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-conversation-scroll] {
  padding-top: max(8px, var(--dsh-sa-top, 0px)) !important;
  scroll-padding-top: max(12px, var(--dsh-sa-top, 0px));
}
html[data-dsh-side-rail="right"]:not([data-dru-ui="compat"]) [data-conversation-scroll] {
  padding-right: calc(var(--dsh-sa-right, 0px) + var(--dsh-rail-w) + var(--dsh-rail-gap) + 6px) !important;
  padding-left: var(--dsh-sa-left, 0px) !important;
}
html[data-dsh-side-rail="left"]:not([data-dru-ui="compat"]) [data-conversation-scroll] {
  padding-left: calc(var(--dsh-sa-left, 0px) + var(--dsh-rail-w) + var(--dsh-rail-gap) + 6px) !important;
  padding-right: var(--dsh-sa-right, 0px) !important;
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-composer-seat] {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html[data-dsh-side-rail="right"]:not([data-dru-ui="compat"]) [data-composer-seat] {
  margin-right: calc(-1 * (var(--dsh-rail-w) + var(--dsh-rail-gap) + 6px)) !important;
}
html[data-dsh-side-rail="left"]:not([data-dru-ui="compat"]) [data-composer-seat] {
  margin-left: calc(-1 * (var(--dsh-rail-w) + var(--dsh-rail-gap) + 6px)) !important;
}
html[data-dsh-side-rail="right"]:not([data-dru-ui="compat"]) [class*="_toBottomSlot"] {
  padding-right: calc(var(--dsh-sa-right, 0px) + 14px) !important;
}

/* Native iPhone Duo Side Bar Placement: when the OS exposes the ~84pt asymmetric side safe-area
   (data-dsh-sa-side="right|left"), seat the vertical control rail INSIDE that side region directly
   beneath the system clock/battery ring instead of stacking a second column beside it. This fills
   the empty side strip per Apple HIG and returns 100% of the main width to the conversation. */
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]),
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) {
  --dsh-rail-w: 50px;
  --dsh-rail-top: 118px;
}
@media (max-width: 540px) {
  html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]),
  html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) {
    /* Outer portrait clock/battery ring sits lower (~85..151pt) below the corner camera. */
    --dsh-rail-top: 168px;
  }
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) [data-phase="active"] header[data-window-drag],
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
  top: var(--dsh-rail-top) !important;
  right: max(10px, calc((var(--dsh-sa-right) - var(--dsh-rail-w)) / 2 + 4px)) !important;
  left: auto !important;
  max-height: calc(100dvh - var(--dsh-rail-top) - max(16px, var(--dsh-sa-bottom, 0px))) !important;
  padding: 8px 4px !important;
  gap: 6px;
  border-radius: 26px;
}
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) [data-phase="active"] header[data-window-drag],
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) header[data-window-drag]:has([class*="_titleRow"]) {
  top: var(--dsh-rail-top) !important;
  left: max(10px, calc((var(--dsh-sa-left) - var(--dsh-rail-w)) / 2 + 4px)) !important;
  right: auto !important;
  max-height: calc(100dvh - var(--dsh-rail-top) - max(16px, var(--dsh-sa-bottom, 0px))) !important;
  padding: 8px 4px !important;
  gap: 6px;
  border-radius: 26px;
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) [data-sidebar-drawer] header[data-window-drag]:has([class*="_titleRow"]),
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) [data-sidebar-drawer] header[data-window-drag]:has([class*="_titleRow"]) {
  padding-top: 52px !important;
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
  top: calc(var(--dsh-rail-top) + 6px) !important;
  right: max(15px, calc((var(--dsh-sa-right) - 40px) / 2 + 4px)) !important;
  left: auto !important;
}
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
  top: calc(var(--dsh-rail-top) + 6px) !important;
  left: max(15px, calc((var(--dsh-sa-left) - 40px) / 2 + 4px)) !important;
  right: auto !important;
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) [data-conversation-scroll] {
  padding-right: var(--dsh-sa-right) !important;
  padding-left: var(--dsh-sa-left, 0px) !important;
}
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) [data-conversation-scroll] {
  padding-left: var(--dsh-sa-left) !important;
  padding-right: var(--dsh-sa-right, 0px) !important;
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) [data-composer-seat],
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) [data-composer-seat] {
  margin-right: 0 !important;
  margin-left: 0 !important;
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tab"],
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tab"] {
  width: 42px !important;
  min-width: 42px !important;
  height: 32px !important;
  font-size: 11px !important;
}
html[data-dsh-side-rail="right"][data-dsh-sa-side="right"]:not([data-dru-ui="compat"]) header[data-window-drag] :is([class*="_headerUtilities"], [class*="_headerCorner"]) button,
html[data-dsh-side-rail="left"][data-dsh-sa-side="left"]:not([data-dru-ui="compat"]) header[data-window-drag] :is([class*="_headerUtilities"], [class*="_headerCorner"]) button {
  width: 40px !important;
  height: 40px !important;
}

@media (max-width: 420px) {
  html[data-dsh-side-rail]:not([data-dsh-sa-side="right"]):not([data-dsh-sa-side="left"]):not([data-dru-ui="compat"]) {
    --dsh-rail-w: 42px;
    --dsh-rail-gap: 4px;
  }
  html[data-dsh-side-rail]:not([data-dsh-sa-side="right"]):not([data-dsh-sa-side="left"]):not([data-dru-ui="compat"]) [data-sidebar-drawer] [data-sidebar-opener] {
    width: 36px !important;
    height: 36px !important;
  }
  html[data-dsh-side-rail="right"]:not([data-dsh-sa-side="right"]):not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
    right: calc(var(--dsh-sa-right, 0px) + var(--dsh-rail-gap) + 3px) !important;
  }
  html[data-dsh-side-rail="left"]:not([data-dsh-sa-side="left"]):not([data-dru-ui="compat"]) [data-sidebar-drawer] [class*="_leadingSeat"] {
    left: calc(var(--dsh-sa-left, 0px) + var(--dsh-rail-gap) + 3px) !important;
  }
  html[data-dsh-side-rail]:not([data-dsh-sa-side="right"]):not([data-dsh-sa-side="left"]):not([data-dru-ui="compat"]) [data-sidebar-drawer] header[data-window-drag]:has([class*="_titleRow"]) {
    padding-top: 44px !important;
  }
  html[data-dsh-side-rail]:not([data-dsh-sa-side="right"]):not([data-dsh-sa-side="left"]):not([data-dru-ui="compat"]) header[data-window-drag] [class*="_tabs"] [role="tab"] {
    width: 34px !important;
    min-width: 34px !important;
    height: 28px !important;
    font-size: 10px !important;
  }
  html[data-dsh-side-rail]:not([data-dsh-sa-side="right"]):not([data-dsh-sa-side="left"]):not([data-dru-ui="compat"]) header[data-window-drag] :is([class*="_headerUtilities"], [class*="_headerCorner"]) button {
    width: 34px !important;
    height: 34px !important;
  }
}
html[data-dsh-side-rail]:not([data-dru-ui="compat"])[data-dsh-keyboard="open"] header[data-window-drag]:has([class*="_titleRow"]) {
  max-height: calc(var(--dsh-vv-height, 100dvh) - max(16px, var(--dsh-sa-top, 0px)));
}
/* Keep the side rail out of the way while a full-height overlay panel or drawer is open. */
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-sidebar-drawer]:not([data-sidebar-collapsed]) header[data-window-drag],
html[data-dsh-side-rail]:not([data-dru-ui="compat"]) [data-rightbar-fullscreen]:not([data-rightbar-collapsed]) header[data-window-drag] {
  opacity: 0;
  pointer-events: none;
}

/* Phase 4: Progressive fold-posture displacement when Safari/WebKit exposes Viewport Segments API. */
@media (horizontal-viewport-segments: 2) {
  html:not([data-dru-ui="compat"]) .dru-mask {
    justify-content: flex-end;
    padding-left: calc(env(viewport-segment-left 1 0, 50vw) + 12px);
  }
  html:not([data-dru-ui="compat"]) [role="dialog"][aria-modal="true"] {
    max-inline-size: calc(env(viewport-segment-width 1 0, 50vw) - 24px);
  }
}
@media (vertical-viewport-segments: 2) {
  html:not([data-dru-ui="compat"]) [data-conversation-scroll] {
    padding-bottom: max(12px, calc(100dvh - env(viewport-segment-bottom 0 0, 50dvh)));
  }
  html:not([data-dru-ui="compat"]) [data-composer-seat] {
    min-block-size: min(220px, env(viewport-segment-height 0 1, 35dvh));
    justify-content: flex-end;
  }
}
`;
    return { MOBILE_CSS, NATIVE_COMPOSER_CSS };
  }
});
