// Regenerate Android launcher icons and splash images from the Harness whale SVG.
// Uses sharp (librsvg) so the SVG is rasterised faithfully (no headless-browser round trip).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const res = join(root, 'android', 'app', 'src', 'main', 'res')
const svgPath = join(root, '..', '.research', 'asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg')

const svg = readFileSync(svgPath, 'utf8')
const paths = [...svg.matchAll(/<path[^>]*d="([^"]+)"/g)].map((m) => m[1])
if (paths.length === 0) throw new Error('whale path not found')

const whaleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">${paths
  .map((d) => `<path d="${d}" fill="#ffffff"/>`)
  .join('')}</svg>`

const BRAND = '#2F6BFF'

const whalePng = await sharp(Buffer.from(whaleSvg)).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

const roundedRect = (size, radius) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND}"/></svg>`
  )

const circle = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${BRAND}"/></svg>`)

async function compose(bg, whaleScale, size) {
  const glyph = await sharp(whalePng).resize(Math.round(size * whaleScale), Math.round(size * whaleScale), { fit: 'contain' }).png().toBuffer()
  return sharp(bg)
    .composite([{ input: glyph, gravity: 'centre' }])
    .png()
    .toBuffer()
}

const square = await compose(roundedRect(1024, 224), 0.62, 1024)
const round = await compose(circle(1024), 0.6, 1024)

const foreground = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp(whalePng).resize(460, 460, { fit: 'contain' }).png().toBuffer(), gravity: 'centre' }])
  .png()
  .toBuffer()

const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const FG_SIZES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }

for (const [density, size] of Object.entries(SIZES)) {
  const dir = join(res, `mipmap-${density}`)
  await sharp(square).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'))
  await sharp(round).resize(size, size).png().toFile(join(dir, 'ic_launcher_round.png'))
  await sharp(foreground).resize(FG_SIZES[density], FG_SIZES[density]).png().toFile(join(dir, 'ic_launcher_foreground.png'))
}

// Splash: keep the existing sizes, paint a dark background with the whale centred.
const splashFiles = []
for (const dirName of readdirSync(res)) {
  if (!dirName.startsWith('drawable')) continue
  const dir = join(res, dirName)
  if (!statSync(dir).isDirectory()) continue
  for (const file of readdirSync(dir)) {
    if (file === 'splash.png') splashFiles.push(join(dir, file))
  }
}
for (const file of splashFiles) {
  const { width, height } = await sharp(file).metadata()
  const glyph = await sharp(whalePng).resize(Math.round(Math.min(width, height) * 0.3)).png().toBuffer()
  const base = await sharp({ create: { width, height, channels: 3, background: '#0F1115' } }).png().toBuffer()
  await sharp(base).composite([{ input: glyph, gravity: 'centre' }]).png().toFile(file)
}

// Vector drawables for adaptive icons (v26+).
const pathData = paths.join(' ')
writeFileSync(
  join(res, 'drawable', 'ic_launcher_foreground.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:scaleX="1.0" android:scaleY="1.0" android:translateX="29" android:translateY="29">
        <path android:fillColor="#FFFFFF" android:pathData="${pathData}" />
    </group>
</vector>
`
)
// Adaptive icons (v26+). Use the PNG foreground: OEM launchers (OriginOS/iQOO, EMUI…) are more
// reliable with bitmaps than with a VectorDrawable foreground.
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`
writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive)
writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive)
writeFileSync(
  join(res, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND}</color>
</resources>
`
)

console.log(`icons regenerated (brand ${BRAND}); splash files: ${splashFiles.length}`)
