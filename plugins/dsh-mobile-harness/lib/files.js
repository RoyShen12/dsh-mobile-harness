/**
 * Standalone file pool for the remote panel.
 *
 * One folder holds everything either side puts there, so "transfer" is just both sides
 * listing the same directory. File ids are base64url(file name) and every id is
 * re-resolved against the pool root before touching the disk.
 *
 * This module is self-contained on purpose: the transfer feature no longer depends on
 * the life-helper plugin.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Folder name under the plugin state directory. */
export const POOL_DIR = 'files'

/** One upload may not exceed this; large videos are better copied over a cable. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

export function encodeId(rel) {
  return Buffer.from(String(rel), 'utf8').toString('base64url')
}

export function decodeId(id) {
  try {
    const text = Buffer.from(String(id), 'base64url').toString('utf8')
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/** One Windows-safe file name; returns '' when nothing usable survives. */
export function sanitizeName(raw) {
  let name = String(raw ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .trim()
  name = name.replace(/[. ]+$/g, '')
  if (name.length === 0 || name === '.' || name === '..') return ''
  const ext = extname(name).slice(0, 20)
  const stem = name.slice(0, Math.max(1, name.length - ext.length)).slice(0, 100)
  name = stem + ext
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = '_' + name
  return name
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar', '.apk': 'application/vnd.android.package-archive',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8'
}

export function mimeOf(name) {
  return MIME[extname(String(name)).toLowerCase()] ?? 'application/octet-stream'
}

/** RFC 5987 attachment header so non-latin1 names survive the trip. */
export function contentDisposition(name) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(String(name)).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase())
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encoded
}

/** Resolve a pool-relative path; null when it would escape the root. */
export function resolveInPool(dir, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null
  const base = resolve(dir)
  const target = resolve(base, rel)
  const lower = (value) => value.toLowerCase()
  if (lower(target) !== lower(base) && !lower(target).startsWith(lower(base) + sep)) return null
  return target
}

export async function ensurePool(dir) {
  await mkdir(dir, { recursive: true })
}

/** Newest first: the phone usually wants the file it just sent. */
export async function listPool(dir) {
  await ensurePool(dir)
  const entries = []
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (!item.isFile() || item.name.endsWith('.part')) continue
    try {
      const info = await stat(join(dir, item.name))
      entries.push({ id: encodeId(item.name), name: item.name, size: info.size, mtime: info.mtimeMs })
    } catch {
      /* the file vanished between readdir and stat */
    }
  }
  return entries.sort((a, b) => b.mtime - a.mtime)
}

/** First free name in the pool: "a.txt" collides into "a (1).txt", never overwritten. */
async function uniquePath(dir, name) {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  for (let index = 1; index <= 999; index += 1) {
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
    candidate = join(dir, stem + ' (' + index + ')' + ext)
  }
  return join(dir, stem + '-' + Date.now() + ext)
}

/** Write one uploaded buffer into the pool. Throws with a short reason on refusal. */
export async function saveUpload(dir, rawName, bytes) {
  const name = sanitizeName(rawName)
  if (name.length === 0) throw new Error('文件名不合法')
  if (!bytes || bytes.length === 0) throw new Error('文件是空的')
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('文件太大（上限 ' + Math.round(MAX_UPLOAD_BYTES / 1048576) + ' MB）')
  await ensurePool(dir)
  const target = await uniquePath(dir, name)
  const temp = join(dir, '.' + randomUUID() + '.part')
  await writeFile(temp, bytes)
  await rename(temp, target)
  const info = await stat(target)
  return { id: encodeId(basename(target)), name: basename(target), size: info.size, mtime: info.mtimeMs }
}

export async function openFile(dir, id) {
  const rel = decodeId(id)
  const path = rel ? resolveInPool(dir, rel) : null
  if (!path) return null
  const info = await stat(path).catch(() => null)
  if (!info || !info.isFile()) return null
  return { path, name: basename(path), size: info.size, mime: mimeOf(basename(path)), stream: () => createReadStream(path) }
}

export async function removeFile(dir, id) {
  const rel = decodeId(id)
  const path = rel ? resolveInPool(dir, rel) : null
  if (!path) return false
  try {
    await unlink(path)
    return true
  } catch {
    return false
  }
}
