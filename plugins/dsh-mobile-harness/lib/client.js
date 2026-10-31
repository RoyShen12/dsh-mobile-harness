/**
 * Browser half of the in-app remote-access switch.
 *
 * Registers the sidebar entry ("远程") and the main panel: a switch plus a "小屏幕" that
 * shows the phone URL, the password, a scannable QR (URL + password), the tunnel and the
 * live connection count. Status is polled every 2 s while the panel is mounted.
 *
 * Constraints from the shipped plugin contract:
 *  - plain JS; only `react` / `react-dom` come from the platform seed;
 *  - a slot component must not throw while rendering (it would blank the slot);
 *  - the sidebar entry id and the `main` registration key are the same;
 *  - colours use the `--dsw-alias-*` tokens, except the QR which must stay dark-on-light.
 */
globalThis.__ModuleLoader__.load({
  id: 'dsh-mobile-harness',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /** A clock that re-renders on an interval while `active`; drives live timers. */
    function useNow(active, intervalMs = 1000) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [active, intervalMs])
      return now
    }

    /** Human duration, e.g. "3 分 12 秒". */
    function formatDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours > 0) return `${hours} 小时 ${minutes} 分`
      if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
      return `${seconds} 秒`
    }

    /** "482913" -> "482 913": pairs match by eye, not by comparing digit by digit. */
    function formatPairCode(code) {
      return String(code || '').replace(/(\d{3})(?=\d)/g, '$1 ').trim()
    }

    /** 52428800 -> "50.0 MB"; the panel shows the cloudflared download in these units. */
    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '—'
      if (value < 1024) return value + ' B'
      if (value < 1048576) return (value / 1024).toFixed(0) + ' KB'
      if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB'
      return (value / 1073741824).toFixed(2) + ' GB'
    }

    /** 480000 -> "469 KB/s" */
    function formatSpeed(bps) {
      const value = Number(bps)
      if (!Number.isFinite(value) || value <= 0) return ''
      return formatBytes(value) + '/s'
    }

    /** Remaining time for the progress bar: "约剩 1 分 20 秒" ('' when it cannot be estimated). */
    function formatEta(received, total, bps) {
      if (!(received > 0 && total > 0 && bps > 0) || total <= received) return ''
      const seconds = Math.round((total - received) / bps)
      if (!Number.isFinite(seconds) || seconds <= 0) return ''
      if (seconds < 60) return '约剩 ' + seconds + ' 秒'
      return '约剩 ' + Math.floor(seconds / 60) + ' 分 ' + (seconds % 60) + ' 秒'
    }

    /** How long a clicked QR stays sharp before blurring itself again. */
    const QR_REVEAL_MS = 10000

    const PANEL_ID = 'remote'
    const STATUS_PATH = '/api/dsh-mobile-harness.status'
    const TOGGLE_PATH = '/api/dsh-mobile-harness.toggle'
    const PASSWORD_PATH = '/api/dsh-mobile-harness.password'
    const EXTERNAL_PATH = '/api/dsh-mobile-harness.external'
    const RESET_PATH = '/api/dsh-mobile-harness.reset'
    const DEVICES_PATH = '/api/dsh-mobile-harness.devices'
    const CLOUDFLARED_PATH = '/api/dsh-mobile-harness.cloudflared'

    const CLS = {
      page: 'dru-page',
      header: 'dru-header',
      title: 'dru-title',
      subtitle: 'dru-subtitle',
      switchButton: 'dru-switch',
      switchOn: 'dru-switch-on',
      switchThumb: 'dru-switch-thumb',
      screen: 'dru-screen',
      screenTitle: 'dru-screen-title',
      body: 'dru-body',
      left: 'dru-left',
      right: 'dru-right',
      qrBox: 'dru-qr',
      qrWrap: 'dru-qr-wrap',
      qrHidden: 'dru-qr-hidden',
      qrOverlay: 'dru-qr-overlay',
      qrOverlayText: 'dru-qr-overlay-text',
      qrCountdown: 'dru-qr-countdown',
      qrHint: 'dru-qr-hint',
      qrEmpty: 'dru-qr-empty',
      qrGhost: 'dru-qr-ghost',
      qrEmptyText: 'dru-qr-empty-text',
      connRight: 'dru-conn-right',
      row: 'dru-row',
      rowLabel: 'dru-row-label',
      rowValue: 'dru-row-value',
      mono: 'dru-mono',
      muted: 'dru-muted',
      dot: 'dru-dot',
      dotOn: 'dru-dot-on',
      dotError: 'dru-dot-error',
      dotBusy: 'dru-dot-busy',
      badge: 'dru-badge',
      button: 'dru-button',
      buttonQuiet: 'dru-button-quiet',
      buttonOn: 'dru-button-on',
      input: 'dru-input',
      error: 'dru-error',
      note: 'dru-note',
      sectionTitle: 'dru-section-title',
      card: 'dru-card',
      cardHead: 'dru-card-head',
      cardTitle: 'dru-card-title',
      cardDesc: 'dru-card-desc',
      cardAside: 'dru-card-aside',
      cardNote: 'dru-card-note',
      fields: 'dru-fields',
      field: 'dru-field',
      fieldLabel: 'dru-field-label',
      fieldMain: 'dru-field-main',
      fieldTip: 'dru-field-tip',
      value: 'dru-value',
      tipLine: 'dru-tip-line',
      hero: 'dru-hero',
      heroTitle: 'dru-hero-title',
      seg: 'dru-seg',
      segBtn: 'dru-seg-btn',
      segBtnOn: 'dru-seg-btn-on',
      badgeOn: 'dru-badge-on',
      device: 'dru-device',
      deviceName: 'dru-device-name',
      deviceMeta: 'dru-device-meta',
      deviceActions: 'dru-device-actions',
      pending: 'dru-pending',
      pendingHead: 'dru-pending-head',
      pendingTitle: 'dru-pending-title',
      pendingCode: 'dru-pending-code',
      pendingActions: 'dru-pending-actions',
      bar: 'dru-bar',
      barFill: 'dru-bar-fill',
      barFillIndeterminate: 'dru-bar-fill-indeterminate',
      barNote: 'dru-bar-note',
      safety: 'dru-safety',
      footer: 'dru-footer',
      spinner: 'dru-spinner'
    }

    const CSS = `
.dru-page{box-sizing:border-box;height:100%;overflow:auto;padding:40px 48px 64px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.dru-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;max-width:820px}
.dru-title{margin:0;font-size:22px;line-height:30px;font-weight:600}
.dru-subtitle{margin:6px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dru-switch{position:relative;flex:none;width:48px;height:28px;margin-top:4px;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;transition:background .18s}
.dru-switch:disabled{cursor:progress;opacity:.7}
.dru-switch-on{background:var(--dsw-alias-accent, #4c8dff)}
.dru-switch-thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .18s}
.dru-switch-on .dru-switch-thumb{transform:translateX(20px)}
.dru-screen{box-sizing:border-box;max-width:820px;margin-top:26px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.28));border-radius:14px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dru-screen-title{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a93a3);border-bottom:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.2))}
.dru-badge{font-size:11px;letter-spacing:0;text-transform:none;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.3));color:var(--dsw-alias-label-secondary)}
.dru-body{display:flex;gap:24px;padding:20px 18px 22px}
.dru-left{flex:none;width:184px}
.dru-qr-wrap{position:relative}
.dru-qr{width:184px;height:184px;border-radius:12px;background:#fff;border:1px solid rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;padding:8px;box-sizing:border-box;transition:filter .2s}
.dru-qr svg{width:100%;height:100%;display:block;transition:filter .2s}
.dru-qr-hidden svg{filter:blur(9px)}
.dru-qr-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:0;border-radius:12px;background:rgba(14,16,20,.35);color:#e8eaee;cursor:pointer;padding:0}
.dru-qr-overlay-text{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;line-height:1.6;padding:10px 14px;border-radius:999px;background:rgba(14,16,20,.72);border:1px solid rgba(255,255,255,.14)}
.dru-qr-overlay-text small{font-size:10.5px;color:#9aa3b2}
.dru-qr-countdown{display:block;width:max-content;margin:8px auto 0;padding:2px 10px;border-radius:999px;background:rgba(14,16,20,.55);border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.3));color:var(--dsw-alias-label-secondary,#cfd6e2);font-size:11px;line-height:18px;white-space:nowrap;pointer-events:none;text-align:center}
.dru-qr-hint{margin:8px 0 0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a93a3);text-align:center}
.dru-right{flex:1;min-width:0;display:flex;flex-direction:column;gap:11px}
.dru-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-height:26px}
.dru-section-title{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.2));font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dru-row-label{flex:none;width:44px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-row-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.dru-mono{font-family:"Cascadia Mono",Consolas,ui-monospace,monospace}
.dru-button{flex:none;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.3));background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;border-radius:6px;padding:2px 8px;cursor:pointer;line-height:18px}
.dru-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dru-button:disabled{opacity:.5;cursor:default}
.dru-button-on{border-color:var(--dsw-alias-accent, #4c8dff);background:color-mix(in srgb, var(--dsw-alias-accent, #4c8dff) 18%, transparent);color:var(--dsw-alias-label-primary)}
.dru-input{flex:1;min-width:180px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.3));color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px;font-family:inherit}
.dru-input:focus{outline:none;border-color:var(--dsw-alias-accent, #4c8dff)}
.dru-button-quiet{border-color:transparent}
.dru-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#8a93a3);margin-right:7px}
.dru-dot-on{background:#37d39b}
.dru-dot-error{background:#ff7a59}
.dru-dot-busy{background:#e8b339;animation:dru-pulse 1s ease-in-out infinite}
@keyframes dru-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dru-error{margin:0 18px 18px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,122,89,.4);background:rgba(255,122,89,.08);color:#ffb3a0;font-size:12px;line-height:1.7}
.dru-note{max-width:820px;margin-top:16px;font-size:12px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-footer{max-width:820px;margin-top:22px;padding-top:14px;border-top:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.2));font-size:12px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(8,10,14,.55);pointer-events:auto;animation:dru-fade .16s ease}
.dru-dialog{box-sizing:border-box;width:min(430px,100%);padding:22px 22px 16px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.3));border-radius:16px;background:var(--dsw-alias-bg-layer-2,#1b1e24);color:var(--dsw-alias-label-primary);box-shadow:0 24px 64px rgba(0,0,0,.55);animation:dru-pop .18s cubic-bezier(.2,.9,.3,1.1)}
.dru-dialog-head{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600}
.dru-dialog-device{margin-top:7px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dru-code{margin:16px 0 4px;text-align:center;font-family:"Cascadia Mono",Consolas,ui-monospace,monospace;font-size:32px;line-height:1.2;font-weight:600;letter-spacing:.18em;color:#e8b339}
.dru-dialog-hint{margin:8px 0 0;font-size:12px;line-height:1.75;text-align:center;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-dialog-error{margin-top:10px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,122,89,.4);background:rgba(255,122,89,.08);color:#ffb3a0;font-size:12px;line-height:1.6}
.dru-dialog-more{margin-top:10px;font-size:11.5px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
.dru-dialog-btn{flex:none;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.32));background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;padding:7px 14px;border-radius:9px;cursor:pointer;transition:background .15s,border-color .15s}
.dru-dialog-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dru-dialog-btn:disabled{opacity:.55;cursor:default}
.dru-dialog-btn-quiet{border-color:transparent;margin-right:auto}
.dru-dialog-btn-primary{border-color:transparent;background:var(--dsw-alias-accent,#4c8dff);color:#fff}
.dru-dialog-btn-primary:hover{filter:brightness(1.06);background:var(--dsw-alias-accent,#4c8dff)}
@keyframes dru-fade{from{opacity:0}to{opacity:1}}
@keyframes dru-pop{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.dru-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;max-width:860px}
.dru-hero-title{display:flex;align-items:center;gap:10px}
.dru-card{box-sizing:border-box;max-width:860px;margin-top:16px;padding:16px 18px 18px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.24));border-radius:14px;background:var(--dsw-alias-bg-layer-2)}
.dru-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.dru-card-title{margin:0;font-size:14px;line-height:22px;font-weight:600}
.dru-card-desc{margin:3px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-card-aside{display:flex;flex-wrap:wrap;gap:6px}
.dru-fields{display:flex;flex-direction:column;gap:14px}
.dru-field{display:flex;align-items:flex-start;gap:14px}
.dru-field-label{flex:none;width:60px;padding-top:5px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-field-main{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dru-field-tip{flex-basis:100%;margin:0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-card-note{margin:0;font-size:11.5px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.dru-seg{display:flex;flex-wrap:wrap;gap:2px;padding:2px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.28));border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.dru-seg-btn{white-space:nowrap;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;padding:4px 11px;border-radius:7px;cursor:pointer;font-family:inherit;transition:background .15s,color .15s}
.dru-seg-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dru-seg-btn:disabled{opacity:.5;cursor:default}
.dru-seg-btn-on{background:color-mix(in srgb, var(--dsw-alias-accent,#4c8dff) 22%, transparent);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-accent,#4c8dff) 55%, transparent)}
.dru-badge-on{border-color:rgba(55,211,155,.45);color:#37d39b}
.dru-device{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.16))}
.dru-device-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
.dru-device-meta{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-device-actions{flex:none;display:flex;gap:6px}
.dru-pending{box-sizing:border-box;padding:12px 14px;border:1px solid rgba(232,179,57,.45);border-radius:12px;background:rgba(232,179,57,.06)}
.dru-pending-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dru-pending-title{font-size:12.5px;font-weight:600;color:#e8b339}
.dru-pending-code{margin:10px 0 2px;font-family:"Cascadia Mono",Consolas,ui-monospace,monospace;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:.2em;color:#e8b339}
.dru-pending-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
.dru-tip-line{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-bar{flex-basis:100%;box-sizing:border-box;height:8px;margin:2px 0 0;border-radius:99px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.22));box-shadow:inset 0 0 0 1px var(--dsw-alias-line-1,rgba(128,128,128,.18))}
.dru-bar-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--dsw-alias-accent,#4c8dff),#59c8ff);transition:width .4s ease}
.dru-bar-fill-indeterminate{width:38%!important;animation:dru-bar-slide 1.2s ease-in-out infinite}
@keyframes dru-bar-slide{0%{margin-left:-38%}100%{margin-left:100%}}
.dru-bar-note{flex-basis:100%;margin:0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a93a3);font-variant-numeric:tabular-nums}
.dru-safety{max-width:860px;margin:20px 0 0;font-size:11.5px;line-height:1.8;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-error{max-width:860px;margin:14px 0 0}
.dru-body{display:flex;align-items:flex-start;gap:22px;padding:2px 0 0}
.dru-body>.dru-left{flex:none;width:184px}
.dru-conn-right{flex:1;min-width:0}
.dru-qr-empty{background:transparent;border:1px dashed rgba(128,128,128,.42);flex-direction:column;gap:10px;color:var(--dsw-alias-label-tertiary,#8a93a3)}
.dru-qr-ghost{width:56px;height:56px;opacity:.3}
.dru-qr-empty-text{font-size:11.5px;line-height:1.6;text-align:center;padding:0 6px}
@media (max-width:760px){.dru-page{padding:24px 18px 48px}.dru-body{flex-direction:column}.dru-left{width:100%}.dru-body{flex-direction:column;gap:14px}.dru-body>.dru-left{width:100%}.dru-qr{width:220px;height:220px;margin:0 auto}.dru-qr-hint{max-width:220px;margin:8px auto 0}.dru-field{flex-direction:column;gap:6px}.dru-field-label{width:auto;padding-top:0}.dru-hero{flex-direction:column;gap:12px}.dru-card{padding:14px 14px 16px}}
`

    function ensureStyles() {
      const id = 'dru-style'
      let node = document.getElementById(id)
      if (!node) {
        node = document.createElement('style')
        node.id = id
        document.head.appendChild(node)
      }
      if (node.textContent !== CSS) node.textContent = CSS
    }

    async function postJson(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {})
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok && payload === null) throw new Error('HTTP ' + response.status)
      return payload
    }

    function downloadJson(filename, data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }

    async function copyText(text) {
      if (!text) return false
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* fall through */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
      } catch {
        return false
      }
    }

    function CopyButton({ text, label }) {
      const [done, setDone] = useState(false)
      const timer = useRef(null)
      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
      return h(
        'button',
        {
          type: 'button',
          className: CLS.button,
          disabled: !text,
          onClick: async () => {
            const ok = await copyText(text)
            if (!ok) return
            setDone(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setDone(false), 1400)
          }
        },
        done ? '已复制' : (label || '复制')
      )
    }

    /** Faint QR-shaped glyph behind the empty state, so the box reads as a QR slot at a glance. */
    function GhostQr() {
      const marks = []
      const finder = (x, y) =>
        `M${x} ${y}h7v7h-7z M${x + 1} ${y + 1}v5h5v-5z M${x + 2} ${y + 2}h3v3h-3z`
      marks.push('M0 0h21v21H0z ' + finder(0, 0) + ' ' + finder(14, 0) + ' ' + finder(0, 14))
      for (let i = 8; i <= 12; i += 2) {
        marks.push(`M${i} 6h1v1h-1z M6 ${i}h1v1h-1z`)
      }
      for (const [x, y] of [[9, 9], [12, 10], [10, 13], [15, 16], [17, 9], [16, 12], [8, 17], [13, 15], [11, 17]]) {
        marks.push(`M${x} ${y}h1v1h-1z`)
      }
      return h('svg', { className: CLS.qrGhost, viewBox: '0 0 21 21', 'aria-hidden': 'true', fillRule: 'evenodd' }, h('path', { d: marks.join(' '), fill: 'currentColor' }))
    }

    function QrCode({ qr, disabled, revealed, remaining, onReveal }) {
      const hasQr = Boolean(qr && Array.isArray(qr.rows) && qr.size > 0)
      let inner = [
        h(GhostQr, { key: 'ghost' }),
        h('span', { key: 'text', className: CLS.qrEmptyText }, disabled ? '打开开关后显示' : '二维码生成失败')
      ]
      if (hasQr) {
        const quiet = 3
        const total = qr.size + quiet * 2
        const cells = []
        for (let r = 0; r < qr.size; r += 1) {
          const row = qr.rows[r] || ''
          for (let c = 0; c < qr.size; c += 1) {
            if (row[c] === '1') {
              cells.push(h('rect', { key: r + '-' + c, x: c + quiet, y: r + quiet, width: 1, height: 1, fill: '#0b0c0f' }))
            }
          }
        }
        inner = h(
          'svg',
          { viewBox: `0 0 ${total} ${total}`, role: 'img', 'aria-label': '远程访问二维码', shapeRendering: 'crispEdges' },
          h('rect', { x: 0, y: 0, width: total, height: total, fill: '#ffffff' }),
          cells
        )
      }
      return h(
        'div',
        { className: CLS.qrWrap + (hasQr && !revealed ? ' ' + CLS.qrHidden : '') },
        h('div', { className: CLS.qr + (hasQr ? '' : ' ' + CLS.qrEmpty) }, inner),
        hasQr && !disabled && !revealed
          ? h(
              'button',
              { type: 'button', className: CLS.qrOverlay, onClick: onReveal, title: '点击显示二维码' },
              h('span', { className: CLS.qrOverlayText }, '点击显示二维码')
            )
          : null,
        hasQr && revealed
          ? h('div', { className: CLS.qrCountdown }, `${remaining} 秒后自动模糊`)
          : null
      )
    }

    function phaseLabel(status) {
      const phase = status?.phase || 'disabled'
      if (phase === 'enabled') return '已开启'
      if (phase === 'starting') return '正在启动'
      if (phase === 'stopping') return '正在停止'
      if (phase === 'error') return '出错'
      return '未开启'
    }

    /** A titled block: the panel is a stack of these, so every area starts at the same edge. */
    function Card({ title, desc, aside, children }) {
      return h(
        'section',
        { className: CLS.card },
        h(
          'div',
          { className: CLS.cardHead },
          h(
            'div',
            null,
            h('h2', { className: CLS.cardTitle }, title),
            desc ? h('p', { className: CLS.cardDesc }, desc) : null
          ),
          aside ? h('div', { className: CLS.cardAside }, aside) : null
        ),
        children
      )
    }

    /** One labelled control row; `tip` is the small grey line under it. */
    function Field({ label, children, tip }) {
      return h(
        'div',
        { className: CLS.field },
        h('span', { className: CLS.fieldLabel }, label),
        h('div', { className: CLS.fieldMain }, children, tip ? h('p', { className: CLS.fieldTip }, tip) : null)
      )
    }

    /** Segmented choice: fewer pixels than a row of buttons, and the active one reads at a glance. */
    function Seg({ options, value, onPick, disabled }) {
      return h(
        'div',
        { className: CLS.seg },
        options.map((option) =>
          h(
            'button',
            {
              key: option[0],
              type: 'button',
              disabled,
              className: CLS.segBtn + (value === option[0] ? ' ' + CLS.segBtnOn : ''),
              onClick: () => onPick(option[0])
            },
            option[1]
          )
        )
      )
    }

    /** P2 phone assist has not passed acceptance yet: keep it out of the UI, not out of the code. */
    const SHOW_PHONE_ASSIST = false

    function RemotePage() {
      const [status, setStatus] = useState(null)
      const [fetchError, setFetchError] = useState(null)
      const [reveal, setReveal] = useState(false)
      const [qrRevealUntil, setQrRevealUntil] = useState(0)
      const [actionError, setActionError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [externalDraft, setExternalDraft] = useState(null)
      const [maxOnlineDraft, setMaxOnlineDraft] = useState(null)
      const [confirmingRequest, setConfirmingRequest] = useState(null)
      const [switchNote, setSwitchNote] = useState(null)

      const load = async () => {
        try {
          const response = await fetch(STATUS_PATH, { credentials: 'include', cache: 'no-store' })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const body = await response.json()
          setStatus(body)
          setFetchError(null)
          return body
        } catch (error) {
          setFetchError(error instanceof Error ? error.message : String(error))
          return null
        }
      }

      useEffect(() => {
        let alive = true
        const tick = async () => {
          if (!alive) return
          await load()
        }
        tick()
        // 1 s (was 2 s): the cloudflared download bar and the switching state need to move
        // visibly, and the status route is a loopback round-trip.
        const timer = setInterval(tick, 1000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const enabled = Boolean(status?.enabled)
      const phase = status?.phase || 'disabled'
      const phaseBusy = phase === 'starting' || phase === 'stopping' || busy || Boolean(status?.busy)
      const publicUrl = status?.publicUrl || ''
      const password = status?.password || ''
      const qr = status?.qr || null
      const devices = Number(status?.devices ?? status?.clients ?? 0)
      const pages = Number(status?.pages ?? status?.clients ?? 0)
      const tunnelLabel = status?.tunnel === 'none'
        ? '本机（未起隧道）'
        : status?.tunnel === 'external'
          ? '外部隧道（SakuraFrp / frp）'
          : status?.tunnel === 'quick'
            ? 'Cloudflare 快速隧道'
            : 'Tailscale Serve'
      const cloudflare = status?.cloudflare || null
      const errorText = actionError || status?.lastError || (fetchError ? '无法读取宿主状态：' + fetchError : '')

      // Ticking timer for "已开启 · 已运行 X" and the QR auto-blur countdown.
      const now = useNow(enabled)
      const qrNow = useNow(qrRevealUntil > 0, 250)
      const qrRevealed = qrRevealUntil > qrNow
      const qrRemaining = qrRevealed ? Math.max(1, Math.ceil((qrRevealUntil - qrNow) / 1000)) : 0
      const runningFor = enabled && Number.isFinite(status?.since) ? formatDuration(now - status.since) : null

      const revealQr = () => {
        // Clicking a revealed QR restarts its 10-second window.
        setQrRevealUntil(Date.now() + QR_REVEAL_MS)
      }

      const toggle = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(TOGGLE_PATH, { enabled: !enabled })
          if (next && next.phase) setStatus(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      // Switching the entry always turns the remote-access switch OFF (the new entry needs a
      // fresh enable). Sending enabled:true here used to re-enable inline and left the panel on
      // "正在启动" for up to 35 s with every control disabled.
      const switchTunnel = async (mode) => {
        setActionError(null)
        setSwitchNote(null)
        setBusy(true)
        try {
          const next = await postJson(TOGGLE_PATH, { tunnel: mode, enabled: false })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) {
            setStatus(next)
            setSwitchNote('已切到「' + (entryOptions.find((option) => option[0] === mode) || [mode, mode])[1] + '」并自动关掉了开关：检查下面的入口设置，再打开开关。')
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const saveExternal = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(EXTERNAL_PATH, { url: externalDraft ?? status?.externalUrl ?? '' })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) {
            setStatus(next)
            setExternalDraft(null)
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const resetStats = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(RESET_PATH, {})
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) setStatus(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const detectExternal = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(EXTERNAL_PATH, {})
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) {
            setStatus(next)
            setExternalDraft(null)
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      // Quick-tunnel side actions: fetch the binary (~50 MB) and force a reconnect.
      const cloudflareAction = async (action) => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(CLOUDFLARED_PATH, { action })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) setStatus(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const togglePasswordProtection = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(PASSWORD_PATH, { enabled: !status?.passwordEnabled })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) setStatus(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const regenerate = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const result = await postJson(PASSWORD_PATH, {})
          if (result && result.snapshot) setStatus(result.snapshot)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const sinceText = (ts) => {
        if (!ts) return '—'
        const minutes = Math.round((Date.now() - ts) / 60000)
        if (minutes < 1) return '刚刚'
        if (minutes < 60) return `${minutes} 分钟前`
        const hours = Math.round(minutes / 60)
        if (hours < 24) return `${hours} 小时前`
        return `${Math.round(hours / 24)} 天前`
      }

      const deviceAction = async (payload) => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(DEVICES_PATH, payload)
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) setStatus(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          load()
        }
      }

      const setPhoneAssist = (enabled) => deviceAction({ action: 'phone', enabled })
      const revokePhone = (deviceId) => deviceAction({ action: 'phone-revoke', deviceId })

      const exportDiagnostics = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const payload = await postJson(DEVICES_PATH, { action: 'diag' })
          if (!payload?.diag) throw new Error(payload?.error || '诊断包生成失败')
          const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '-')
          downloadJson('dsh-remote-diagnostics-' + stamp + '.json', payload.diag)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }

      const revokeAllDevices = () => deviceAction({ action: 'revokeAll' })
      const blacklistDevice = (deviceId) => deviceAction({ action: 'block', deviceId })
      const unblacklistDevice = (deviceId) => deviceAction({ action: 'unblock', deviceId })
      const approveDevice = (deviceId, code) => deviceAction({ action: 'approve', deviceId, code })
      const denyRequest = (requestId, deviceId) => deviceAction({ action: 'deny', requestId, deviceId })
      const removeDevice = (deviceId) => deviceAction({ action: 'revokeDevice', deviceId })
      const saveAdmission = (patch) => deviceAction({ action: 'settings', settings: patch })
      const commitMaxOnline = () => {
        if (maxOnlineDraft === null) return
        const value = Number(maxOnlineDraft)
        setMaxOnlineDraft(null)
        if (!Number.isFinite(value)) return
        saveAdmission({ maxOnlineDevices: value })
      }

      const requireApproval = status?.settings?.requireApproval ?? true
      const cfDown = Boolean(cloudflare?.downloading)
      // Number(null) is 0, so null/undefined must be excluded explicitly or an unknown total
      // would render a stuck 0% bar instead of the indeterminate one.
      const cfRawPercent = cloudflare?.downloadPercent
      const cfPercent = cfDown && cfRawPercent !== null && cfRawPercent !== undefined && Number.isFinite(Number(cfRawPercent)) ? Number(cfRawPercent) : null
      const cfReceived = Number(cloudflare?.downloadReceived || 0)
      const cfTotal = Number(cloudflare?.downloadTotal || 0)
      const cfSpeed = formatSpeed(cloudflare?.downloadBps)
      const cfEta = formatEta(cfReceived, cfTotal, cloudflare?.downloadBps)
      const cfFrom = cloudflare?.downloadSource ? '来自 ' + cloudflare.downloadSource : ''
      const cfBarText = cfDown
        ? '下载中 ' + formatBytes(cfReceived) + (cfTotal > 0 ? ' / ' + formatBytes(cfTotal) : '') + (cfSpeed ? ' · ' + cfSpeed : '') + (cfEta ? ' · ' + cfEta : '') + (cfFrom ? ' · ' + cfFrom : '')
        : ''
      const downloadBar = cfDown
        ? h(
            'div',
            { className: CLS.bar },
            h('div', {
              className: CLS.barFill + (cfPercent === null ? ' ' + CLS.barFillIndeterminate : ''),
              style: cfPercent === null ? {} : { width: Math.max(2, Math.min(100, cfPercent)) + '%' }
            })
          )
        : null
      const downloadNote = cfDown ? h('p', { className: CLS.barNote }, cfBarText) : null
            const entryOptions = [['external', 'SakuraFrp / 外部'], ['quick', 'Cloudflare'], ['none', '仅本机'], ['tailscale', 'Tailscale']]
      const entryTip = status?.tunnel === 'external'
        ? '填好下面的外网地址，面板的网址和二维码都会用它。'
        : status?.tunnel === 'quick'
          ? '免账号：插件自己下载 cloudflared 建隧道，地址每次重启都会变。'
          : status?.tunnel === 'none'
            ? '不起隧道，只监听本机端口；手机连不上，适合在本机调试。'
            : '需要本机已登录 Tailscale，并已把这个网关端口 serve 出去。不推荐：走 DERP 中继时延迟高，能用外部隧道或 Cloudflare 就别用它。'
      const connectTip = enabled
        ? (status?.tunnel === 'external'
            ? '首次访问会提示证书不受信任：点「高级 → 继续前往」。'
            : status?.tunnel === 'quick'
              ? 'Cloudflare 免费隧道的地址每次重启都会变，换了地址要重新扫码。'
              : status?.tunnel === 'none'
                ? '当前只有本机能访问，手机连不上。'
                : '手机需安装 Tailscale 并登录同一账号；走中继时延迟会明显偏高。')
        : '打开开关后生成二维码：一次性登录链接（10 分钟），扫一次就失效，截图外发也进不来。'

      return h(
        'div',
        { className: CLS.page },

        h(
          'div',
          { className: CLS.hero },
          h(
            'div',
            null,
            h(
              'div',
              { className: CLS.heroTitle },
              h('h1', { className: CLS.title }, '远程访问'),
              h('span', { className: CLS.badge + (enabled ? ' ' + CLS.badgeOn : '') }, phaseLabel(status))
            ),
            h('p', { className: CLS.subtitle }, '手机在任意网络都能接着用这台电脑上的同一个会话：打开开关、扫码、输密码。')
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': enabled,
              'aria-label': '远程访问开关',
              disabled: phaseBusy,
              onClick: toggle,
              title: enabled ? '点击关闭远程访问' : '点击开启远程访问',
              className: CLS.switchButton + (enabled ? ' ' + CLS.switchOn : '')
            },
            h('span', { className: CLS.switchThumb })
          )
        ),

        errorText ? h('div', { className: CLS.error }, errorText) : null,

        h(
          Card,
          { title: '连接', desc: '扫码直接进；也可以手动打开网址输密码' },
          h(
            'div',
            { className: CLS.body },
            h(
              'div',
              { className: CLS.left },
              h(QrCode, {
                qr,
                disabled: !enabled,
                revealed: enabled && qrRevealed,
                remaining: qrRemaining,
                onReveal: revealQr
              }),
              enabled
                ? h(
                    'p',
                    { className: CLS.qrHint },
                    qrRevealed ? '扫码即进；码是一次性的，10 秒后自动模糊' : '点二维码显示（一次性登录链接，扫一次就失效）'
                  )
                : h('p', { className: CLS.qrHint }, '开启后自动生成一次性登录码')
            ),
            h(
              'div',
              { className: CLS.fields + ' ' + CLS.connRight },
              h(
                Field,
                { label: '状态' },
                h('i', {
                  className: CLS.dot + ' ' + (phase === 'error' ? CLS.dotError : phaseBusy ? CLS.dotBusy : enabled ? CLS.dotOn : '')
                }),
                h('span', { className: CLS.value }, phaseLabel(status) + (runningFor ? ' · 已运行 ' + runningFor : ''))
              ),
              h(
                Field,
                { label: '在线' },
                h('span', { className: CLS.value }, enabled ? (status?.onlineDevices ?? 0) + ' 台设备 · ' + pages + ' 个在线页面' : '—'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: CLS.button + ' ' + CLS.buttonQuiet,
                    disabled: phaseBusy,
                    onClick: resetStats,
                    title: '只清空显示统计，不断开任何连接'
                  },
                  '重置统计'
                )
              ),
              h(
                Field,
                { label: '网址' },
                h('span', { className: CLS.value + ' ' + CLS.mono }, publicUrl || status?.lastPublicUrl || '—'),
                h(CopyButton, { text: publicUrl })
              ),
              h(
                Field,
                { label: '密码', tip: '重置后所有已连接的手机都要重新输密码。' },
                h('span', { className: CLS.value + ' ' + CLS.mono }, password ? (reveal ? password : '••••••••') : '—'),
                h(
                  'button',
                  { type: 'button', className: CLS.button + ' ' + CLS.buttonQuiet, onClick: () => setReveal((v) => !v) },
                  reveal ? '隐藏' : '显示'
                ),
                h(CopyButton, { text: password }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: CLS.button + ' ' + CLS.buttonQuiet,
                    disabled: phaseBusy,
                    onClick: regenerate,
                    title: '生成新密码，所有手机需重新登录'
                  },
                  '重置密码'
                )
              ),
              h(
                Field,
                {
                  label: '验证',
                  tip: '关掉后任何人拿到网址就能进，只在完全信任的网络里用；设备准入的配对码仍然有效。'
                },
                h(
                  'span',
                  { className: CLS.value },
                  status?.passwordEnabled === false ? '已关闭（免密码）' : '每次新设备都要输密码'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: CLS.button + ' ' + CLS.buttonQuiet,
                    disabled: phaseBusy,
                    onClick: togglePasswordProtection,
                    title: status?.passwordEnabled === false ? '重新要求输入密码' : '免密码进入（不推荐）'
                  },
                  status?.passwordEnabled === false ? '开启验证' : '关闭验证'
                )
              ),
              h('p', { className: CLS.cardNote }, connectTip)
            )
          )
        ),

        h(
          Card,
          { title: '网络入口', desc: '手机怎么找到这台电脑' },
          h(
            'div',
            { className: CLS.fields },
            h(
              Field,
              { label: '入口', tip: entryTip },
              h(Seg, { options: entryOptions, value: status?.tunnel || 'tailscale', onPick: switchTunnel, disabled: phaseBusy }),
              switchNote ? h('p', { className: CLS.fieldTip }, switchNote) : null
            ),
            status?.tunnel === 'external'
              ? h(
                  Field,
                  {
                    label: '外网地址',
                    tip: 'SakuraFrp 的地址形如 https://frp-cat.com:12345/；「自动检测」会去读 SakuraFrp 的运行日志。'
                  },
                  h('input', {
                    className: CLS.input,
                    value: externalDraft ?? status?.externalUrl ?? '',
                    placeholder: 'https://frp-cat.com:12345/',
                    spellCheck: false,
                    onChange: (event) => setExternalDraft(event.target.value),
                    onKeyDown: (event) => { if (event.key === 'Enter') saveExternal() }
                  }),
                  h('button', { type: 'button', className: CLS.button, disabled: phaseBusy, onClick: saveExternal }, '保存'),
                  h('button', { type: 'button', className: CLS.button, disabled: phaseBusy, onClick: detectExternal }, '自动检测'),
                  h(CopyButton, { text: status?.externalUrl || '' })
                )
              : null,
            status?.tunnel === 'quick'
              ? h(
                  Field,
                  { label: '隧道', tip: '节点由 Cloudflare 分配，掉线会自动重连（最多 8 次）；换地址后手机会掉线，需要重新扫码。' },
                  h(
                    'span',
                    { className: CLS.value + ' ' + CLS.mono },
                    cfDown
                      ? '正在下载 cloudflared'
                      : cloudflare?.state === 'starting'
                        ? '正在建立隧道…'
                        : cloudflare?.state === 'retrying'
                          ? '隧道断开，正在重连（第 ' + (cloudflare?.restarts ?? 0) + ' 次）'
                          : cloudflare?.url || (cloudflare?.binary === 'missing' ? '未安装 cloudflared' : '—')
                  ),
                  downloadBar,
                  downloadNote,
                  cloudflare?.binary === 'missing' || cfDown
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button,
                          disabled: cfDown,
                          onClick: () => cloudflareAction('install')
                        },
                        cfDown ? '下载中' : cloudflare?.downloadError ? '重试下载（约 50 MB）' : '下载 cloudflared（约 50 MB）'
                      )
                    : h(
                        'button',
                        { type: 'button', className: CLS.button, disabled: busy || phaseBusy, onClick: () => cloudflareAction('restart') },
                        '重新连接'
                      ),
                  h(CopyButton, { text: cloudflare?.url || '' }),
                  // The tile says why a download failed (mirror 404, timeout) without a hidden console.
                  cloudflare?.downloadError && !cfDown ? h('p', { className: CLS.fieldTip }, '上次下载失败：' + cloudflare.downloadError) : null,
                  !cloudflare?.downloadError && cloudflare?.lastError ? h('p', { className: CLS.fieldTip }, cloudflare.lastError) : null,
                  cloudflare?.binary === 'ready' && !cloudflare?.url && !cfDown
                    ? h('p', { className: CLS.barNote }, '程序已就绪（' + formatBytes(cloudflare?.downloadBytes || 0) + '），打开开关后才会建立隧道。')
                    : null
                )
              : null,
            typeof window !== 'undefined' && window.DshApp && typeof window.DshApp.openSettings === 'function'
              ? h(
                  Field,
                  { label: 'App', tip: '改手机 App 里保存的地址和密码（相当于手机上点「重新配置连接」）。' },
                  h(
                    'button',
                    { type: 'button', className: CLS.button, onClick: () => window.DshApp.openSettings() },
                    '重新配置连接'
                  )
                )
              : null,
            status?.proxyPort
              ? h('p', { className: CLS.cardNote }, '插件 ' + (status?.pluginVersion || '未知') + ' · 网关监听 127.0.0.1:' + status.proxyPort + (status?.tlsPort ? '，自签 TLS 备用端口 ' + status.tlsPort : '') + '。')
              : null
          )
        ),

        h(
          Card,
          {
            title: '设备准入',
            desc: '谁可以连上这台电脑',
            aside: [
              h(
                'button',
                {
                  key: 'offline',
                  type: 'button',
                  className: CLS.button,
                  disabled: phaseBusy,
                  onClick: revokeAllDevices,
                  title: '断开所有设备并撤销信任：下次连接要重新允许（核对配对码）'
                },
                '全部下线'
              ),
              h(
                'button',
                {
                  key: 'reset',
                  type: 'button',
                  className: CLS.button,
                  disabled: phaseBusy,
                  onClick: () => deviceAction({ action: 'reset' }),
                  title: '清空设备与会话记录（黑名单也一起清空）'
                },
                '清空记录'
              ),
              h(
                'button',
                {
                  key: 'diag',
                  type: 'button',
                  className: CLS.button,
                  disabled: phaseBusy,
                  onClick: exportDiagnostics,
                  title: '导出一份不含密码/密钥/配对码的诊断 JSON，方便排查手机连不上'
                },
                '诊断包'
              )
            ]
          },
          h(
            'div',
            { className: CLS.fields },
            h(
              Field,
              {
                label: '首次连接',
                tip: requireApproval
                  ? '新设备输对密码后会停在这里；你核对 6 位配对码一致，再点「允许」。'
                  : '新设备输对密码直接进入；被「移除」过的设备仍然要在这里点允许。'
              },
              h(Seg, {
                options: [['yes', '需同意'], ['no', '免同意']],
                value: requireApproval ? 'yes' : 'no',
                onPick: (value) => saveAdmission({ requireApproval: value === 'yes' }),
                disabled: phaseBusy
              })
            ),
            h(
              Field,
              { label: '在线上限', tip: '0 = 不限；同一台手机多开标签算 1 台。' },
              h('input', {
                className: CLS.input,
                style: { maxWidth: '72px', flex: 'none', textAlign: 'center' },
                type: 'number',
                min: 0,
                max: 10,
                value: String(maxOnlineDraft ?? status?.settings?.maxOnlineDevices ?? 3),
                onChange: (event) => setMaxOnlineDraft(event.target.value),
                onBlur: commitMaxOnline,
                onKeyDown: (event) => { if (event.key === 'Enter') commitMaxOnline() }
              }),
              h('span', { className: CLS.deviceMeta }, '台')
            ),
            ...(status?.pending ?? []).map((request) =>
              h(
                'div',
                { className: CLS.pending, key: request.requestId },
                h(
                  'div',
                  { className: CLS.pendingHead },
                  h('span', { className: CLS.pendingTitle }, '等待你同意'),
                  h(
                    'span',
                    { className: CLS.tipLine },
                    (request.client === 'app' ? 'App' : '网页') + ' · ' + request.label + (request.clientVersion ? ' v' + request.clientVersion : '') + ' · 剩余 ' + Math.max(0, Math.round(((request.expiresAt ?? 0) - Date.now()) / 60000)) + ' 分'
                  )
                ),
                request.pairCode ? h('div', { className: CLS.pendingCode }, formatPairCode(request.pairCode)) : null,
                request.pairCode
                  ? h('p', { className: CLS.fieldTip, style: { marginTop: '4px' } }, '手机屏幕上也显示这串数字，两边一致再点「允许」。')
                  : null,
                confirmingRequest === request.requestId
                  ? h('p', { className: CLS.fieldTip, style: { marginTop: '8px' } }, '确认手机上显示的就是 ' + formatPairCode(request.pairCode) + ' ？')
                  : null,
                h(
                  'div',
                  { className: CLS.pendingActions },
                  confirmingRequest === request.requestId
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button + ' ' + CLS.buttonOn,
                          disabled: phaseBusy,
                          onClick: () => { setConfirmingRequest(null); approveDevice(request.deviceId, request.pairCode) }
                        },
                        '数字一致，允许'
                      )
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button + ' ' + CLS.buttonOn,
                          disabled: phaseBusy,
                          onClick: () => { if (request.pairCode) setConfirmingRequest(request.requestId); else approveDevice(request.deviceId) }
                        },
                        '允许'
                      ),
                  confirmingRequest === request.requestId
                    ? h('button', { type: 'button', className: CLS.button, disabled: phaseBusy, onClick: () => setConfirmingRequest(null) }, '取消')
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button,
                          disabled: phaseBusy,
                          onClick: () => denyRequest(request.requestId, request.deviceId)
                        },
                        '拒绝'
                      )
                )
              )
            ),
            // Devices that are still waiting are already shown in the card above; listing them
            // twice made the panel look like it had two of everything.
            ...(status?.deviceList ?? []).filter((device) => device.state !== 'pending').slice(0, 12).map((device) =>
              h(
                'div',
                { className: CLS.device, key: device.deviceId || device.latestId },
                h('i', {
                  className: CLS.dot + (device.online ? ' ' + CLS.dotOn : ''),
                  title: device.online ? '在线' : '离线'
                }),
                h(
                  'span',
                  { className: CLS.deviceName },
                  (device.client === 'app' ? 'App' : '网页') + ' · ' + device.label + (device.clientVersion ? ' v' + device.clientVersion : '')
                ),
                h(
                  'span',
                  { className: CLS.deviceMeta },
                  device.blocked
                    ? '已拉黑'
                    : device.online
                      ? '在线'
                      : device.trusted
                        ? '已授权 · ' + sinceText(device.lastSeen)
                        : device.state === 'pending'
                          ? '等待同意'
                          : '未授权'
                ),
                h(
                  'div',
                  { className: CLS.deviceActions },
                  device.blocked
                    ? h('button', { type: 'button', className: CLS.button, disabled: phaseBusy, onClick: () => unblacklistDevice(device.deviceId) }, '解除拉黑')
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button,
                          disabled: phaseBusy,
                          onClick: () => removeDevice(device.deviceId),
                          title: '断开当前连接并撤销信任，下次需重新允许'
                        },
                        '移除'
                      ),
                  device.blocked
                    ? null
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button,
                          disabled: phaseBusy,
                          onClick: () => blacklistDevice(device.deviceId),
                          title: '拉黑后该设备无法再登录'
                        },
                        '拉黑'
                      )
                )
              )
            ),
            ...(SHOW_PHONE_ASSIST
              ? [
                  h(
                    Field,
                    {
                      key: 'phone-switch',
                      label: '操作手机',
                      tip: status?.phone?.enabled
                        ? '手机 App 要开着；命令不排队，离线直接报错。'
                        : '默认关闭：agent 碰不到手机。开启后能读屏、点按、输入。'
                    },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: CLS.button + (status?.phone?.enabled ? ' ' + CLS.buttonOn : ''),
                        disabled: phaseBusy,
                        onClick: () => setPhoneAssist(!(status?.phone?.enabled ?? false)),
                        title: '关闭会立刻让正在执行的手机指令失败'
                      },
                      status?.phone?.enabled ? '已开启' : '已关闭'
                    )
                  ),
                  ...(status?.phone?.devices ?? [])
                    .filter((entry) => entry.authorized)
                    .map((entry) =>
                      h(
                        'div',
                        { className: CLS.device, key: 'phone-' + entry.deviceId },
                        h('i', {
                          className: CLS.dot + (entry.online ? ' ' + CLS.dotOn : ''),
                          title: entry.online ? '手机通道在线' : '手机通道离线'
                        }),
                        h('span', { className: CLS.deviceName }, entry.label),
                        h(
                          'span',
                          { className: CLS.deviceMeta },
                          (entry.online ? '通道在线' : '通道离线') + (entry.lastResultAt ? ' · ' + sinceText(entry.lastResultAt) : '')
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: CLS.button,
                            disabled: phaseBusy,
                            onClick: () => revokePhone(entry.deviceId),
                            title: '吊销这台手机的操作令牌，下次要用需重新连接'
                          },
                          '撤销授权'
                        )
                      )
                    ),
                  ...(status?.phone?.trace ?? []).slice(0, 5).map((entry, index) =>
                    h(
                      'div',
                      { className: CLS.device, key: 'phone-trace-' + index },
                      h('span', { className: CLS.deviceName }, entry.kind + ' · ' + entry.op + (entry.ms !== null && entry.ms !== undefined ? ' · ' + entry.ms + ' ms' : '')),
                      h('span', { className: CLS.deviceMeta }, sinceText(entry.at) + (entry.note ? ' · ' + entry.note : ''))
                    )
                  )
                ]
              : []),
            h('p', {
              className: CLS.cardNote,
              style: { marginTop: '4px' }
            }, '绿点是正在连接的设备，离线是灰点并排在后面。「移除」= 立刻断开并撤销信任，下次要重新允许；「拉黑」= 以后都不许连。')
          )
        ),

        h('p', { className: CLS.safety }, '安全：手机登录后拥有本机 owner 权限（可执行命令、读写文件）。请用长密码；建议保持「首次连接需同意」；关闭开关会立刻断开所有手机。')
      )
    }

    /**
     * Frame-wide approval prompt.
     *
     * A device that needs approval must be answered from the desktop, and the user may be looking
     * at any panel — so this lives in `shell.overlay` (the frame's own overlay seat) instead of in
     * the remote panel. It polls the same status route as the panel, shows the pairing code large,
     * and only sends an approval after the operator confirms the two screens agree.
     */
    const OVERLAY_POLL_MS = 1500
    const OVERLAY_SNOOZE_MS = 120000

    function ApprovalOverlay() {
      const [status, setStatus] = useState(null)
      const [confirmId, setConfirmId] = useState(null)
      const [sending, setSending] = useState(false)
      const [error, setError] = useState(null)
      const [snooze, setSnooze] = useState({})

      const load = async () => {
        // A hidden window keeps the request pending on the phone; polling it costs nothing but
        // waking the GPU, so skip it.
        if (typeof document !== 'undefined' && document.hidden) return
        try {
          const response = await fetch(STATUS_PATH, { credentials: 'include', cache: 'no-store' })
          if (!response.ok) return
          setStatus(await response.json())
        } catch {
          /* the panel already reports an unreachable host; an overlay must never throw */
        }
      }

      useEffect(() => {
        let alive = true
        const tick = () => { if (alive) load() }
        tick()
        const timer = setInterval(tick, OVERLAY_POLL_MS)
        const onVisible = () => { if (!document.hidden) tick() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      const pending = Array.isArray(status?.pending) ? status.pending : []
      const queue = pending.filter((entry) => !(snooze[entry.requestId] > Date.now()))
      const active = queue[0] || null
      const now = useNow(Boolean(active), 1000)

      if (!active) return null

      const confirming = confirmId === active.requestId
      const minutesLeft = Math.max(0, Math.ceil(((active.expiresAt ?? 0) - now) / 60000))
      const act = async (payload) => {
        setError(null)
        setSending(true)
        try {
          const next = await postJson(DEVICES_PATH, payload)
          if (next?.error) setError(next.error)
          else if (next && next.phase) setStatus(next)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setSending(false)
          setConfirmId(null)
          load()
        }
      }
      const approve = () => act({ action: 'approve', deviceId: active.deviceId, code: active.pairCode })
      const deny = () => act({ action: 'deny', requestId: active.requestId, deviceId: active.deviceId })
      const snoozeNow = () =>
        setSnooze((previous) => ({ ...previous, [active.requestId]: Date.now() + OVERLAY_SNOOZE_MS }))

      return h(
        'div',
        { className: 'dru-mask', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设备连接请求' },
        h(
          'div',
          { className: 'dru-dialog' },
          h(
            'div',
            { className: 'dru-dialog-head' },
            h('span', { className: CLS.dot + ' ' + CLS.dotBusy }),
            '有设备请求连接'
          ),
          h(
            'div',
            { className: 'dru-dialog-device' },
            (active.client === 'app' ? 'App' : '网页')
              + ' · ' + (active.label || '未知设备')
              + (active.clientVersion ? ' v' + active.clientVersion : '')
              + ' · 剩余 ' + minutesLeft + ' 分'
          ),
          active.pairCode ? h('div', { className: 'dru-code' }, formatPairCode(active.pairCode)) : null,
          h(
            'p',
            { className: 'dru-dialog-hint' },
            active.pairCode
              ? confirming
                ? '确认手机屏幕上显示的就是这串数字，再点下面的按钮。'
                : '手机上也显示这串数字；两边一致才点「允许」。'
              : '这台设备请求进入本机 DSH，确认是你就允许。'
          ),
          error ? h('div', { className: 'dru-dialog-error' }, error) : null,
          pending.length > 1
            ? h('div', { className: 'dru-dialog-more' }, '还有 ' + (pending.length - 1) + ' 台在排队')
            : null,
          h(
            'div',
            { className: 'dru-dialog-actions' },
            h(
              'button',
              { type: 'button', className: 'dru-dialog-btn dru-dialog-btn-quiet', disabled: sending, onClick: snoozeNow },
              '稍后'
            ),
            confirming
              ? h('button', { type: 'button', className: 'dru-dialog-btn', disabled: sending, onClick: () => setConfirmId(null) }, '取消')
              : h('button', { type: 'button', className: 'dru-dialog-btn', disabled: sending, onClick: deny }, '拒绝'),
            confirming
              ? h('button', { type: 'button', className: 'dru-dialog-btn dru-dialog-btn-primary', disabled: sending, onClick: approve }, '数字一致，允许')
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dru-dialog-btn dru-dialog-btn-primary',
                    disabled: sending,
                    onClick: () => {
                      setError(null)
                      if (active.pairCode) setConfirmId(active.requestId)
                      else approve()
                    }
                  },
                  '允许'
                )
          )
        )
      )
    }

    function PanelIcon({ size }) {
      return h(
        'svg',
        { width: size || 20, height: size || 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 8, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M4.5 9h15M4.5 15h15', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M12 4c2 2.2 3 4.9 3 8s-1 5.8-3 8c-2-2.2-3-4.9-3-8s1-5.8 3-8Z', stroke: 'currentColor', strokeWidth: 1.6 })
      )
    }

    // ── mobile skin ─────────────────────────────────────────────────────────
    // Only on narrow screens (the desktop Electron window stays untouched). The DSH layout
    // keeps its sidebar/tool columns inline, which squeezes the chat into ~110 px on a
    // phone; here an expanded sidebar or the right column becomes a fixed overlay with a
    // backdrop instead of a flex column, and the drawer closes after a session switch.

    const MOBILE_CSS = `
html[data-dru-mobile], html[data-dru-mobile] body{overscroll-behavior-y:contain}
html[data-dru-mobile] body{-webkit-tap-highlight-color:transparent}
/* The rail costs 56 px of chat width on a phone; hide it and use the floating logo. */
html[data-dru-mobile] [class*="_frame"][style*="grid-template-columns"]{grid-template-columns:0px minmax(0px,1fr) 0px!important}
html[data-dru-mobile] [class*="_sidebarCol"]{display:none}
html[data-dru-mobile] [class*="_centerCol"]{grid-column:2!important}
html[data-dru-mobile] [class*="_rightbarCol"]{grid-column:3!important}
html[data-dru-mobile] [class*="_headerLeading"]{margin-left:38px!important}
/* The chat header's status chips (mode / subagents / jobs) squeeze the title; hide the
   original row and mirror it into our own strip below the tabs. */
html[data-dru-mobile] [class*="_centerCol"] [class*="_headerActions"]{display:none!important}
html[data-dru-mobile] .dru-mobile-status{position:absolute;right:12px;bottom:4px;height:27px;display:flex;align-items:center;gap:4px;max-width:calc(100% - 160px);overflow:hidden;font-size:10.5px;line-height:20px;color:var(--dsw-alias-label-tertiary,#adb2b8);pointer-events:none;z-index:6}
html[data-dru-mobile] .dru-mobile-status:empty{display:none}
html[data-dru-mobile] .dru-mobile-status-chip{pointer-events:auto;position:relative;z-index:1;flex:none;display:inline-flex;align-items:center;height:24px;gap:3px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.22));background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 72%, transparent);white-space:nowrap;color:var(--dsw-alias-label-secondary,#cfd3d6);touch-action:manipulation}
html[data-dru-mobile] .dru-mobile-status-chip.is-dropdown{cursor:pointer;transition:transform .12s ease,background .12s ease}.dru-mobile-status-chip.is-dropdown:active{transform:scale(.96);background:var(--dsw-alias-interactive-bg-hover)}
html[data-dru-mobile] .dru-mobile-status-caret{font-size:7px;line-height:1;opacity:.65;transform:translateY(.5px)}
html[data-dru-mobile] .dru-mobile-status-pop{position:fixed;z-index:200;max-width:260px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-3,#353638);color:var(--dsw-alias-label-primary,#e8eaee);box-shadow:0 10px 30px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:1.5}
html[data-dru-mobile] .dru-mobile-status-pop b{font-weight:600}
html[data-dru-mobile] .dru-mobile-status-pop span{color:var(--dsw-alias-label-secondary,#adb2b8);font-size:11px;line-height:1.6}
/* While the soft keyboard is open the whale mascot would cover the composer / send button. */
html[data-dru-mobile].dru-keyboard-open .dshwv-root{display:none!important}
/* Session rows: keep the trailing "..." menu visible (there is no hover on a phone) and make the
   title text non-interactive so tapping a row can never start an inline rename. */
html[data-dru-mobile] [class*="_sessionRow"]{position:relative}
html[data-dru-mobile] [class*="_sessionRow"] [class*="_time"]{display:none!important}
html[data-dru-mobile] [class*="_sessionRow"] [class*="_rowActions"]{position:absolute!important;right:6px;top:50%;transform:translateY(-50%);display:flex!important;align-items:center;width:auto!important;max-width:none!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;z-index:2}
/* Keep only the "..." menu on a phone: archive/pin buttons are too easy to hit by accident. */
html[data-dru-mobile] [class*="_sessionRow"] [aria-label*="归档"],
html[data-dru-mobile] [class*="_sessionRow"] [aria-label*="固定"],
html[data-dru-mobile] [class*="_sessionRow"] [title*="归档"],
html[data-dru-mobile] [class*="_sessionRow"] [title*="固定"]{display:none!important}
html[data-dru-mobile] [class*="_sessionRow"] [class*="_title"]{pointer-events:none;padding-right:32px;overflow:hidden;text-overflow:clip;white-space:nowrap;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent)}
/* Settings dialog: DSH keeps its desktop two-column layout (nav 188px + content squeezes to
   ~150px on a phone, so text renders vertically). Turn it into a full-screen sheet with the
   nav as a horizontal tab strip and the content taking the full width. */
html[data-dru-mobile] [role="dialog"]:has(> nav){position:fixed!important;inset:0!important;width:100vw!important;max-width:none!important;height:100%!important;max-height:none!important;border-radius:0!important;flex-direction:column!important;overflow:hidden!important}
html[data-dru-mobile] [role="dialog"]:has(> nav) > nav{flex:none!important;width:100%!important;height:auto!important;max-height:none!important;flex-direction:column!important;border-right:0!important;border-bottom:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.2))!important;padding:0!important}
html[data-dru-mobile] [role="dialog"]:has(> nav) > nav [class*="_navList"]{flex-direction:row!important;overflow-x:auto!important;overflow-y:hidden!important;gap:6px!important;padding:6px 12px 10px!important}
html[data-dru-mobile] [role="dialog"]:has(> nav) > nav [class*="_navCell"]{flex:none!important;width:auto!important;white-space:nowrap!important}
html[data-dru-mobile] [role="dialog"]:has(> nav) > div:not(nav){flex:1 1 auto!important;width:100%!important;max-width:100vw!important;box-sizing:border-box!important;min-width:0!important;min-height:0!important;overflow:auto!important;padding:12px 14px 20px!important}
/* Momentary off-screen anchor so the shell's own dropdown positions under our chip. */
html[data-dru-mobile] [class*="_headerActions"].dru-status-probe{display:flex!important;position:fixed!important;opacity:0!important;pointer-events:none!important;z-index:-1;width:auto!important;max-width:none!important;grid-row:auto!important;grid-column:auto!important}
/* Subagent / background-job dropdowns: on a phone they were floating mid-content because
   their anchor is the hidden header pill. Turn them into a solid sheet right under the header. */
html[data-dru-mobile] [class*="rezYhW_menu"],
html[data-dru-mobile] [class*="Ag-ohG_menu"]{position:fixed!important;left:12px!important;right:12px!important;top:84px!important;width:auto!important;min-width:0!important;max-width:none!important;max-height:min(62vh,460px)!important;overflow:auto!important;z-index:120!important;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.25))!important;border-radius:14px!important;background:var(--dsw-alias-bg-layer-1,#fff)!important;box-shadow:0 16px 48px rgba(0,0,0,.35)!important}
html[data-dru-mobile] [class*="rezYhW_menuBody"],
html[data-dru-mobile] [class*="Ag-ohG_menuBody"]{max-height:none!important}
/* The "用资源管理器打开" split button overlaps the other header utilities on a phone. */
html[data-dru-mobile] [aria-label*="资源管理器"]{display:none!important}
html[data-dru-mobile] [class*="_headerUtilities"] > * > *:first-child{display:none!important}
/* Top bar polish: opaque enough that nested popovers keep their own blur, softer chrome. */
html[data-dru-mobile] [class*="_centerCol"] [class*="_header"]{position:relative;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 94%, transparent);border-bottom:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.18));box-shadow:0 1px 0 rgba(0,0,0,.18)}
html[data-dru-mobile] [class*="_centerCol"] [class*="_titleRow"]{gap:8px}
html[data-dru-mobile] [class*="_centerCol"] [class*="_headerUtilities"]{gap:2px}
html[data-dru-mobile] [class*="_centerCol"] [class*="_tabs"]{padding-inline:4px}
/* Popovers rendered inside the phone header: force a solid surface so text never bleeds. */
html[data-dru-mobile] [role="menu"]{background:var(--dsw-alias-bg-layer-3,#353638)!important}
html[data-dru-mobile].dru-drawer-open [class*="_sidebarCol"]{display:block!important;position:fixed!important;left:0;top:0;bottom:0;width:min(88vw,320px)!important;z-index:70;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.22));box-shadow:0 0 60px rgba(0,0,0,.55)}
html[data-dru-mobile].dru-right-open [class*="_rightbarCol"]{position:fixed!important;left:0;top:0;bottom:0;width:100vw!important;max-width:none;z-index:71;background:var(--dsw-alias-bg-layer-1);border:0}
.dru-mobile-backdrop{position:fixed;inset:0;z-index:69;background:rgba(0,0,0,.5);backdrop-filter:blur(1.5px);animation:dru-mobile-fade .16s ease-out}
@keyframes dru-mobile-fade{from{opacity:0}to{opacity:1}}
html[data-dru-mobile] .dru-mobile-launcher{position:fixed;left:8px;top:8px;width:34px;height:34px;padding:0;z-index:68;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.25));cursor:pointer}
html[data-dru-mobile] .dru-mobile-launcher img{width:20px;height:20px;display:block}
html[data-dru-mobile] .dru-mobile-launcher:active{transform:scale(.94)}
html[data-dru-mobile].dru-drawer-open .dru-mobile-launcher,html[data-dru-mobile].dru-right-open .dru-mobile-launcher{display:none}
`

    function installMobileSkin() {
      const query = window.matchMedia('(max-width: 760px)')
      let teardown = null
      const sync = () => {
        if (!query.matches) {
          if (teardown) { teardown(); teardown = null }
          return
        }
        if (!teardown) teardown = setupMobileSkin()
      }
      query.addEventListener('change', sync)
      sync()
      return () => {
        query.removeEventListener('change', sync)
        if (teardown) { teardown(); teardown = null }
      }
    }

    function setupMobileSkin() {
      const root = document.documentElement
      const styleId = 'dru-mobile-style'
      let styleNode = document.getElementById(styleId)
      if (!styleNode) {
        styleNode = document.createElement('style')
        styleNode.id = styleId
        document.head.appendChild(styleNode)
      }
      styleNode.textContent = MOBILE_CSS

      const viewport = document.querySelector('meta[name="viewport"]')
      const previousViewport = viewport ? viewport.getAttribute('content') : null
      // `interactive-widget=resizes-content` makes the soft keyboard resize the layout viewport
      // instead of only the visual viewport, so the composer's paint box and hit box stay together.
      if (viewport) {
        viewport.setAttribute(
          'content',
          'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'
        )
      }
      root.setAttribute('data-dru-mobile', '')

      let backdrop = null
      const ensureBackdrop = (show) => {
        if (show && !backdrop) {
          backdrop = document.createElement('div')
          backdrop.className = 'dru-mobile-backdrop'
          backdrop.addEventListener('click', () => closePanels())
          document.body.appendChild(backdrop)
        } else if (!show && backdrop) {
          backdrop.remove()
          backdrop = null
        }
      }
      const clickLabel = (label) => {
        const button = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === label)
        if (button) button.click()
      }

      // One floating Harness logo replaces the 56 px rail; tapping it opens the drawer.
      const launcher = document.createElement('button')
      launcher.type = 'button'
      launcher.className = 'dru-mobile-launcher'
      launcher.setAttribute('aria-label', '打开侧边栏')
      launcher.title = '打开侧边栏'
      const launcherLogo = document.createElement('img')
      launcherLogo.alt = 'DeepSeek Harness'
      // The default wordmark is dark; on a dark theme use the light variant so it stays visible.
      const darkScheme = window.matchMedia('(prefers-color-scheme: dark)')
      const syncLauncherLogo = () => {
        launcherLogo.src = darkScheme.matches ? '/favicon-dark.svg' : '/favicon.svg'
      }
      syncLauncherLogo()
      darkScheme.addEventListener?.('change', syncLauncherLogo)
      launcher.appendChild(launcherLogo)
      launcher.addEventListener('click', () => {
        showPetWhale()
        clickLabel('打开侧边栏')
      })
      document.body.appendChild(launcher)
      const closePanels = () => {
        if (root.classList.contains('dru-drawer-open')) {
          clickLabel('收起侧边栏')
          root.classList.remove('dru-drawer-open')
        }
        if (root.classList.contains('dru-right-open')) {
          clickLabel('收起右侧边栏')
          root.classList.remove('dru-right-open')
        }
        ensureBackdrop(false)
      }
      // The shell's own status chips hide behind our CSS; mirror them into a third header
      // row so the mode / subagent / job counts stay readable under the title.
      const statusBar = document.createElement('div')
      statusBar.className = 'dru-mobile-status'
      let statusWatch = null
      let watchedActions = null
      let statusKey = ''

      const readStatusItems = () => {
        const header = document.querySelector('[class*="_centerCol"] header')
        const actions = header ? header.querySelector('[class*="_headerActions"]') : null
        if (!actions) return []
        const items = []
        const modeLabel = actions.querySelector('[class*="_label"]')
        if (modeLabel && modeLabel.textContent.trim()) {
          items.push({ text: modeLabel.textContent.trim(), dropdown: true })
        }
        for (const button of actions.querySelectorAll('button')) {
          const text = (button.textContent || '').trim()
          if (!text) continue
          const agents = text.match(/(\d+)\s*个子智能体/)
          const jobs = text.match(/(\d+)\s*个后台任务/)
          if (agents) items.push({ text: agents[1] + ' 智能体', button, dropdown: true })
          else if (jobs) items.push({ text: jobs[1] + ' 后台任务', button, dropdown: true })
        }
        return items
      }

      // Mode dropdown: open the shell's own preset menu when a trigger exists, otherwise
      // explain where the preset is chosen (an open session's preset is fixed).
      let modePopover = null
      const closeModePopover = () => {
        if (modePopover) modePopover.remove()
        modePopover = null
      }
      const toggleModePopover = (chip, label) => {
        if (modePopover) {
          closeModePopover()
          return
        }
        const popover = document.createElement('div')
        popover.className = 'dru-mobile-status-pop'
        const title = document.createElement('b')
        title.textContent = '当前会话预设：' + label
        const hint = document.createElement('span')
        hint.textContent = '预设按会话固定。新建会话时，可在输入框左侧的预设按钮切换。'
        popover.appendChild(title)
        popover.appendChild(hint)
        document.body.appendChild(popover)
        modePopover = popover
        const rect = chip.getBoundingClientRect()
        const width = popover.offsetWidth
        popover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px'
        popover.style.top = rect.bottom + 6 + 'px'
        setTimeout(() => {
          document.addEventListener('click', closeModePopover, { once: true })
        }, 0)
      }

      // The shell's dropdown anchors to its hidden trigger; park that trigger under our chip
      // for the instant the menu opens, then restore the hidden state.
      const openDropdownFrom = (button, chip) => {
        const actions = button.closest('[class*="_headerActions"]')
        if (!actions) {
          button.click()
          return
        }
        const rect = chip.getBoundingClientRect()
        actions.classList.add('dru-status-probe')
        actions.style.left = Math.round(rect.left) + 'px'
        actions.style.top = Math.round(rect.bottom + 4) + 'px'
        button.click()
        setTimeout(() => {
          actions.classList.remove('dru-status-probe')
          actions.style.left = ''
          actions.style.top = ''
        }, 80)
      }

      const renderStatusItems = () => {
        const items = readStatusItems()
        const key = items.map((item) => item.text + (item.dropdown ? '*' : '')).join('|')
        if (key === statusKey) return
        statusKey = key
        statusBar.textContent = ''
        for (const item of items) {
          const chip = document.createElement('span')
          chip.className = 'dru-mobile-status-chip' + (item.dropdown ? ' is-dropdown' : '')
          chip.textContent = item.text
          if (item.dropdown) {
            const caret = document.createElement('span')
            caret.className = 'dru-mobile-status-caret'
            caret.textContent = '▾'
            chip.appendChild(caret)
            chip.setAttribute('role', 'button')
            chip.setAttribute('aria-haspopup', 'menu')
          }
          if (item.button) {
            chip.addEventListener('click', () => {
              if (item.dropdown) openDropdownFrom(item.button, chip)
              else item.button.click()
            })
          } else if (item.dropdown) {
            chip.addEventListener('click', () => toggleModePopover(chip, item.text))
          }
          statusBar.appendChild(chip)
        }
      }

      const syncStatus = () => {
        const header = document.querySelector('[class*="_centerCol"] header')
        if (!header) return
        if (statusBar.parentElement !== header) header.appendChild(statusBar)
        const actions = header.querySelector('[class*="_headerActions"]')
        if (actions && actions !== watchedActions) {
          if (statusWatch) statusWatch.disconnect()
          watchedActions = actions
          statusWatch = new MutationObserver(() => renderStatusItems())
          statusWatch.observe(actions, { childList: true, subtree: true, characterData: true })
        }
        renderStatusItems()
      }

      const sync = () => {
        // Read the shell's own inline grid template instead of measured widths: our CSS
        // forces the columns to 0 while open, so measuring them would feed back forever.
        const frame = document.querySelector('[class*="_frame"][style*="grid-template-columns"]')
        const template = frame ? (frame.getAttribute('style') || '').match(/grid-template-columns:\s*([^;]+)/) : null
        const columns = template ? template[1] : ''
        const firstPx = Number((columns.match(/^\s*([\d.]+)px/) || [])[1] || 0)
        const pxValues = [...columns.matchAll(/([\d.]+)px/g)].map((m) => Number(m[1]))
        const rightPx = pxValues.length ? pxValues[pxValues.length - 1] : 0
        const drawerOpen = firstPx > 90
        const rightOpen = rightPx > 90
        root.classList.toggle('dru-drawer-open', drawerOpen)
        root.classList.toggle('dru-right-open', rightOpen)
        ensureBackdrop(drawerOpen || rightOpen)
        syncStatus()
      }

      const resize = new ResizeObserver(() => sync())
      const observeColumns = () => {
        const sidebar = document.querySelector('[class*="_sidebarCol"]')
        const right = document.querySelector('[class*="_rightbarCol"]')
        if (sidebar) resize.observe(sidebar)
        if (right) resize.observe(right)
      }
      observeColumns()
      const mutations = new MutationObserver(() => { observeColumns(); sync() })
      mutations.observe(document.body, { childList: true, subtree: true })

      // A session switch rewrites <title>; close the drawer so the chat is visible.
      const titleNode = document.querySelector('title')
      const titleWatch = titleNode
        ? new MutationObserver(() => {
            showPetWhale()
            if (root.classList.contains('dru-drawer-open')) setTimeout(closePanels, 220)
          })
        : null
      if (titleNode && titleWatch) titleWatch.observe(titleNode, { childList: true, characterData: true, subtree: true })

      const onSidebarClick = (event) => {
        const target = event.target
        if (!target || !target.closest || !target.closest('[class*="_sidebarCol"]')) return
        setTimeout(() => {
          // If the frame still reports the drawer open after the click settled, leave it:
          // the title observer handles real session switches.
          sync()
        }, 400)
      }
      document.addEventListener('click', onSidebarClick, true)

      // A double-tap on a session row used to open the inline rename editor (looks like an input
      // flashing for a moment). Rename stays available from the row's "..." menu instead.
      const onSessionDblclick = (event) => {
        const target = event.target
        if (!target || !target.closest) return
        if (!target.closest('[class*="_sessionRow"]')) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      document.addEventListener('dblclick', onSessionDblclick, true)

      // On a phone the IME's Enter should insert a newline, not send the message. Intercept the
      // plain Enter inside the chat textbox; Shift/Ctrl+Enter and IME composition are untouched.
      const onComposerKeydown = (event) => {
        if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        const target = event.target
        if (!target || target.nodeType !== 1) return
        if (target.getAttribute('role') !== 'textbox' || target.getAttribute('contenteditable') === null) return
        event.preventDefault()
        event.stopImmediatePropagation()
        // The composer is a Lexical editor: it understands Shift+Enter as "insert line break".
        // Forward a synthetic Shift+Enter so the phone keyboard's plain Enter becomes a newline.
        try {
          target.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              shiftKey: true,
              bubbles: true,
              cancelable: true
            })
          )
        } catch {
          /* ignore */
        }
      }
      document.addEventListener('keydown', onComposerKeydown, true)

      // Hide the whale only while the composer/keyboard is active, and make recovery bullet-proof:
      // Android WebViews do not reliably fire resize/blur when the keyboard closes, so the pet
      // must come back on blur, on any tap outside the composer, and via a periodic safety check.
      const isComposer = (element) =>
        Boolean(
          element &&
            element.nodeType === 1 &&
            element.getAttribute('role') === 'textbox' &&
            element.getAttribute('contenteditable') !== null
        )
      const showPetWhale = () => root.classList.remove('dru-keyboard-open')
      const hidePetWhale = () => root.classList.add('dru-keyboard-open')
      const onComposerFocusIn = (event) => {
        if (isComposer(event.target)) hidePetWhale()
      }
      const onComposerFocusOut = (event) => {
        if (!isComposer(event.target)) return
        setTimeout(() => {
          if (!isComposer(document.activeElement)) showPetWhale()
        }, 150)
      }
      const onOutsidePointer = (event) => {
        const target = event.target
        if (!target || !target.closest) return
        if (!target.closest('[role="textbox"][contenteditable]')) showPetWhale()
      }
      document.addEventListener('focusin', onComposerFocusIn, true)
      document.addEventListener('focusout', onComposerFocusOut, true)
      document.addEventListener('pointerdown', onOutsidePointer, true)
      const petWhaleWatch = setInterval(() => {
        if (!root.classList.contains('dru-keyboard-open')) return
        const composer = document.querySelector('[role="textbox"][contenteditable]')
        if (!composer || document.activeElement !== composer) showPetWhale()
      }, 700)
      showPetWhale()

      sync()
      return () => {
        resize.disconnect()
        mutations.disconnect()
        if (titleWatch) titleWatch.disconnect()
        document.removeEventListener('click', onSidebarClick, true)
        document.removeEventListener('dblclick', onSessionDblclick, true)
        document.removeEventListener('keydown', onComposerKeydown, true)
        document.removeEventListener('focusin', onComposerFocusIn, true)
        document.removeEventListener('focusout', onComposerFocusOut, true)
        document.removeEventListener('pointerdown', onOutsidePointer, true)
        clearInterval(petWhaleWatch)
        ensureBackdrop(false)
        root.classList.remove('dru-drawer-open', 'dru-right-open', 'dru-keyboard-open')
        root.removeAttribute('data-dru-mobile')
        darkScheme.removeEventListener?.('change', syncLauncherLogo)
        launcher.remove()
        statusBar.remove()
        closeModePopover()
        document.removeEventListener('click', closeModePopover)
        if (statusWatch) statusWatch.disconnect()
        styleNode.remove()
        if (viewport && previousViewport !== null) viewport.setAttribute('content', previousViewport)
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureStyles()
        ctx.effect(() => installMobileSkin(), 'dsh-mobile-harness: mobile skin')
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '远程' },
            PanelIcon
          )
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({}) }, RemotePage)
        )
        // The frame's overlay seat: a pending connection is answered on top of whatever panel is
        // open, not by walking back to 「远程」.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-mobile-harness-approval' }, ApprovalOverlay)
        )
      }
    }
  }
})
