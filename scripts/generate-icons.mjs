// One-off icon generator: writes the extension's PNG icons from a vector-ish
// pixel routine so the repo needs no binary asset pipeline or design tool.
// Draws a rounded-square accent tile with a clock face (ring + two hands).
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const ACCENT = [26, 115, 232] // #1a73e8
const INK = [255, 255, 255]

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4
      raw[o++] = pixels[p]
      raw[o++] = pixels[p + 1]
      raw[o++] = pixels[p + 2]
      raw[o++] = pixels[p + 3]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Signed distance helpers, evaluated on a supersampled grid for clean edges.
const sdRoundRect = (px, py, hw, hh, r) => {
  const qx = Math.abs(px) - (hw - r)
  const qy = Math.abs(py) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdSegment = (px, py, ax, ay, bx, by, thick) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - thick
}

function render(size) {
  const S = 4 // supersample factor
  const px = Buffer.alloc(size * size * 4)
  // Geometry in normalized [-1, 1] space.
  const ringR = 0.56
  const ringT = size >= 48 ? 0.1 : 0.13
  const handT = size >= 48 ? 0.075 : 0.1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tileA = 0, inkA = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = ((x + (sx + 0.5) / S) / size) * 2 - 1
          const v = ((y + (sy + 0.5) / S) / size) * 2 - 1
          if (sdRoundRect(u, v, 0.94, 0.94, 0.3) <= 0) tileA++
          // Clock ring.
          const ring = Math.abs(Math.hypot(u, v) - ringR) - ringT / 2
          // Hands: 12 o'clock and 4 o'clock, meeting at centre.
          const hourHand = sdSegment(u, v, 0, 0, 0, -0.34, handT / 2)
          const minHand = sdSegment(u, v, 0, 0, 0.3, 0.16, handT / 2)
          if (Math.min(ring, hourHand, minHand) <= 0) inkA++
        }
      }
      const n = S * S
      const tile = tileA / n
      const ink = Math.min(inkA / n, tile)
      const o = (y * size + x) * 4
      // Composite ink over accent, then the whole tile over transparency.
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(
          tile > 0 ? (ACCENT[c] * (tile - ink) + INK[c] * ink) / tile : 0,
        )
      }
      px[o + 3] = Math.round(tile * 255)
    }
  }
  return px
}

mkdirSync('public/icons', { recursive: true })
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size, render(size)))
  console.log('wrote public/icons/icon-' + size + '.png')
}
