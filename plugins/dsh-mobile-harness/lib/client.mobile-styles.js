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

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-actions"] > * {
  flex: 0 0 auto;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-utilities"],
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-corner"] {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-block-size: 44px;
  max-inline-size: 48px;
  overflow-x: auto;
  scrollbar-width: none;
}

html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-corner"]:empty,
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="header-leading"]:empty {
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
html[data-dru-mobile][data-dru-skin-state="ready"] [data-dru-part~="rightbar"] :is(button, [role="button"], [role="menuitem"]),
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

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"]:not(:empty)) {
  grid-template-columns: minmax(88px, .72fr) minmax(0, 1fr) auto auto;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"]:not(:empty)) [data-dru-part~="crumbs"] {
  grid-column: 2 / 3;
  padding-inline-start: 0;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"]:not(:empty)) [data-dru-part~="header-actions"] {
  grid-column: 1 / 3;
}

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="header"]:has([data-dru-part~="header-leading"]:not(:empty)) [data-dru-part~="tabs"] {
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

html[data-dru-mobile][data-dru-layout="compact"][data-dru-skin-state="ready"] [data-dru-part~="settings-content"] {
  flex: 1 1 auto;
  inline-size: 100% !important;
  max-inline-size: 100% !important;
  padding: 14px max(16px, env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) !important;
  overflow: hidden;
}

@media (min-width: 761px) and (any-pointer: coarse) {
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

html[data-dru-mobile][data-dru-layout="expanded"][data-dru-skin-state="ready"].dru-drawer-open.dru-sidebar-docked .dru-mobile-backdrop {
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

@media (max-width: 760px) {
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
    return { MOBILE_CSS };
  }
});
