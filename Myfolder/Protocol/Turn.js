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

// Commands whose length is known from libg.so (decode functions). Needed because the splitter below looks for "00 00 1x xx", and a number
// inside a body (e.g. a count of 5000 = 00 00 13 88, or a data id like 4000009 = 00 3d 09 09 next to a coordinate) looks like a command id.
// Stream reader slots seen in the decode functions: +224 byte/bool (1 byte), +240 int32 (4 bytes), +272 VInt. Writer: +64 byte, +80 int32, +136 VInt.
// A "data reference" is an int32 data id (checked on 8030 and 7408: 4000009 = 00 3d 09 09). Every command starts with the base VInt subTick.
//  8000 search opponent   (sub_AC2248): [dataRef int32][int32 count][VInt subTick]  (base decode runs LAST here)
//  7408 place attacker    (sub_AC8BBC): [VInt subTick][dataRef int32 troop][VInt x][VInt y][byte fromCastle][int32 castleSlot]
//  7662 end battle        (thunk -> sub_AB9018): [VInt subTick]
//  8040 (sub_ADF688):      [VInt subTick][VInt value]
//  8030 mission progress  (sub_AC31FC): [VInt subTick][byte claim][dataRef int32 mission, table 20]
const seq = (...steps) => (b, p) => { // steps: 'v' VInt, 'i' int32, 'b' byte
  for (const st of steps) {
    if (st === 'v') { const r = readVInt(b, p); if (!r) return null; p = r.next } else p += st === 'i' ? 4 : 1
    if (p > b.length) return null
  }
  return p
}
const KNOWN_LENGTH = {
  8000: seq('i', 'i', 'v'),
  7408: seq('v', 'i', 'v', 'v', 'b', 'i'),
  7662: seq('v'),
  8040: seq('v', 'v'),
  8030: seq('v', 'b', 'i'),
  5052: seq('v', 'b'), // 0x13BC  AD0C6C: [VInt tick][byte flag]
  6340: seq('v', 'i'), // 0x18C4  ADBEDC: [VInt tick][int32 value]
  6154: seq('v', 'v') //  0x180A  ADD044 (encode): [VInt tick][VInt value]
}

/** The three start-up commands the client repeats after every login: 5052 = {flag}, 6340 = {value int32}, 6154 = {value VInt}. Returns {id, value} or null. */
function decodeState (c) {
  if (!c || ![5052, 6340, 6154].includes(c.id)) return null
  const b = Buffer.from(c.hex || '', 'hex'); const t = readVInt(b, 0); if (!t) return null
  if (c.id === 5052) return b.length - t.next === 1 ? { id: 5052, value: b[t.next] } : null
  if (c.id === 6340) return b.length - t.next === 4 ? { id: 6340, value: b.readInt32BE(t.next) } : null
  const v = readVInt(b, t.next); return v && v.next === b.length ? { id: 6154, value: v.value } : null
}

