/**
 * Turn.js - reads the client's "end of turn" message (id 14309 in your 18.0.5 captures).
 *
 * What the captures show (all.log):
 *   int32 tick | int32 checksum | int32 commandCount | commands...
 *   - count 0 = 12 bytes, sent about every 5 seconds (this is the 12-byte 14309 you saw all the time)
 *   - every command = int32 command id (values 0x13b0..0x19e7 so far) + VInt fields (command specific)
 *   - in the sample where you moved a building, the first VInt is the tick minus 64 (5296 -> 5232)
 *
 * What is NOT known yet: the meaning of each command id and of each field. Only structure is decoded here.
 * The split into commands looks for 00 00 1x xx (a 4-byte id in 0x1000..0x1fff) and is flagged "uncertain"
 * if the number of candidates differs from the command count.
 */
const BUILDING_IDS = [500000000, 509999999]

/** Supercell VInt: first byte = continuation(0x80) | sign(0x40) | 6 bits, next bytes 7 bits each. */
function readVInt (buf, pos) {
  let b = buf[pos++]
  if (b === undefined) return null
  const neg = !!(b & 0x40)
  let value = b & 0x3f; let bits = 6
  while (b & 0x80) {
    b = buf[pos++]
    if (b === undefined) return null
    value += (b & 0x7f) * Math.pow(2, bits); bits += 7
  }
  return { value: neg ? value - Math.pow(2, bits) : value, next: pos }
}

function vints (buf) {
  const out = []; let pos = 0
  while (pos < buf.length) { const r = readVInt(buf, pos); if (!r) { out.push('?' + buf.subarray(pos).toString('hex')); break } out.push(r.value); pos = r.next }
  return out
}

/** @returns {{tick:number, checksum:number, count:number, commands:{id:number, fields:(number|string)[], hex:string}[], uncertain:boolean}|null} */
function parse (payload) {
  if (!payload || payload.length < 12) return null
  const tick = payload.readUInt32BE(0); const checksum = payload.readUInt32BE(4); const count = payload.readUInt32BE(8)
  const starts = []
  for (let i = 12; i + 4 <= payload.length; i++) {
    if (payload[i] === 0 && payload[i + 1] === 0) { const v = payload.readUInt16BE(i + 2); if (v >= 0x1000 && v < 0x2000) starts.push(i) }
  }
  const commands = []
  if (count > 0 && starts[0] === 12) {
    starts.forEach((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : payload.length
      const body = payload.subarray(s + 4, end)
      commands.push({ id: payload.readUInt32BE(s), fields: vints(body), hex: body.toString('hex') })
    })
  }
  return { tick, checksum, count, commands, uncertain: count > 0 && (starts[0] !== 12 || starts.length !== count) }
}

/** Turns building ids (5000000xx) into readable names using a village object. */
function describeField (value, village) {
  if (typeof value !== 'number' || value < BUILDING_IDS[0] || value > BUILDING_IDS[1] || !village) return String(value)
  const b = (village.buildings || []).find(x => x.id === value) || (village.obstacles || []).find(x => x.id === value)
  if (!b) return `${value} (id)`
  let name = String(b.data)
  try { const i = require('./BuildingData').info(b.data) || require('./ObstacleData').info(b.data); if (i) name = i.name } catch (e) { /* names are optional */ }
  return `${value} (${name} at ${b.x},${b.y})`
}

// Names verified with labeled captures (marks). A trailing ? means "probably".
const NAMES = { 5559: 'move building', 6338: 'start upgrade', 5048: 'place building', 5040: 'speed up / finish now?', 6631: 'tick only?' }

/** Readable form of a place-building command: body = VInt tick, VInt y, VInt 0, VInt x, int32 data id. */
function describePlace (c) {
  try {
    const body = Buffer.from(c.hex, 'hex'); let pos = 0; const v = []
    for (let i = 0; i < 4; i++) { const r = readVInt(body, pos); v.push(r.value); pos = r.next }
    const data = body.readInt32BE(pos); const info = require('./BuildingData').info(data)
    return `${info ? info.name : 'building type ' + data} (${data}) at x=${v[3]}, y=${v[1]}`
  } catch (e) { return null }
}

function summary (turn, village) {
  const cmds = turn.commands.map(c => c.id === 5048 && describePlace(c) ? `cmd 5048 [place building]: ${describePlace(c)}` : `cmd ${c.id}${NAMES[c.id] ? ' [' + NAMES[c.id] + ']' : ''}: ${c.fields.map(f => describeField(f, village)).join(', ')}`)
  return `tick ${turn.tick}, ${turn.count} command(s)${turn.uncertain ? ' (split uncertain)' : ''}${cmds.length ? ' -> ' + cmds.join(' | ') : ''}`
}

module.exports = { parse, readVInt, vints, summary, describeField }
