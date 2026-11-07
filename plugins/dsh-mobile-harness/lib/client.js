/**
 * Browser half of the in-app remote-access switch.
 *
 * Registers the sidebar entry ("远程") and the main panel: a switch plus a "小屏幕" that
 * shows the phone URL, an explicitly revealed password, a one-time QR ticket and the
 * live connection count. Management is available through the local DSH connection only.
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

    /** 1762312345678 -> "11-04 11:12" (todays only show the clock, yesterdays gain the date). */
    function formatFileDate(ms) {
      const value = new Date(Number(ms))
      if (!Number.isFinite(value.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      const clock = pad(value.getHours()) + ':' + pad(value.getMinutes())
      const today = new Date()
      if (value.toDateString() === today.toDateString()) return clock
      return pad(value.getMonth() + 1) + '-' + pad(value.getDate()) + ' ' + clock
    }

    /** "holiday.mp4" -> "MP4"; the extension badge in the file row. */
    function fileExt(name) {
      const dot = String(name || '').lastIndexOf('.')
      if (dot === -1 || dot === String(name).length - 1) return 'FILE'
      return String(name).slice(dot + 1).toUpperCase().slice(0, 4)
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
    const PENDING_PATH = '/api/dsh-mobile-harness.pending'
    const TOGGLE_PATH = '/api/dsh-mobile-harness.toggle'
    const PASSWORD_PATH = '/api/dsh-mobile-harness.password'
    const EXTERNAL_PATH = '/api/dsh-mobile-harness.external'
    const RESET_PATH = '/api/dsh-mobile-harness.reset'
    const DEVICES_PATH = '/api/dsh-mobile-harness.devices'
    const CLOUDFLARED_PATH = '/api/dsh-mobile-harness.cloudflared'
    const SELFCHECK_PATH = '/api/dsh-mobile-harness.selfcheck'
    const LAN_PATH = '/api/dsh-mobile-harness.lan'
    const UI_PATH = '/api/dsh-mobile-harness.ui'
    const UPDATE_PATH = '/api/dsh-mobile-harness.update'
    const FILE_POOL_PATH = '/api/dsh-mobile-harness.pool'
    const FILE_POOL_PICK_PATH = '/api/dsh-mobile-harness.poolpick'
    // File pool owned by this plugin alone (lib/files.js): no other plugin has to be installed.
    const FILES_PATH = '/api/dsh-mobile-harness.files'
    const FILE_UPLOAD_PATH = '/api/dsh-mobile-harness.upload'
    const FILE_DOWNLOAD_PATH = '/api/dsh-mobile-harness.file'
    const FILE_DELETE_PATH = '/api/dsh-mobile-harness.delete'

    const CLS = {
      page: 'dru-page',
      header: 'dru-header',
      title: 'dru-title',
      subtitle: 'dru-subtitle',
      switchButton: 'dru-switch',
      switchOn: 'dru-switch-on',
      switchThumb: 'dru-switch-thumb',
      lanBox: 'dru-lan-box',
      lanCard: 'dru-lan-card',
      lanCardOn: 'dru-lan-card-on',
      lanMain: 'dru-lan-main',
      lanAddr: 'dru-lan-addr',
      lanNic: 'dru-lan-nic',
      lanSwitch: 'dru-lan-switch',
      lanSwitchOn: 'dru-lan-switch-on',
      lanThumb: 'dru-lan-thumb',
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
      tabBar: 'dru-tab-bar',
      tabBtn: 'dru-tab-btn',
      tabBtnOn: 'dru-tab-btn-on',
      cardHidden: 'dru-card-hidden',
      tabMeta: 'dru-tab-meta',
      tabVersion: 'dru-tab-version',
      tabUpdate: 'dru-tab-update',
      uploadBox: 'dru-upload',
      uploadHot: 'dru-upload-hot',
      uploadTitle: 'dru-upload-title',
      uploadHint: 'dru-upload-hint',
      uploadInput: 'dru-upload-input',
      queueRow: 'dru-queue-row',
      progress: 'dru-progress',
      progressBar: 'dru-progress-bar',
      fileList: 'dru-file-list',
      fileRow: 'dru-file-row',
      poolRow: 'dru-pool-row',
      fileExt: 'dru-file-ext',
      fileMeta: 'dru-file-meta',
      fileName: 'dru-file-name',
      fileSub: 'dru-file-sub',
      fileEmpty: 'dru-file-empty',
      portRow: 'dru-port-row',
      portChip: 'dru-port-chip',
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
/* Top tab bar, in the same shape as the memory panel: text tabs over a hairline, active one underlined. */
.dru-tab-bar{display:flex;gap:2px;max-width:860px;margin:2px 0 2px;border-bottom:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.2))}
.dru-tab-btn{position:relative;appearance:none;border:0;background:none;padding:9px 14px 11px;font:inherit;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:8px 8px 0 0;transition:color .12s ease,background .12s ease}
.dru-tab-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.dru-tab-btn-on{color:var(--dsw-alias-label-primary);font-weight:600}
.dru-tab-btn-on::after{content:'';position:absolute;left:14px;right:14px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dru-tab-meta{display:flex;align-items:center;gap:8px;margin-left:auto;padding-bottom:4px}
.dru-tab-version{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dru-tab-update{margin:0;padding:1px 8px;border:1px solid #f5b800;border-radius:999px;background:#fff3c4;color:#8a5b00;font-size:11px;line-height:16px;cursor:pointer;white-space:nowrap}
.dru-tab-update:hover{background:#ffe27a;color:#6b4600}
.dru-card-hidden{display:none!important}
.dru-upload{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:4px;padding:22px 18px;border:1.5px dashed var(--dsw-alias-line-1,rgba(128,128,128,.35));border-radius:12px;background:rgba(128,128,128,.04);text-align:center;cursor:pointer;transition:border-color .12s,background .12s}
.dru-upload:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.06)}
.dru-upload-hot{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.1)}
.dru-upload-title{font-size:14px;font-weight:600;line-height:20px}
.dru-upload-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dru-upload-input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0}
.dru-queue-row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:10px;font-size:12px}
.dru-progress{grid-column:1 / -1;height:4px;border-radius:2px;background:rgba(128,128,128,.16);overflow:hidden}
.dru-progress-bar{height:100%;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .2s}
.dru-file-list{list-style:none;margin:12px 0 0;padding:0}
.dru-pool-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 6px}
.dru-pool-row .dru-input{flex:1;min-width:0}
.dru-file-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.16))}
.dru-file-ext{flex:none;width:40px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.03em;padding:6px 0;border-radius:6px;background:rgba(128,128,128,.12);color:var(--dsw-alias-label-secondary)}
.dru-file-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dru-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.dru-file-sub{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dru-file-empty{margin:14px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dru-port-row{flex-basis:100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 0}
.dru-port-chip{display:inline-flex;align-items:center;padding:1px 9px;border-radius:999px;border:1px solid #bfd4ff;background:#eef4ff;color:#1d4ed8;font:600 13px/20px ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;user-select:all}
.dru-port-chip:hover{background:#dfeaff}
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
/* LAN picker: one frame, one card per adapter, a switch at the end of every card. */
.dru-lan-box{display:flex;flex-direction:column;gap:8px;width:100%;padding:8px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.28));border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dru-lan-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-line-1,rgba(128,128,128,.24));border-radius:10px;background:var(--dsw-alias-bg-layer-2);transition:border-color .15s,background .15s}
.dru-lan-card-on{border-color:color-mix(in srgb,var(--dsw-alias-accent,#4c8dff) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-accent,#4c8dff) 10%,var(--dsw-alias-bg-layer-2))}
.dru-lan-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dru-lan-addr{font-size:13px;line-height:20px}
.dru-lan-nic{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a93a3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dru-lan-switch{position:relative;flex:none;width:40px;height:24px;margin:0;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;transition:background .18s}
.dru-lan-switch:disabled{cursor:progress;opacity:.7}
.dru-lan-switch-on{background:var(--dsw-alias-accent,#4c8dff)}
.dru-lan-thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .18s}
.dru-lan-switch-on .dru-lan-thumb{transform:translateX(16px)}
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
html[data-dru-mobile][data-dru-layout="compact"] .dru-page{padding-top:64px}
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

    // Poll cadence for the full status snapshot: quiet when idle, the old 1 s rhythm while the
    // switch is moving (or a cloudflared download is running, because its bar must animate).
    const STATUS_IDLE_MS = 3000
    const STATUS_BUSY_MS = 1000
    // The host caps its long poll at 15 s. If the route is not available, fall back to a plain
    // 5 s GET; either way the overlay never downloads the full status snapshot.
    const PENDING_WAIT_MS = 15000
    const PENDING_FALLBACK_MS = 5000

    function statusIsBusy(body) {
      if (!body) return false
      if (body.phase === 'starting' || body.phase === 'stopping' || body.busy) return true
      return Boolean(body.cloudflare && body.cloudflare.downloading)
    }

    /**
     * One polling loop with subscribers.
     *
     * Both halves of this plugin render the same state: the panel and the frame-wide approval
     * overlay. A module-level feed gives every mounted component one shared request instead of
     * one request each, pauses while the page is hidden, and stops completely when the last
     * subscriber unmounts. `refresh()` forces the next answer (used after an action changed the
     * state); `push()` plants a snapshot that came back from a POST so the UI updates at once.
     */
    function createFeed(spec) {
      const listeners = new Set()
      let current = null
      let lastError = null
      let timer = null
      let inflight = null
      let visibilityBound = false

      const isHidden = () => typeof document !== 'undefined' && document.hidden === true
      const stopTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null } }
      const abortInflight = () => {
        if (!inflight) return
        const controller = inflight
        inflight = null
        controller.abort()
      }
      const publish = () => {
        for (const listener of Array.from(listeners)) {
          try {
            listener(current, lastError)
          } catch {
            /* a broken subscriber must never stop the shared loop */
          }
        }
      }
      const schedule = (delay) => {
        stopTimer()
        if (listeners.size === 0 || isHidden()) return
        timer = setTimeout(() => { timer = null; run(false) }, Math.max(0, delay))
      }

      async function run(force) {
        if (listeners.size === 0 || isHidden()) return
        stopTimer()
        if (inflight) {
          if (!force) return
          abortInflight()
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        inflight = controller
        let next = current
        let changed = false
        let error = null
        try {
          const result = await spec.load(current, { signal: controller ? controller.signal : undefined, force: Boolean(force) })
          if (result !== null && result !== undefined) {
            next = result
            changed = true
          }
        } catch (caught) {
          if (!(caught && caught.name === 'AbortError')) error = caught
        } finally {
          if (inflight === controller) inflight = null
        }
        // A forced refresh or hiding aborted this run: the newer owner schedules the next poll.
        if (listeners.size === 0 || inflight || isHidden()) return
        if (changed) current = next
        lastError = error
        // Publish even on 304: that is how a stale "host unreachable" banner gets cleared.
        publish()
        schedule(error ? (spec.errorDelay ?? STATUS_IDLE_MS) : spec.delay(current))
      }

      const onVisibility = () => {
        if (isHidden()) {
          stopTimer()
          abortInflight()
          return
        }
        run(false)
      }

      function subscribe(listener) {
        listeners.add(listener)
        if (current !== null) listener(current, lastError)
        if (listeners.size === 1) {
          if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
          visibilityBound = true
          run(false)
        } else if (!inflight && timer === null && !isHidden()) {
          // A subscriber arrived while the loop was idle (e.g. the previous first one unmounted
          // between polls): restart it rather than waiting forever.
          run(false)
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size > 0) return
          stopTimer()
          abortInflight()
          if (visibilityBound && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibility)
            visibilityBound = false
          }
        }
      }

      return {
        subscribe,
        refresh: () => { run(true) },
        push: (body) => {
          if (!body || typeof body !== 'object') return
          current = body
          lastError = null
          publish()
        },
        peek: () => current
      }
    }

    /** Conditional GET of the full snapshot: the panel's feed. */
    function createStatusFeed() {
      let tag = null
      const feed = createFeed({
        load: async (_previous, { signal, force }) => {
          const headers = force || !tag ? undefined : { 'if-none-match': tag }
          const response = await fetch(STATUS_PATH, { credentials: 'include', cache: 'no-store', headers, signal })
          if (response.status === 304) return null
          if (!response.ok) throw new Error(response.status === 403 ? '请在电脑本机管理远程访问' : 'HTTP ' + response.status)
          tag = response.headers.get('etag') || tag
          return response.json()
        },
        delay: (body) => (statusIsBusy(body) ? STATUS_BUSY_MS : STATUS_IDLE_MS),
        errorDelay: STATUS_IDLE_MS
      })
      return {
        subscribe: feed.subscribe,
        refresh: feed.refresh,
        // A POST answer carries no ETag, so the next poll must revalidate fully. It is also a
        // bare service snapshot: merge the per-request fields the status route adds
        // (view/deviceId/deviceUiMode) from what the panel already rendered, or a remote phone
        // would briefly treat the host view as its own until the next poll corrects it.
        push: (body) => {
          tag = null
          if (!body || typeof body !== 'object') return feed.push(body)
          const previous = feed.peek()
          const merged = { ...body }
          if (merged.view === undefined) merged.view = previous?.view
          if (merged.deviceId === undefined) merged.deviceId = previous?.deviceId
          if (merged.deviceUiMode === undefined) merged.deviceUiMode = previous?.deviceUiMode
          feed.push(merged)
        }
      }
    }

    /** Long poll of the lightweight pending queue: the approval overlay's feed. */
    function createPendingFeed() {
      let tag = null
      let plain = false
      let slow = false
      const feed = createFeed({
        load: async (_previous, { signal, force }) => {
          const startedAt = Date.now()
          const headers = {}
          if (!force && tag) headers['if-none-match'] = tag
          const url = PENDING_PATH + (plain ? '' : '?wait=' + PENDING_WAIT_MS)
          let response
          try {
            response = await fetch(url, { credentials: 'include', cache: 'no-store', headers, signal })
          } catch (error) {
            // A network failure (not an abort) means the long poll cannot be held here; the
            // fallback keeps the overlay alive at 5 s instead of retrying in a tight loop.
            if (!plain) plain = true
            throw error
          }
          if (response.status === 304) {
            // The route exists (a missing host half answers 404, not 304): return to the real
            // long poll after any earlier fallback cycle.
            plain = false
            slow = Date.now() - startedAt < PENDING_WAIT_MS / 2
            return null
          }
          if (!response.ok) {
            // 404/403 = an older host half without the route; plain GETs will keep failing, but
            // the overlay must not hammer the panel route or throw.
            if (!plain) plain = true
            throw new Error('HTTP ' + response.status)
          }
          const body = await response.json()
          tag = response.headers.get('etag') || tag
          slow = false
          plain = false
          return body
        },
        // A long poll that actually waited re-arms immediately; anything else is the 5 s fallback.
        delay: () => (plain || slow ? PENDING_FALLBACK_MS : 0),
        errorDelay: PENDING_FALLBACK_MS
      })
      return feed
    }

    // Module-level singletons: RemotePage and ApprovalOverlay each subscribe to their own feed,
    // so a second mounted RemotePage adds a subscriber instead of a second status request.
    const statusFeed = createStatusFeed()
    const pendingFeed = createPendingFeed()

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
    function Card({ title, desc, aside, hidden, children }) {
      return h(
        'section',
        { className: CLS.card + (hidden ? ' ' + CLS.cardHidden : ''), hidden: Boolean(hidden) },
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

    /** Installation stays browser-owned; the gateway bootstrap captures its install event. */
    function PwaInstallCard({ hidden }) {
      const [state, setState] = useState(() => window.__dshPwa?.getState() || null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      useEffect(() => {
        const update = () => setState(window.__dshPwa?.getState() || null)
        update()
        window.addEventListener('dsh-pwa-change', update)
        return () => window.removeEventListener('dsh-pwa-change', update)
      }, [])

      const install = async () => {
        setBusy(true)
        setError('')
        try {
          await window.__dshPwa?.install()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy(false)
        }
      }
      const hint = state?.installed
        ? '已安装到主屏幕。可从图标启动独立窗口。'
        : !window.isSecureContext
          ? '请通过 HTTPS 地址访问，并使用受信任的证书，再添加到主屏幕。'
          : state?.ios
            ? '在 Safari 中点「分享」→「添加到主屏幕」→「添加」。其他 iPhone 浏览器可先选择「在 Safari 中打开」。'
            : state?.canPrompt
              ? '点「安装到主屏幕」，在浏览器提示中确认安装。'
              : '打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。若菜单未出现该项，请使用最新版 Chrome、Edge 或 Safari。'
      return h(
        Card,
        { title: '添加到主屏幕', desc: '将远程页面安装为独立应用，下次点图标即可打开', hidden },
        h('p', { className: CLS.cardNote, role: 'status' }, hint),
        state?.canPrompt && !state.installed
          ? h('button', { type: 'button', className: CLS.button, disabled: busy, onClick: install }, busy ? '等待浏览器确认…' : '安装到主屏幕')
          : null,
        error || state?.error ? h('p', { className: CLS.error }, error || state.error) : null,
        h('p', { className: CLS.fieldTip }, '使用时需要联网且电脑上的 DSH 保持运行。安装沿用当前地址与设备准入；更换域名或端口后，请从新地址重新添加。')
      )
    }

    /** Fullscreen is a local view action, requested synchronously from the user's click. */
    function PwaImmersiveCard({ hidden }) {
      const [state, setState] = useState(() => window.__dshPwa?.getState() || null)
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        const update = () => setState(window.__dshPwa?.getState() || null)
        update()
        window.addEventListener('dsh-pwa-change', update)
        return () => window.removeEventListener('dsh-pwa-change', update)
      }, [])
      const toggle = async () => {
        setBusy(true)
        try {
          if (state?.fullscreen) await window.__dshPwa?.exitFullscreen()
          else await window.__dshPwa?.enterFullscreen()
        } finally {
          setBusy(false)
        }
      }
      const hint = state?.fullscreen
        ? '当前为页面全屏。点击「退出全屏」，或使用系统返回 / Esc / 浏览器退出手势。'
        : state?.ios
          ? 'iPhone / iPad 从主屏幕打开后使用边到边布局和半透明状态栏，时间、电量等由系统保留。支持页面全屏的 iPad 浏览器可点击下方按钮。'
          : state?.displayMode === 'fullscreen'
            ? '当前 PWA 以 fullscreen 启动。系统手势可能临时显示状态栏；要结束应用，请使用系统返回或主页。'
            : state?.installed
              ? '当前安装仍以 standalone 独立窗口启动，系统状态栏会保留。等待浏览器更新安装信息并重新从图标启动后，再确认 fullscreen；下方按钮只进入本次页面全屏。'
              : '当前是浏览器页面。从主屏幕安装后请求 fullscreen；下方按钮只进入本次页面全屏，键盘、切换应用或系统手势可能退出。'
      return h(
        Card,
        { title: '沉浸式显示', desc: '减少浏览器与系统栏占用，保留刘海和底部手势安全区', hidden },
        h('p', { className: CLS.cardNote, role: 'status' }, hint),
        state?.fullscreen || (state?.fullscreenSupported && state.displayMode !== 'fullscreen')
          ? h('button', { type: 'button', className: CLS.button, disabled: busy, onClick: toggle }, busy ? '等待浏览器…' : state?.fullscreen ? '退出全屏' : '进入全屏')
          : null,
        state && !state.fullscreenSupported && !state.ios && state.displayMode !== 'fullscreen'
          ? h('p', { className: CLS.fieldTip }, '此浏览器未开放页面全屏，请安装 PWA 后从主屏幕启动。') : null,
        state?.fullscreenError ? h('p', { className: CLS.error, role: 'alert' }, state.fullscreenError) : null,
        h('p', { className: CLS.fieldTip }, '全屏权限仅作用于当前页面。已有主屏幕图标可能仍采用旧的独立窗口模式，待浏览器更新安装信息后重开；必要时从同一地址重新添加。')
      )
    }

    /**
     * 文件传输: this plugin's own pool (lib/files.js), reachable from the phone.
     * The picker is a <label> wrapping the real <input type=file>: a JS .click() on a
     * display:none input is refused by some WebViews (this was the phone upload bug).
     */
    function FilesPanel({ hidden, hostView }) {
      const [files, setFiles] = useState(null)
      const [limitMb, setLimitMb] = useState(null)
      const [poolDir, setPoolDir] = useState('')
      const [draft, setDraft] = useState(null)
      const [custom, setCustom] = useState(false)
      const [savingPool, setSavingPool] = useState(false)
      const [picking, setPicking] = useState(false)
      const [error, setError] = useState(null)
      const [queue, setQueue] = useState([])
      const [deleting, setDeleting] = useState(null)
      const [dragOver, setDragOver] = useState(false)
      const busyRef = useRef(false)

      const load = async () => {
        try {
          const response = await fetch(FILES_PATH, { credentials: 'include', cache: 'no-store' })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const body = await response.json()
          setFiles(Array.isArray(body?.files) ? body.files : [])
          setLimitMb(typeof body?.limit === 'number' ? Math.round(body.limit / 1048576) : null)
          const dir = typeof body?.dir === 'string' ? body.dir : ''
          setPoolDir(dir)
          setCustom(body?.custom === true)
          // Keep whatever the user is typing; only seed the box while it is untouched.
          setDraft((current) => (current === null ? dir : current))
          setError(null)
        } catch (cause) {
          setFiles([])
          setError('读不到文件列表（' + (cause instanceof Error ? cause.message : String(cause)) + '）。插件刚更新过的话，重启一次 DSH 再试。')
        }
      }

      // Load on first visit, and again whenever the user comes back to this tab.
      useEffect(() => {
        if (hidden) return
        load().catch(() => {})
      }, [hidden])


      // The Host opens the OS folder dialog; the browser never learns an absolute path by itself.
      const pickPoolDir = async () => {
        setPicking(true)
        try {
          const result = await postJson(FILE_POOL_PICK_PATH, {})
          if (result && result.cancelled === true) return
          if (!result || result.ok !== true) throw new Error((result && result.error) || '没能选择目录')
          setDraft(typeof result.dir === 'string' ? result.dir : '')
          setError(null)
          await load()
        } catch (cause) {
          setError('选择目录失败：' + (cause instanceof Error ? cause.message : String(cause)))
        } finally {
          setPicking(false)
        }
      }

      const savePoolDir = async () => {
        setSavingPool(true)
        try {
          const result = await postJson(FILE_POOL_PATH, { dir: String(draft ?? '').trim() })
          if (!result || result.ok !== true) throw new Error((result && result.error) || '保存失败')
          const next = typeof result.snapshot?.filePoolDir === 'string' ? result.snapshot.filePoolDir : ''
          setDraft(next)
          setError(null)
          await load()
        } catch (cause) {
          setError('保存位置失败：' + (cause instanceof Error ? cause.message : String(cause)))
        } finally {
          setSavingPool(false)
        }
      }

      const uploadOne = (file, onProgress) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', FILE_UPLOAD_PATH + '?name=' + encodeURIComponent(file.name))
        xhr.setRequestHeader('content-type', 'application/octet-stream')
        xhr.withCredentials = true
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(Math.min(0.99, event.loaded / Math.max(1, event.total)))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(1)
            resolve()
            return
          }
          let message = 'HTTP ' + xhr.status
          try {
            const parsed = JSON.parse(xhr.responseText)
            if (parsed && typeof parsed.error === 'string') message = parsed.error
          } catch {
            /* keep the status code */
          }
          reject(new Error(message))
        }
        xhr.onerror = () => reject(new Error('网络中断，上传失败'))
        xhr.onabort = () => reject(new Error('上传已取消'))
        xhr.send(file)
      })

      const uploadFiles = async (fileList) => {
        const picked = Array.from(fileList || []).filter((file) => file && file.size >= 0)
        if (picked.length === 0) return
        busyRef.current = true
        setError(null)
        for (const file of picked) {
          const key = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
          setQueue((current) => current.concat([{ key, name: file.name, percent: 0 }]))
          try {
            await uploadOne(file, (percent) => {
              setQueue((current) => current.map((row) => (row.key === key ? { ...row, percent } : row)))
            })
          } catch (cause) {
            setError(file.name + '：' + (cause instanceof Error ? cause.message : String(cause)))
          } finally {
            setQueue((current) => current.filter((row) => row.key !== key))
          }
        }
        busyRef.current = false
        await load().catch(() => {})
      }

      const removeFile = async (file) => {
        if (!window.confirm('从文件池删除「' + file.name + '」？')) return
        setDeleting(file.id)
        try {
          await postJson(FILE_DELETE_PATH, { id: file.id })
          await load()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setDeleting(null)
        }
      }

      const uploading = queue.length > 0
      const totalBytes = (files || []).reduce((sum, file) => sum + (Number(file.size) || 0), 0)

      return h(
        Card,
        {
          title: '文件传输',
          desc: uploading
            ? '正在上传…'
            : '手机和电脑共用一个文件夹，选中即上传' + (limitMb ? '（单个上限 ' + limitMb + ' MB）' : ''),
          hidden,
          aside: uploading
            ? null
            : h('button', { type: 'button', className: CLS.button, onClick: () => { load().catch(() => {}) } }, '刷新')
        },
        error ? h('div', { className: CLS.error }, error) : null,
        h(
          'div',
          { className: CLS.field, hidden: !hostView },
          h('span', { className: CLS.fieldTip }, '保存位置'),
          h(
            'div',
            { className: CLS.poolRow },
            h('input', {
              className: CLS.input,
              value: draft === null ? '' : draft,
              spellCheck: false,
              placeholder: custom ? '' : poolDir,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  savePoolDir().catch(() => {})
                }
              }
            }),
            h(
              'button',
              { type: 'button', className: CLS.buttonQuiet, disabled: picking, onClick: () => { pickPoolDir().catch(() => {}) } },
              picking ? '等待选择…' : '选择…'
            ),
            h(
              'button',
              { type: 'button', className: CLS.button, disabled: savingPool || picking, onClick: () => { savePoolDir().catch(() => {}) } },
              savingPool ? '保存中…' : '保存'
            )
          ),
          h('p', { className: CLS.fieldTip }, custom ? '自定义目录。换位置不会搬运旧文件。' : '点「选择…」在文件管理器里挑一个文件夹，或直接填路径；手机上看到的就是这个文件夹。')
        ),
        h(
          'label',
          {
            className: CLS.uploadBox + (dragOver ? ' ' + CLS.uploadHot : ''),
            onDragOver: (event) => {
              event.preventDefault()
              setDragOver(true)
            },
            onDragLeave: () => setDragOver(false),
            onDrop: (event) => {
              event.preventDefault()
              setDragOver(false)
              uploadFiles(event.dataTransfer?.files).catch(() => {})
            }
          },
          h('strong', { className: CLS.uploadTitle }, uploading ? '正在上传…' : '点击选择文件，或拖到这里'),
          h('span', { className: CLS.uploadHint }, '手机相册、文档、压缩包都行；同名文件自动加序号，不会覆盖'),
          h('input', {
            className: CLS.uploadInput,
            type: 'file',
            multiple: true,
            disabled: uploading,
            onChange: (event) => {
              // Copy the FileList BEFORE clearing value: clearing turns the live FileList empty
              // in Chromium, which silently swallowed every pick ("upload does nothing").
              const picked = Array.from(event.target.files || [])
              event.target.value = ''
              uploadFiles(picked).catch(() => {})
            }
          })
        ),
        queue.map((row) =>
          h(
            'div',
            { key: row.key, className: CLS.queueRow },
            h('span', { className: CLS.fileName, title: row.name }, row.name),
            h('span', { className: CLS.fileSub }, Math.round(row.percent * 100) + '%'),
            h('div', { className: CLS.progress }, h('div', { className: CLS.progressBar, style: { width: Math.round(row.percent * 100) + '%' } }))
          )
        ),
        files === null
          ? h('p', { className: CLS.fieldTip }, '加载中…')
          : files.length === 0
            ? h('p', { className: CLS.fileEmpty }, '文件池是空的。上面选个文件试试。')
            : h(
                'ul',
                { className: CLS.fileList },
                files.map((file) =>
                  h(
                    'li',
                    { className: CLS.fileRow, key: file.id },
                    h('span', { className: CLS.fileExt }, fileExt(file.name)),
                    h(
                      'div',
                      { className: CLS.fileMeta },
                      h('span', { className: CLS.fileName, title: file.name }, file.name),
                      h('span', { className: CLS.fileSub }, formatBytes(file.size) + ' · ' + formatFileDate(file.mtime))
                    ),
                    h(
                      'a',
                      { className: CLS.button, href: FILE_DOWNLOAD_PATH + '?id=' + encodeURIComponent(file.id), download: file.name },
                      '下载'
                    ),
                    h(
                      'button',
                      { type: 'button', className: CLS.buttonQuiet, disabled: deleting === file.id, onClick: () => { removeFile(file).catch(() => {}) } },
                      deleting === file.id ? '…' : '删除'
                    )
                  )
                )
              ),
        h('p', { className: CLS.cardNote }, '共 ' + (files?.length || 0) + ' 个' + (totalBytes > 0 ? ' · ' + formatBytes(totalBytes) : '') + '。下载会存到手机的下载目录。')
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
      const [password, setPassword] = useState('')
      const [qrRevealUntil, setQrRevealUntil] = useState(0)
      const [actionError, setActionError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [externalDraft, setExternalDraft] = useState(null)
      const [maxOnlineDraft, setMaxOnlineDraft] = useState(null)
      // Two-step delete for the downloaded cloudflared: the button is small and a stray click
      // would cost another 50 MB download, so it asks once.
      const [cfConfirmDelete, setCfConfirmDelete] = useState(false)
      const [confirmingRequest, setConfirmingRequest] = useState(null)
      const [switchNote, setSwitchNote] = useState(null)
      const [check, setCheck] = useState(null)
      const [checkBusy, setCheckBusy] = useState(false)
      // Two pages, like the memory panel: connection plumbing on one, presentation on the other.
      const [tab, setTab] = useState('connect')
      // 'host' = the owner's own DSH window; 'client' = a page served through the gateway.
      // Host-only controls (switch, password, entry mode, device approvals, pool folder) are
      // hidden from the phone; the gateway also refuses those POSTs with 403.
      // Newest published version from npm; null until the first answer arrives.
      const [updateInfo, setUpdateInfo] = useState(null)
      // The gateway marks every page it forwards with x-dsh-panel-view: client, so the owner's
      // own window is the only place that sees host-only controls.
      // A gateway built before the client-facing routes existed answers 403 local-only; that is
      // still a remote page, so render the client view instead of a broken host panel.
      const localOnly = Boolean(fetchError && /本机管理远程访问|local-only/i.test(fetchError))
      const hostView = !localOnly && status?.view !== 'client'

      // The panel only subscribes while it is mounted: the status request lives in the shared
      // feed (conditional If-None-Match; idle 3 s / transition 1 s; paused while hidden).
      useEffect(() => statusFeed.subscribe((body, error) => {
        if (body) setStatus(body)
        setFetchError(error ? (error instanceof Error ? error.message : String(error)) : null)
      }), [])


      // Ask npm once per page load whether a newer release exists. The server caches the answer
      // for six hours, so this is one cheap request even when the panel stays open for days.
      useEffect(() => {
        let alive = true
        const run = async () => {
          try {
            const next = await postJson(UPDATE_PATH, {})
            if (alive && next && !next.error && typeof next.current === 'string') setUpdateInfo(next)
          } catch {
            /* offline: the tab bar still shows the installed version */
          }
        }
        run()
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (!reveal) return undefined
        const timer = setTimeout(() => { setReveal(false); setPassword('') }, 30000)
        return () => clearTimeout(timer)
      }, [reveal])

      const enabled = Boolean(status?.enabled)
      const phase = status?.phase || 'disabled'
      const phaseBusy = phase === 'starting' || phase === 'stopping' || busy || Boolean(status?.busy)
      const publicUrl = status?.publicUrl || ''
      const qr = status?.qr || null
      const devices = Number(status?.devices ?? status?.clients ?? 0)
      const pages = Number(status?.pages ?? status?.clients ?? 0)
      const tunnelLabel = status?.tunnel === 'none'
        ? '本机（未起隧道）'
        : status?.tunnel === 'external'
          ? '外部隧道（SakuraFrp / frp）'
          : status?.tunnel === 'quick'
            ? 'Cloudflare 快速隧道'
            : status?.tunnel === 'lan'
              ? '局域网（虚拟组网）'
              : 'Tailscale Serve'
      const cloudflare = status?.cloudflare || null
      const lanPort = (() => {
        const match = /:(\d+)\//.exec(status?.lanUrl || status?.publicUrl || '')
        return match ? match[1] : ''
      })()
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
          if (next && next.phase) statusFeed.push(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
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
            statusFeed.push(next)
            setSwitchNote('已切到「' + (entryOptions.find((option) => option[0] === mode) || [mode, mode])[1] + '」并自动关掉了开关：检查下面的入口设置，再打开开关。')
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      const saveExternal = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(EXTERNAL_PATH, { url: externalDraft ?? status?.externalUrl ?? '' })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) {
            statusFeed.push(next)
            setExternalDraft(null)
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      const resetStats = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(RESET_PATH, {})
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) statusFeed.push(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      const detectExternal = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(EXTERNAL_PATH, {})
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) {
            statusFeed.push(next)
            setExternalDraft(null)
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      // Quick-tunnel side actions: fetch the binary (~50 MB) and force a reconnect.
      const cloudflareAction = async (action) => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(CLOUDFLARED_PATH, { action })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) statusFeed.push(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      // Pin the lan entry to one adapter address. The gateway listens on 0.0.0.0 in this mode, so
      // the only thing that changes is the advertised URL and its QR — instant, no reconnect.
      const chooseLanAddress = async (address) => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(LAN_PATH, { address })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) statusFeed.push(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      // Pick the viewport phones get. The gateway injects it into the HTML, so it lands on the
      // next page load — the card offers a reload button right next to the choice.
      // `deviceId` is only passed from the host panel: a remote phone always changes its own
      // record (the gateway tells the route which device the cookie belongs to).
      const chooseUiMode = async (mode, deviceId) => {
        setActionError(null)
        setBusy(true)
        try {
          const next = await postJson(UI_PATH, deviceId ? { mode, deviceId } : { mode })
          if (next?.error) setActionError(next.error)
          else if (next && next.phase) statusFeed.push(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
        }
      }

      // The one-click self-check behind the panel button: the same walk-through I do by hand when
      // someone reports “can't connect”, so the panel can name the broken hop instead of guessing.
      const runSelfCheck = async () => {
        setActionError(null)
        setCheckBusy(true)
        try {
          const body = await postJson(SELFCHECK_PATH, {})
          if (body?.error) setActionError(body.error)
          else if (Array.isArray(body?.steps)) setCheck(body)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setCheckBusy(false)
        }
      }

      const togglePasswordReveal = async () => {
        if (reveal) {
          setReveal(false)
          setPassword('')
          return
        }
        setActionError(null)
        try {
          const result = await postJson(PASSWORD_PATH, { action: 'reveal' })
          if (!result?.password) throw new Error(result?.error || '密码读取失败')
          setPassword(result.password)
          setReveal(true)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        }
      }

      const regenerate = async () => {
        setActionError(null)
        setBusy(true)
        try {
          const result = await postJson(PASSWORD_PATH, {})
          if (result?.error) throw new Error(result.error)
          setPassword('')
          setReveal(false)
          if (result && result.snapshot) statusFeed.push(result.snapshot)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
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
          else if (next && next.phase) statusFeed.push(next)
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
          statusFeed.refresh()
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
            const entryOptions = [['lan', '局域网 / 虚拟组网'], ['external', 'SakuraFrp / 外部'], ['quick', 'Cloudflare'], ['none', '仅本机'], ['tailscale', 'Tailscale']]
            const uiModeOptions = [['auto', '自动'], ['phone', '手机'], ['tablet', '平板'], ['compat', '兼容']]
            const uiModeTips = {
              auto: '按设备选择真实宽度。DSH 0.2.2-rc.1 起使用官方手机 / 平板适配，旧版使用插件皮肤；认错设备时可手动选择。',
              phone: '使用手机真实宽度。新版 DSH 保留官方导航、设置和软键盘交互，旧版启用插件手机皮肤。',
              tablet: '使用平板 / 折叠屏真实宽度，不缩放。新版 DSH 由官方布局自适应，旧版使用插件展开布局。',
              compat: '把 1280 宽桌面页整体缩小塞进屏幕：最保真，但字最小，只作兜底。',
              default: '跟随电脑上设的默认模式；选其它值只改变这一台设备。'
            }
            // Per-device rows also offer "follow the default" so an override can be undone.
            const deviceUiOptions = [['default', '跟随默认']].concat(uiModeOptions)
            const uiDevices = hostView ? (status?.deviceList || []).filter((entry) => entry.state === 'trusted') : []
            const uiDeviceRows = hostView
              ? uiDevices.length === 0
                ? h('p', { className: CLS.cardNote }, '还没有已批准的设备。手机通过验证后会出现在这里，可以单独给它选一档。')
                : h(
                    'div',
                    null,
                    uiDevices.map((entry) =>
                      h(
                        'div',
                        { key: entry.deviceId, className: CLS.device },
                        h('span', { className: CLS.deviceName }, (entry.label || '未知设备') + (entry.online ? ' · 在线' : '')),
                        h(Seg, {
                          options: deviceUiOptions,
                          value: entry.uiMode || 'default',
                          onPick: (mode) => chooseUiMode(mode, entry.deviceId),
                          disabled: busy
                        })
                      )
                    )
                  )
              : null
            // Auto only means something if the panel says what it picked last time.
            const uiProbe = status?.uiModeProbe
            const uiProbeLabel = { phone: '手机版', tablet: '平板版', compat: '兼容版' }[uiProbe?.mode] || '兼容版'
            const uiProbeMinutes = uiProbe ? Math.max(0, Math.round((Date.now() - Number(uiProbe.at)) / 60000)) : 0
            const uiProbeAgo = !uiProbe ? '' : uiProbeMinutes < 1 ? '刚刚' : uiProbeMinutes < 60 ? uiProbeMinutes + ' 分钟前' : Math.round(uiProbeMinutes / 60) + ' 小时前'
            const uiProbeText = !uiProbe
              ? '还没有手机或平板连进来，暂时看不出会自动选哪一档。'
              : '最近一次自动识别 → ' + uiProbeLabel + '（' + uiProbeAgo + '，来自 ' + (uiProbe.label || '未知设备') + '）'
      const entryTip = status?.tunnel === 'external'
        ? '填好下面的外网地址，面板的网址和二维码都会用它。'
        : status?.tunnel === 'quick'
          ? '免账号：插件自己下载 cloudflared 建隧道，地址每次重启都会变。下不动就点「停止下载」再重试，或把 cloudflared.exe 放到 ~/.dsh/remote-access/bin/。'
          : status?.tunnel === 'none'
            ? '不起隧道，只监听本机端口；手机连不上，适合在本机调试。'
            : status?.tunnel === 'lan'
              ? '手机和电脑连同一个 Wi-Fi，或先连上皎月连 / ZeroTier 这类虚拟组网；网关会监听所有网卡，二维码用下面列表里的第一个地址。'
              : '需要本机已登录 Tailscale，并已把这个网关端口 serve 出去。不推荐：走 DERP 中继时延迟高，能用外部隧道或 Cloudflare 就别用它。'
      const connectTip = enabled
        ? (status?.tunnel === 'external'
            ? '外部隧道须使用 HTTPS 和受信任证书；发现证书错误时先检查入口配置。'
            : status?.tunnel === 'quick'
              ? 'Cloudflare 免费隧道的地址每次重启都会变，换了地址要重新扫码。'
              : status?.tunnel === 'none'
                ? '当前只有本机能访问，手机连不上。'
                : status?.tunnel === 'lan'
                  ? '手机要和电脑在同一网段；用虚拟组网就先确认两端连着同一个网络。主地址进不去就换列表里另一个地址。'
                  : '手机需安装 Tailscale 并登录同一账号；走中继时延迟会明显偏高。')
        : '打开开关后生成二维码：一次性票据（10 分钟），请保管好截图，并在电脑核对配对码。'

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
          hostView
            ? h(
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
            : h('div', { className: CLS.cardNote }, '请在 host 端查看')
        ),

        errorText ? h('div', { className: CLS.error }, errorText) : null,

        hostView
          ? null
          : h(
              'div',
              { className: CLS.note },
              '你现在是从远程页面看的：开关、网络入口、设备准入、文件池位置这些都要在电脑本机的面板上改。传文件、看地址不受影响。'
            ),

        h(
          'div',
          { className: CLS.tabBar, role: 'tablist', 'aria-label': '面板分区' },
          [['connect', '连接与设备'], ['files', '文件传输'], ['ui', '界面']]
            .map((option) =>
            h(
              'button',
              {
                key: option[0],
                type: 'button',
                role: 'tab',
                'aria-selected': tab === option[0],
                className: CLS.tabBtn + (tab === option[0] ? ' ' + CLS.tabBtnOn : ''),
                onClick: () => setTab(option[0])
              },
              option[1]
            )
          ).concat([
            h(
              'span',
              { className: CLS.tabMeta, key: 'meta' },
              h('span', { className: CLS.tabVersion, title: '插件版本' }, 'v' + (status?.pluginVersion || '—')),
              updateInfo && updateInfo.hasUpdate
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: CLS.tabUpdate,
                      title: '点击复制升级命令',
                      onClick: async () => {
                        const command = 'npm i -g dsh-mobile-harness@' + updateInfo.latest
                        const ok = await copyText(command)
                        setSwitchNote(ok ? '升级命令已复制：' + command + '，装完重启 DSH 生效' : '复制失败，请手动执行：' + command)
                      }
                    },
                    '可更新 ' + updateInfo.latest
                  )
                : null
            )
          ])
        ),

        !hostView && tab === 'connect'
          ? h(
              Card,
              { title: '连接与设备', desc: '远程开关、网络入口、一键自检、设备准入' },
              h('p', { className: CLS.cardNote }, '请在 host 端查看：这些设置只在本机生效，在电脑上的 DSH 面板里改。手机这边可以传文件、也能看到地址。')
            )
          : null,

        h(
          Card,
          { title: '连接', desc: '扫码直接进；也可以手动打开网址输密码', hidden: !hostView || tab !== 'connect' },
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
                { label: '密码', tip: '仅在本机按需显示，30 秒后隐藏。重置会撤销全部会话、设备信任与手机令牌。' },
                h('span', { className: CLS.value + ' ' + CLS.mono }, reveal ? password : '••••••••'),
                h(
                  'button',
                  { type: 'button', className: CLS.button + ' ' + CLS.buttonQuiet, onClick: togglePasswordReveal },
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
                  tip: '网关始终要求密码或一次性扫码票据，并执行设备准入与撤销检查。'
                },
                h(
                  'span',
                  { className: CLS.value },
                  '密码验证已开启'
                )
              ),
              h('p', { className: CLS.cardNote }, connectTip)
            )
          )
        ),

        h(
          Card,
          { title: '网络入口', desc: '手机怎么找到这台电脑', hidden: !hostView || tab !== 'connect' },
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
                  h(CopyButton, { text: status?.externalUrl || '' }),
                  h('p', { className: CLS.portRow },
                    '隧道转发目标端口',
                    h('span', { className: CLS.portChip, title: '点一下复制', onClick: () => copyText(String(status?.proxyPort || '')) }, String(status?.proxyPort || '—')),
                  ),
                  // Two different facts, two different sentences: a red banner only when frpc is
                  // genuinely not connected AND its target port disagrees with the gateway. A
                  // healthy tunnel that merely has an old failure line in its log stays quiet.
                  status?.relayPortMismatch
                    ? h('p', { className: CLS.fieldTip }, 'frpc 没连上，而且它转发到 127.0.0.1:' + status.relayLocalPort + (status.relay?.localPortAt ? '（记录于 ' + status.relay.localPortAt + '）' : '') + '。把 SakuraFrp 这条隧道的「本地端口」改成 ' + status.proxyPort + '，保存即恢复。')
                    : status?.relay?.localPort && status.relay.localPort !== status.proxyPort
                      ? h('p', { className: CLS.cardNote }, '历史记录里 frpc 曾转发到 ' + status.relay.localPort + '（' + (status.relay.localPortAt || '旧日志') + '）；外网地址能通就以探测结果为准。')
                      : status?.relay?.refused && status.relay.localPort === status.proxyPort
                        ? h('p', { className: CLS.cardNote }, 'frpc 已经连上 frp，但 127.0.0.1:' + status.proxyPort + ' 没人监听（' + (status.relay.refusedAt || '刚刚') + '）：先确认面板顶部的总开关是打开的，以及 DSH 还在运行。')
                        : null
                )
              : null,
            status?.tunnel === 'lan'
              ? h(
                  Field,
                  {
                    label: '本机地址',
                    tip: '手机用哪个地址进来。同一个 Wi-Fi 或虚拟组网里每个地址都能通，二维码只编码开关打开的那一个——拨一下开关，二维码立刻改装该地址，不用重连。'
                  },
                  h(
                    'div',
                    { className: CLS.lanBox },
                    (status?.lanAddresses || []).length === 0
                      ? h('span', { className: CLS.value }, '没找到非回环 IPv4 地址')
                      : (status?.lanAddresses || []).map((entry) =>
                          h(
                            'div',
                            {
                              key: entry.address,
                              className: CLS.lanCard + (entry.selected ? ' ' + CLS.lanCardOn : '')
                            },
                            h(
                              'div',
                              { className: CLS.lanMain },
                              h('span', { className: CLS.lanAddr + ' ' + CLS.mono }, entry.address),
                              h('span', { className: CLS.lanNic }, entry.name)
                            ),
                            h(CopyButton, { text: lanPort ? 'http://' + entry.address + ':' + lanPort + '/' : 'http://' + entry.address + '/' }),
                            h(
                              'button',
                              {
                                type: 'button',
                                role: 'switch',
                                'aria-checked': Boolean(entry.selected),
                                className: CLS.lanSwitch + (entry.selected ? ' ' + CLS.lanSwitchOn : ''),
                                disabled: phaseBusy,
                                onClick: () => chooseLanAddress(entry.selected ? '' : entry.address),
                                title: entry.selected ? '正在使用这个地址，点一下取消指定（回到自动）' : '让二维码改用这个地址'
                              },
                              h('span', { className: CLS.lanThumb })
                            )
                          )
                        ),
                    status?.lanAddress && (status?.lanAddresses || []).every((entry) => !entry.selected)
                      ? h('p', { className: CLS.fieldTip }, '记住的地址 ' + status.lanAddress + ' 现在不在线（网卡拔了或虚拟组网没连），已临时改用第一个。')
                      : null,
                    (status?.lanAddresses || []).length > 1
                      ? h('p', { className: CLS.cardNote }, '只开一个开关：二维码就用那条地址。全部关掉＝按优先级自动挑，网卡掉了也会自动回退。')
                      : null
                  )
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
                  // A download in flight only has one useful action: stop it. Every mirror can hang,
                  // and waiting 30 s per address for eight addresses is a bad way to spend an evening.
                  cfDown
                    ? h(
                        'button',
                        { type: 'button', className: CLS.button, disabled: busy, onClick: () => cloudflareAction('cancel') },
                        '停止下载'
                      )
                    : cloudflare?.binary === 'missing'
                      ? h(
                          'button',
                          { type: 'button', className: CLS.button, disabled: busy || phaseBusy, onClick: () => cloudflareAction('install') },
                          cloudflare?.downloadError ? '重新下载（约 50 MB）' : '下载 cloudflared（约 50 MB）'
                        )
                      : h(
                          'button',
                          { type: 'button', className: CLS.button, disabled: busy || phaseBusy, onClick: () => cloudflareAction('restart') },
                          '重新连接'
                        ),
                  // Deleting is the way out of a corrupt / half-written binary; the copy on PATH is
                  // not ours to delete, so the button only appears for the plugin's own file.
                  !cfDown && cloudflare?.binary === 'ready' && cloudflare?.binarySource === 'plugin'
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: CLS.button,
                          disabled: busy || phaseBusy,
                          onClick: () => {
                            if (!cfConfirmDelete) {
                              setCfConfirmDelete(true)
                              return
                            }
                            setCfConfirmDelete(false)
                            cloudflareAction('delete')
                          }
                        },
                        cfConfirmDelete ? '确认删除本地程序' : '删除'
                      )
                    : null,
                  h(CopyButton, { text: cloudflare?.url || '' }),
                  cloudflare?.binarySource === 'system'
                    ? h('p', { className: CLS.barNote }, '用的是系统 PATH 里的 cloudflared，不用再下载。')
                    : null,
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
              : null
          )
        ),

        h(FilesPanel, { key: 'files', hidden: tab !== 'files', hostView }),

        !hostView ? h(PwaInstallCard, { hidden: tab !== 'ui' && tab !== 'connect' }) : null,
        !hostView ? h(PwaImmersiveCard, { hidden: tab !== 'ui' }) : null,

        h(
          Card,
          {
            title: hostView ? '界面模式' : '这台设备的界面',
            hidden: tab !== 'ui',
            desc: hostView
              ? '手机上字太小、按钮点不准时改这里；每台设备还能各用一档'
              : '只影响你手上这台设备，改完点「刷新页面」生效',
            aside: h(
              'button',
              { type: 'button', className: CLS.button, onClick: () => window.location.reload() },
              '刷新页面'
            )
          },
          h(
            'div',
            { className: CLS.fields },
            h(
              Field,
              {
                label: hostView ? '默认模式' : '本机模式',
                tip: uiModeTips[hostView ? (status?.uiMode || 'auto') : (status?.deviceUiMode || 'default')] || uiModeTips.auto
              },
              hostView
                ? h(Seg, { options: uiModeOptions, value: status?.uiMode || 'auto', onPick: (mode) => chooseUiMode(mode), disabled: busy })
                : h(Seg, { options: deviceUiOptions, value: status?.deviceUiMode || 'default', onPick: (mode) => chooseUiMode(mode), disabled: busy }),
              h(
                'p',
                { className: CLS.fieldTip },
                hostView
                  ? '默认档给所有还没单独选过的设备用；下面每台设备可以各自覆盖。'
                  : '「跟随默认」= 用电脑上设的那一档；选其它值只改变这一台。'
              ),
              (hostView ? (status?.uiMode || 'auto') : (status?.deviceUiMode || 'default')) === 'auto'
                ? h('p', { className: CLS.fieldTip }, uiProbeText)
                : null
            )
          ),
          uiDeviceRows
        ),

        h(
          Card,
          {
            title: '一键自检',
            hidden: !hostView || tab !== 'connect',
            desc: '手机连不上时，先点这里定位断点',
            aside: h(
              'button',
              {
                type: 'button',
                className: CLS.button,
                disabled: checkBusy,
                onClick: runSelfCheck
              },
              checkBusy ? '逐段检测中…' : '开始自检'
            )
          },
          !check
            ? h('p', { className: CLS.cardNote }, '按手机请求经过的顺序逐段检查：总开关 → 网关 → DSH 本体 → 隧道 → 外网地址 → 设备准入。标红的那一行就是断点，下面灰字是改法。')
            : h(
                'div',
                null,
                h(
                  'div',
                  { className: CLS.fields },
                  check.steps.map((step) =>
                    h(
                      'div',
                      { key: step.id, style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
                      h(
                        'span',
                        {
                          style: {
                            flex: '0 0 auto',
                            marginTop: '2px',
                            fontSize: '12px',
                            lineHeight: '18px',
                            color: step.status === 'ok' ? '#22c55e' : step.status === 'fail' ? '#ef4444' : '#f59e0b'
                          }
                        },
                        '●'
                      ),
                      h(
                        'div',
                        { style: { minWidth: 0 } },
                        h('div', { className: CLS.value }, step.label + ' · ' + step.detail),
                        step.hint ? h('p', { className: CLS.fieldTip }, step.hint) : null
                      )
                    )
                  )
                ),
                h('p', { className: CLS.cardNote }, check.ok ? '链路是通的：手机扫码应该能进；进不去就看看手机是不是没点「允许」。' : '标红的那一行就是断点，按它下面的提示改。')
              )
        ),

        h(
          Card,
          {
            title: '设备准入',
            hidden: !hostView || tab !== 'connect',
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
              { label: '在线上限', tip: '0 = 不限；按活跃登录会话计数，App、脚本与浏览器使用相同额度。' },
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
     * the remote panel. It long-polls the lightweight pending route (15 s hold, 5 s fallback), never
     * the full status snapshot the panel already polls, and only sends an approval after the
     * operator confirms the two screens agree.
     */
    const OVERLAY_SNOOZE_MS = 120000

    function ApprovalOverlay() {
      const [pendingState, setPendingState] = useState(null)
      const [confirmId, setConfirmId] = useState(null)
      const [sending, setSending] = useState(false)
      const [error, setError] = useState(null)
      const [snooze, setSnooze] = useState({})

      // The shared pending feed owns the long poll: one request even when both the panel and the
      // overlay are mounted, paused while the page is hidden. If the panel is not mounted, this
      // still works on its own.
      useEffect(() => pendingFeed.subscribe((body) => {
        if (body) setPendingState(body)
      }), [])

      const pending = Array.isArray(pendingState?.pending) ? pendingState.pending : []
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
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setSending(false)
          setConfirmId(null)
          // The answer is already in; a forced pending read drops the dialog without waiting for
          // the next long-poll cycle.
          pendingFeed.refresh()
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

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureStyles()
        ctx.effect(() => {
          if (typeof require.async !== 'function') {
            console.warn('dsh-mobile-harness: async chunk loading unavailable')
            return () => {}
          }
          let disposed = false
          let dispose
          // Skin 2.2.3: native hosts own layout; legacy mobile defers posture animation until resize settles.
          Promise.all([
            require.async('./client.mobile-skin.js'),
            require.async('./client.mobile-styles.js')
          ]).then(([skin, styles]) => {
            if (disposed) return
            dispose = skin.installMobileSkin(styles.MOBILE_CSS)
          }).catch((error) => {
            console.warn('dsh-mobile-harness: mobile skin chunk failed to load', error)
          })
          return () => {
            disposed = true
            dispose?.()
          }
        }, 'dsh-mobile-harness: mobile skin')
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
