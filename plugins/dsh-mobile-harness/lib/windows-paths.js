import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

/** Use Windows PowerShell by absolute path, never a same-named executable in the workspace. */
export function windowsPowerShellPath() {
  if (process.platform !== 'win32') return null
  const root = process.env.SystemRoot || process.env.WINDIR
  const systemDir = root && win32.isAbsolute(root) ? root : 'C:\\Windows'
  const candidate = win32.join(systemDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : null
}

export function sakuraFrpLogDir() {
  if (process.platform !== 'win32') return null
  const root = process.env.ProgramData
  const programData = root && win32.isAbsolute(root) ? root : 'C:\\ProgramData'
  return win32.join(programData, 'SakuraFrpService', 'Logs')
}
