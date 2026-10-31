/**
 * Local QR rendering helper.
 *
 * The browser half cannot import arbitrary npm packages (only the platform module seed),
 * so the Host builds the module matrix and ships it in the status snapshot; the client
 * draws it as an SVG. The encoder is vendored (MIT) in `qr-encoder.cjs` so the plugin has
 * no runtime dependencies and works in an air-gapped profile.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** @type {(typeNumber: number, errorCorrectionLevel: string) => any} */
let createQr = null
try {
  createQr = require('./qr-encoder.cjs')
} catch {
  createQr = null
}

/**
 * Encode text into a module matrix.
 * @param {string} text
 * @returns {{ size: number, rows: string[] } | null} null when encoding is unavailable
 */
export function qrMatrix(text) {
  if (!createQr || typeof text !== 'string' || text.length === 0) return null
  try {
    const qr = createQr(0, 'M')
    qr.addData(text)
    qr.make()
    const size = qr.getModuleCount()
    const rows = []
    for (let r = 0; r < size; r += 1) {
      let row = ''
      for (let c = 0; c < size; c += 1) row += qr.isDark(r, c) ? '1' : '0'
      rows.push(row)
    }
    return { size, rows }
  } catch {
    return null
  }
}