/** @returns {{tick:number, checksum:number, count:number, commands:{id:number, fields:(number|string)[], hex:string}[], uncertain:boolean}|null} */
function parse (payload) {
  if (!payload || payload.length < 12) return null
  const tick = payload.readUInt32BE(0); const checksum = payload.readUInt32BE(4); const count = payload.readUInt32BE(8)
  const starts = []
  for (let i = 12; i + 4 <= payload.length; i++) {
    if (payload[i] === 0 && payload[i + 1] === 0) { const v = payload.readUInt16BE(i + 2); if (v >= 0x1000 && v < 0x2000) starts.push(i) }
  }
  for (let k = 0, skip = 0; k < starts.length; k++) { // drop "starts" that lie inside the body of a command with a known length
    if (starts[k] < skip) { starts.splice(k--, 1); continue }
    const f = KNOWN_LENGTH[payload.readUInt32BE(starts[k])]
    const end = f ? f(payload, starts[k] + 4) : null
    if (end) skip = end
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
const SEARCH_OPPONENT = 8000 // body: int32 0, int32 0, VInt tick - same layout as v9 Search_Opponent (two ReadInt32, then the tick). Seen once, right when Attack was pressed.
const NAMES = { 8000: 'search opponent (resource, search fee)', 7408: 'deploy troop (LogicPlaceAttackerCommand)', 7662: 'END OF BATTLE (LogicEndCombat? body: tick only)', 8040: 'set a value (seen between deploys, stored in the game state)', 8030: 'mission progress', 5559: 'move building', 6338: 'start upgrade', 5048: 'place building', 5040: 'speed up / finish now?', 6631: 'tick only?' }

/** Readable form of a place-building command: body = VInt tick, VInt y, VInt 0, VInt x, int32 data id. */
function describePlace (c) {
  try {
    const body = Buffer.from(c.hex, 'hex'); let pos = 0; const v = []
    for (let i = 0; i < 4; i++) { const r = readVInt(body, pos); v.push(r.value); pos = r.next }
    const data = body.readInt32BE(pos); const info = require('./BuildingData').info(data)
    return `${info ? info.name : 'building type ' + data} (${data}) at x=${v[3]}, y=${v[1]}`
  } catch (e) { return null }
}

/**
 * Command 8030 = mission command (IDA: vtable +0x28/+0x30; execute -> sub_CA0700 / sub_CA01E0).
 * Body: [VInt subTick][byte claim][int32 21000000 + n].
 *   claim = 1 -> the mission is COMPLETED (sub_CA01E0 sets it done in the avatar mission list, sub_A31820(avatar, mission, 1));
 *   claim = 0 -> progress / start only (sub_CA0700 switch on the mission type).
 * Returns { id: n, claim: bool } or null.
 */
function decodeMission (c) {
  if (!c || c.id !== 8030) return null
  const b = Buffer.from(c.hex || '', 'hex')
  const t = readVInt(b, 0)
  if (!t || b.length - t.next !== 5) return null
  const id = b.readInt32BE(t.next + 1)
  if (id < 21000000 || id >= 21001000) return null
  return { id: id - 21000000, claim: b[t.next] === 1 }
}

/** Mission number of an 8030 command (any claim flag), or null. */
function missionOf (c) {
  const m = decodeMission(c)
  return m ? m.id : null
}

function summary (turn, village) {
  const cmds = turn.commands.map(c => c.id === 8030 && missionOf(c) !== null ? `cmd 8030 [mission progress]: mission ${missionOf(c)}` : c.id === 5048 && describePlace(c) ? `cmd 5048 [place building]: ${describePlace(c)}` : `cmd ${c.id}${NAMES[c.id] ? ' [' + NAMES[c.id] + ']' : ''}: ${c.fields.map(f => describeField(f, village)).join(', ')}${NAMES[c.id] ? '' : '  | raw ' + c.hex}`)
  return `tick ${turn.tick}, ${turn.count} command(s)${turn.uncertain ? ' (split uncertain)' : ''}${cmds.length ? ' -> ' + cmds.join(' | ') : ''}`
}

/**
 * Command 8000 = "search opponent" (libg.so 18.0.5: type function sub_AC21F4, decode sub_AC2248, encode sub_AC21FC, execute sub_AC1FBC).
 * Decode: data reference restricted to table index 2 (= the RESOURCES table, ids 3000000+), int32 count, then the base class: VInt sub tick.
 * Execute: with a resource and count >= 1 it checks that you own `count` of it and takes it away = the SEARCH FEE (gold). With 0 / 0 (what
 * the capture shows) nothing is paid. The sub tick is the turn tick minus 1 in both captures.
 * @returns {{resource:number, cost:number, subTick:number}|null}
 */
function decodeSearch (c) {
  if (!c || c.id !== SEARCH_OPPONENT) return null
  const b = Buffer.from(c.hex || '', 'hex')
  if (b.length < 9) return null
  const t = readVInt(b, 8)
  return { resource: b.readInt32BE(0), cost: b.readInt32BE(4), subTick: t ? t.value : null }
}

/**
 * Command 7408 = a troop / spell / hero is placed in a battle (libg.so: class "LogicPlaceAttackerCommand", decode sub_AC8BBC, execute sub_AC7EB8).
 * Body: VInt subTick, int32 data id (4000000+ troop, 26000000+ spell, 28000000+ hero), VInt x, VInt y (1/512 tile: execute uses x>>9, y>>9),
 * byte fromCastle (1 = the unit comes from the Clan Castle), int32 castleSlot (-1 when fromCastle is 0).
 * @returns {{subTick:number, unit:number, x:number, y:number, fromCastle:boolean, castleSlot:number}|null}
 */
function decodeDeploy (c) {
  if (!c || c.id !== 7408) return null
  const b = Buffer.from(c.hex || '', 'hex')
  const t = readVInt(b, 0); if (!t || b.length < t.next + 4) return null
  const unit = b.readInt32BE(t.next)
  const x = readVInt(b, t.next + 4); const y = x && readVInt(b, x.next)
  if (!x || !y || b.length < y.next + 5) return null
  return { subTick: t.value, unit, x: x.value, y: y.value, fromCastle: b[y.next] === 1, castleSlot: b.readInt32BE(y.next + 1) }
}

/** True when the turn carries the "search opponent" command (the Attack button). */
const hasSearch = (turn) => !!turn && turn.commands.some(c => c.id === SEARCH_OPPONENT)

module.exports = { decodeDeploy, decodeSearch, hasSearch, SEARCH_OPPONENT, NAMES, parse, readVInt, vints, summary, describeField, missionOf, decodeMission, decodeState }
