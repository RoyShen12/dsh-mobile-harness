/** Native responsive shell first shipped with DSH 0.2.2-rc.1. */
export function hasNativeMobileLayout(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(String(version ?? ''))
  if (!match) return false
  const target = [0, 2, 2]
  for (let index = 0; index < target.length; index += 1) {
    const part = Number(match[index + 1])
    if (part !== target[index]) return part > target[index]
  }
  const candidate = /^rc\.(\d+)(?:\.|$)/.exec(match[4] ?? '')
  return !match[4] || Boolean(candidate && Number(candidate[1]) >= 1)
}

/** Read only the host's JSON boot assignment; never evaluate HTML or scripts. */
export function readHostRelease(html) {
  const boot = /<script\b[^>]*>\s*(?:globalThis|window)(?:\["__DSH_BOOT__"\]|\['__DSH_BOOT__'\]|\.__DSH_BOOT__)\s*=\s*([\s\S]*?)<\/script\s*>/i.exec(String(html))
  if (!boot) return undefined
  try {
    const version = JSON.parse(boot[1].trim().replace(/;$/, '')).release?.version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined // Other host builds may render a non-JSON assignment; keep legacy behavior.
  }
}
