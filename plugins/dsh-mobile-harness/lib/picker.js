/**
 * Native folder picker for the panel's file-pool location.
 *
 * A web page can never learn an absolute local path from <input webkitdirectory>, so this is
 * resolved on the Host side: Electron's dialog when the Host runs inside the desktop app,
 * otherwise a one-off PowerShell folder browser on Windows. Other platforms report back
 * "unsupported" and the panel falls back to typing the path.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { windowsPowerShellPath } from './windows-paths.js'

/** @returns {boolean} whether a native picker can be opened on this host */
export function hasNativePicker() {
  return process.platform === 'win32'
}

/** Electron host dialog; null when the module is unavailable (pure Node). */
async function pickWithElectron() {
  try {
    const require = createRequire(import.meta.url)
    const electron = require('electron')
    const dialog = electron?.dialog
    if (!dialog || typeof dialog.showOpenDialog !== 'function') return undefined
    const result = await dialog.showOpenDialog({
      title: '选择文件池目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) return null
    return result.filePaths[0]
  } catch {
    return undefined
  }
}

/** Windows fallback: a STA PowerShell process that shows a real folder browser. */
function pickWithPowerShell(exe, timeoutMs = 300000) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '选择文件池目录'",
    '$d.ShowNewFolderButton = $true',
    'try { if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) } } finally { $d.Dispose() }'
  ].join('; ')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-STA', '-NoProfile', '-EncodedCommand', encoded], { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      reject(new Error('选择超时'))
    }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { err += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out || null)
      else reject(new Error(err.trim() || 'powershell exit ' + code))
    })
  })
}

/** @returns {Promise<string|null>} chosen absolute path, or null when cancelled/unsupported. */
export async function pickFolder() {
  const fromElectron = await pickWithElectron()
  if (fromElectron !== undefined) return fromElectron
  if (process.platform !== 'win32') return null
  const exe = windowsPowerShellPath()
  if (!exe) throw new Error('未找到系统 Windows PowerShell，请直接填写目录')
  return pickWithPowerShell(exe)
}
