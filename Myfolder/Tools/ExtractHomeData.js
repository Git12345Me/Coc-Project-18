/**
 * ExtractHomeData.js
 * Splits the hex-coded OwnHomeData packet into readable pieces.
 *
 *   node Tools/ExtractHomeData.js [path/to/OwnHomeDataMessage.js]
 *
 * Packet layout discovered from the original capture:
 *   [head][blob1][mid1][blob2][mid2][blob3][pre-name][name string][post-name]
 * where every blob is   int32BE(zlibLen + 4) | int32LE(rawLen) | zlib stream
 * and the name is       int32BE(byteLength)  | utf8 bytes
 * blob1 = village JSON, blob2 = events JSON, blob3 = globals JSON.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const src = process.argv[2] || path.join(__dirname, 'original', 'OwnHomeDataMessage.original.js')
const outDir = path.join(__dirname, '..', 'Data', 'Home')
const text = fs.readFileSync(src, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') // drop the commented tutorial hex
const hex = /writeHex\(\s*["']([0-9a-fA-F]+)["']/.exec(text)[1]
const buf = Buffer.from(hex, 'hex')

// locate zlib blobs (78 9c) and verify them by inflating
const blobs = []
for (let i = 8; i < buf.length - 2; i++) {
  if (buf[i] !== 0x78 || buf[i + 1] !== 0x9c) continue
  const lenField = buf.readUInt32BE(i - 8)
  const rawLen = buf.readUInt32LE(i - 4)
  const zlibLen = lenField - 4
  if (zlibLen <= 0 || i + zlibLen > buf.length) continue
  try {
    const raw = zlib.inflateSync(buf.subarray(i, i + zlibLen))
    if (raw.length !== rawLen) continue
    blobs.push({ start: i - 8, end: i + zlibLen, zlib: buf.subarray(i, i + zlibLen), raw })
    i += zlibLen
  } catch (e) { /* not a real stream */ }
}
if (blobs.length !== 3) throw new Error(`expected 3 blobs, found ${blobs.length}`)

// locate the player name (length-prefixed utf8 right after the last blob)
const nameMarker = Buffer.from('Astral')
const nameAt = buf.indexOf(nameMarker, blobs[2].end)
if (nameAt < 0) throw new Error('name not found')
const nameLen = buf.readUInt32BE(nameAt - 4)
const nameStart = nameAt - 4
const nameEnd = nameAt + nameLen

const seg = {
  head: buf.subarray(0, blobs[0].start),
  mid1: buf.subarray(blobs[0].end, blobs[1].start),
  mid2: buf.subarray(blobs[1].end, blobs[2].start),
  preName: buf.subarray(blobs[2].end, nameStart),
  postName: buf.subarray(nameEnd)
}

fs.mkdirSync(outDir, { recursive: true })
const names = ['village', 'events', 'globals']
blobs.forEach((b, n) => {
  const pretty = JSON.stringify(JSON.parse(b.raw.toString('utf8')), null, 2)
  fs.writeFileSync(path.join(outDir, `${names[n]}.json`), pretty)
  const again = zlib.deflateSync(b.raw)
  console.log(`${names[n]}: ${b.raw.length} bytes JSON, recompress identical to original: ${again.equals(b.zlib)}`)
})
const segments = Object.fromEntries(Object.entries(seg).map(([k, v]) => [k, v.toString('hex')]))
segments.defaultName = buf.subarray(nameAt, nameEnd).toString('utf8')
fs.writeFileSync(path.join(outDir, 'segments.json'), JSON.stringify(segments, null, 2))
// the untouched compressed bytes, used by the self-test to prove byte-exactness
fs.writeFileSync(path.join(outDir, 'original.hex'), hex)
console.log('segment sizes:', Object.fromEntries(Object.entries(seg).map(([k, v]) => [k, v.length])))
console.log('default name:', segments.defaultName)
