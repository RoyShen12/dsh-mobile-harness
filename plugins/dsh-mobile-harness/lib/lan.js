/**
 * 局域网 / 虚拟组网地址的排序与选择。
 *
 * 抽成独立模块有两个原因：
 *   1. 面板（service.js）和命令行自检（tools/diagnose.mjs）必须用同一套规则，
 *      否则“二维码用哪个地址”在两处会给出不同答案；
 *   2. rankLanRows / pickLanAddress 是纯函数，可以脱离宿主直接做回归测试。
 *
 * 依赖只有 node:os，所以独立脚本也能 import。
 */
import { networkInterfaces } from 'node:os'

/** 网卡名优先级：物理网卡 → 虚拟组网 → 其他 → 虚拟机（永远排最后）。 */
export function lanAdapterRank(name) {
  const text = String(name || '')
  // Host-only adapters the phone can never reach through Wi-Fi.
  if (/vmware|virtualbox|vbox|hyper-?v|vethernet|npcap|loopback|bluetooth/i.test(text)) return 3
  if (/以太网|ethernet|wlan|wi-?fi|无线|wireless/i.test(text)) return 0
  // Virtual LANs: the phone reaches these only while the client is connected, and they are
  // usually the LOWEST latency path, so they rank right behind the physical adapter.
  // natpierce/jylink = 皎月连 (its adapter is literally named "natpierce").
  if (/radmin|tailscale|zerotier|hamachi|nevada|natpierce|jylink|皎月|tap-|^tun|\btun\d/i.test(text)) return 1
  return 2
}

/** Same-rank tie-break: 192.168 → 10 → 172.16-31 → anything else. */
export function lanAddressRank(address) {
  const text = String(address || '')
  if (/^192\.168\./.test(text)) return 0
  if (/^10\./.test(text)) return 1
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(text)) return 2
  return 3
}

/**
 * Sort [{ address, name }] into the order the panel shows.
 * @param {Array<{address: string, name: string}>} rows
 * @returns {Array<{address: string, name: string}>}
 */
export function rankLanRows(rows) {
  return [...rows].sort(
    (a, b) => lanAdapterRank(a.name) - lanAdapterRank(b.name) || lanAddressRank(a.address) - lanAddressRank(b.address)
  )
}

/** Every non-loopback IPv4 on this machine, best first. */
export function collectLanAddresses() {
  const rows = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      rows.push({ address: entry.address, name })
    }
  }
  return rankLanRows(rows)
}

/**
 * Which address should the QR advertise? The picked one when it still exists, else the best one.
 * A remembered address can vanish (cable unplugged, VPN client closed); falling back beats handing
 * out an address that answers nothing.
 * @param {Array<{address: string, name: string}>} rows
 * @param {string|null|undefined} wanted
 * @returns {string|null}
 */
export function pickLanAddress(rows, wanted) {
  if (wanted && rows.some((entry) => entry.address === wanted)) return wanted
  return rows[0]?.address ?? null
}
