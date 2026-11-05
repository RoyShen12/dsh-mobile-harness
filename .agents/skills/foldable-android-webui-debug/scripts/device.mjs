#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = Number(process.env.CDP_PORT || 9222)
const MATCH = process.env.DSH_URL_MATCH || 'nyat'
const serial = process.env.ANDROID_SERIAL || execFileSync('adb', ['devices'], { encoding: 'utf8' })
  .split('\n').slice(1)
  .map((line) => line.split(/\s+/))
  .find((parts) => parts[1] === 'device')?.[0]

function adb(args) {
  return execFileSync('adb', [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8' })
}

function forward() {
  if (!serial) throw new Error('no adb device; connect the phone and confirm `adb devices` shows it')
  adb(['forward', `tcp:${PORT}`, 'localabstract:chrome_devtools_remote'])
}

async function pageTarget() {
  forward()
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page' && target.url.includes(MATCH))
  if (!page) throw new Error(`no page matching ${MATCH}; open the DSH page in Chrome first`)
  return page
}

async function connect() {
  const target = await pageTarget()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let id = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (!resolve) return
    pending.delete(message.id)
    resolve(message)
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id
    pending.set(messageId, resolve)
    socket.send(JSON.stringify({ id: messageId, method, params }))
  })
  return { send, close: () => socket.close() }
}

async function evaluate(expression) {
  const cdp = await connect()
  const message = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  cdp.close()
  if (message.result.exceptionDetails) throw new Error(message.result.exceptionDetails.text)
  return message.result.result.value
}

const [command, argument] = process.argv.slice(2)

async function main() {
  if (command === 'state') {
    console.log(JSON.stringify(await evaluate(`({
      url: location.href,
      viewport: [innerWidth, innerHeight],
      screen: [screen.width, screen.height, devicePixelRatio],
      skin: window.__dshMobileSkin?.getState()
    })`), null, 2))
  } else if (command === 'eval') {
    console.log(JSON.stringify(await evaluate(argument), null, 2))
  } else if (command === 'reload') {
    const cdp = await connect()
    await cdp.send('Page.reload', { ignoreCache: true })
    cdp.close()
    console.log('reloaded without browser cache')
  } else if (command === 'shot') {
    if (!argument) throw new Error('usage: device.mjs shot <path>')
    const cdp = await connect()
    const message = await cdp.send('Page.captureScreenshot', { format: 'png' })
    cdp.close()
    writeFileSync(argument, Buffer.from(message.result.data, 'base64'))
    console.log(argument)
  } else if (command === 'tap') {
    if (!argument) throw new Error('usage: device.mjs tap <selector>')
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(argument)})
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`)
    if (!point) throw new Error(`no element: ${argument}`)
    const metrics = await evaluate(`({
      pageBottom: innerHeight * devicePixelRatio,
      screenBottom: screen.height * devicePixelRatio,
      dpr: devicePixelRatio
    })`)
    const offset = metrics.screenBottom - metrics.pageBottom
    adb(['shell', 'input', 'tap',
      String(Math.round(point.x * metrics.dpr)),
      String(Math.round(point.y * metrics.dpr + offset))])
    console.log(`tapped ${argument}`)
  } else {
    console.log('usage: device.mjs state | eval <expr> | reload | shot <path> | tap <selector>')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
