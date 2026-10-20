/**
 * HomeData.js
 * Rebuilds the OwnHomeData (25195) payload from readable parts.
 * The byte layout is exactly the one found in the original hex capture,
 * see Tools/ExtractHomeData.js for how the pieces were found.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = path.join(__dirname, '..', 'Data', 'Home')
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const seg = readJson('segments.json')
const S = (k) => Buffer.from(seg[k], 'hex')

// Defaults (what the original server always sent)
const DEFAULT_VILLAGE = readJson('village.json')
const EVENTS = readJson('events.json')
const GLOBALS = readJson('globals.json')
const DEFAULT_NAME = seg.defaultName

// Offsets inside `head` (inferred from the capture, verified only for the default values)
const HEAD_SERVER_TIME = 8 // uint32 BE unix time
const HEAD_ID_HIGH = 12 // int32 BE
const HEAD_ID_LOW = 16 // int32 BE

// The original server wrote JSON PHP-style: "/" is escaped as "\/" and non-ASCII as \uXXXX.
// Keeping that style makes the output byte-identical to the capture.
function serialize (obj) {
  return JSON.stringify(obj)
    .replace(/\//g, '\\/')
    .replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

function blob (obj) {
  const raw = Buffer.from(serialize(obj), 'utf8')
  const z = zlib.deflateSync(raw)
  const hdr = Buffer.alloc(8)
  hdr.writeUInt32BE(z.length + 4, 0) // compressed length + 4
  hdr.writeUInt32LE(raw.length, 4) // uncompressed length (little endian!)
  return Buffer.concat([hdr, z])
}

function str (s) {
  const b = Buffer.from(s, 'utf8')
  const l = Buffer.alloc(4)
  l.writeUInt32BE(b.length, 0)
  return Buffer.concat([l, b])
}

/**
 * @param {object} p
 * @param {string} [p.name]      player name (any utf8 string, length is handled)
 * @param {object} [p.village]   village JSON (what you store in MySQL)
 * @param {number} [p.high]      account id high part
 * @param {number} [p.low]       account id low part
 * @param {number} [p.time]      server time override (unix seconds)
 * @returns {Buffer} payload for OwnHomeData
 */
function build ({ name = DEFAULT_NAME, village = DEFAULT_VILLAGE, high, low, time } = {}) {
  const head = Buffer.from(S('head'))
  if (time !== undefined) head.writeUInt32BE(time >>> 0, HEAD_SERVER_TIME)
  if (high !== undefined) head.writeInt32BE(high, HEAD_ID_HIGH)
  if (low !== undefined) head.writeInt32BE(low, HEAD_ID_LOW)
  return Buffer.concat([
    head,
    blob(village), S('mid1'),
    blob(EVENTS), S('mid2'),
    blob(GLOBALS),
    S('preName'), str(name), S('postName')
  ])
}

module.exports = { build, DEFAULT_NAME, DEFAULT_VILLAGE: () => JSON.parse(JSON.stringify(DEFAULT_VILLAGE)) }
