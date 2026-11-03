/**
 * AllianceData.js - server message 25413 (clan screen), decoded from IDA (C5BBE0 + C5D798 + C5E7F0 + C75A24 + C738CC) and PROVEN on the real 6235-byte sample:
 * decode() lands exactly on the last byte and encode(decode(sample)) is byte-identical (Tools/TestBattle.js).
 *
 * Stream rules: int32 / long big-endian, VInt, string = int32 length + utf8, BOOLS ARE BIT-PACKED (consecutive bools share one byte, bit 0 first),
 * slot 248 = 1 byte count.
 *
 *  header (sub_C5D798):  long id | string name | 12 x int32 [badge, type, memberCount, score, duelScore, 0 x 7] | int32 ref | int32 ref | int32 | int32 ref | 3 x int32 |
 *                        bool | int32 | bool | int32 | bool | int32 | bool | byte labelCount | labelCount x int32 (table 55)
 *  string description | int32 memberCount (max 50) | members | int32 count of 32-byte objects (0) | VInt wars (0) | VInt raids (0) |
 *  bool | int32 | int32 | int32 | bool (object 72, none) | bool | bool (object 80 = C738CC) |
 *  C738CC: VInt | bool | VInt | VInt | string | VInt | VInt (slot 280) | bool -> header again | string | string | VInt
 *  member (sub_C5E7F0):  long id | string name | 21 x int32 | bool -> long | int32
 *      ints: [0 role, 1 level, 2, 3, 4 trophies?, 5 duel trophies?, 6, 7, 8..11 ranks, 12 town hall, 13 time?, 14, 15, 16 =1, 17, 18, 19 =1, 20 = 2678400]
 * Unknown meaning stays in `raw` fields so a decoded packet can be written back unchanged.
 */
class Reader {
  constructor (buf) { this.b = buf; this.o = 0; this.bit = 0 }
  i32 () { this.bit = 0; const v = this.b.readInt32BE(this.o); this.o += 4; return v }
  i64 () { this.bit = 0; const v = this.b.readBigInt64BE(this.o); this.o += 8; return v }
  bool () { let v; if (this.bit === 0) { v = this.b[this.o++] & 1; this.bit = 1 } else { v = (this.b[this.o - 1] >> this.bit) & 1; this.bit = (this.bit + 1) & 7 } return v === 1 }
  byte () { this.bit = 0; return this.b[this.o++] }
  vint () { this.bit = 0; const start = this.o; let x = this.b[this.o++]; const neg = !!(x & 0x40); let v = x & 0x3f; let bits = 6; while (x & 0x80) { x = this.b[this.o++]; v += (x & 0x7f) * 2 ** bits; bits += 7 } return { v: neg ? v - 2 ** bits : v, raw: this.b.subarray(start, this.o).toString('hex') } }
  str () { const n = this.i32(); if (n < 0) return null; let s = ''; if (n > 0) { s = this.b.toString('utf8', this.o, this.o + n); this.o += n } return s }
}

class Writer {
  constructor () { this.parts = []; this.bitByte = null; this.bit = 0 }
  push (b) { this.parts.push(b); this.bitByte = null }
  i32 (v) { const b = Buffer.alloc(4); b.writeInt32BE(v | 0); this.push(b) }
  i64 (v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.push(b) }
  byte (v) { this.push(Buffer.from([v & 255])) }
  bool (v) {
    if (this.bitByte && this.bit !== 0) { if (v) this.bitByte[0] |= 1 << this.bit; this.bit = (this.bit + 1) & 7; if (this.bit === 0) this.bitByte = null; return }
    const b = Buffer.from([v ? 1 : 0]); this.parts.push(b); this.bitByte = b; this.bit = 1
  }
  vint (v) { // raw hex (as read) or a number
    if (typeof v === 'object') return this.push(Buffer.from(v.raw, 'hex'))
    const out = []; let n = v; const neg = n < 0; if (neg) n = -n - 1 // Supercell VInt: sign bit 0x40 in the first byte, two's complement style
    let first = (n & 0x3f) | (neg ? 0x40 : 0); n = Math.floor(n / 64)
    if (neg) first = ((~v) & 0x3f) | 0x40
    if (n > 0) first |= 0x80; out.push(first)
    while (n > 0) { let x = n & 0x7f; n = Math.floor(n / 128); if (n > 0) x |= 0x80; out.push(x) }
    this.push(Buffer.from(out))
  }
  str (s) { if (s === null) return this.i32(-1); const b = Buffer.from(String(s), 'utf8'); this.i32(b.length); this.push(b) }
  done () { return Buffer.concat(this.parts) }
}

function readHeader (r) {
  const h = { id: r.i64(), name: r.str(), ints: [] }
  for (let k = 0; k < 12; k++) h.ints.push(r.i32())
  h.refs = [r.i32(), r.i32()]; h.i52 = r.i32(); h.ref96 = r.i32(); h.i76 = r.i32(); h.i72 = r.i32(); h.i68 = r.i32()
  h.b104 = r.bool(); h.i108 = r.i32(); h.b105 = r.bool(); h.i112 = r.i32(); h.b116 = r.bool(); h.i120 = r.i32(); h.b124 = r.bool()
  const n = r.byte(); h.labels = []; for (let k = 0; k < n; k++) h.labels.push(r.i32())
  return h
}
function writeHeader (w, h) {
  w.i64(h.id); w.str(h.name); h.ints.forEach(v => w.i32(v))
  h.refs.forEach(v => w.i32(v)); w.i32(h.i52); w.i32(h.ref96); w.i32(h.i76); w.i32(h.i72); w.i32(h.i68)
  w.bool(h.b104); w.i32(h.i108); w.bool(h.b105); w.i32(h.i112); w.bool(h.b116); w.i32(h.i120); w.bool(h.b124)
  w.byte(h.labels.length); h.labels.forEach(v => w.i32(v))
}

function decode (buf) {
  const r = new Reader(buf); const d = {}
  d.header = readHeader(r); d.description = r.str()
  const n = r.i32(); d.members = []
  for (let k = 0; k < n; k++) {
    const m = { id: r.i64(), name: r.str(), ints: [] }
    for (let j = 0; j < 21; j++) m.ints.push(r.i32())
    m.hasSecond = r.bool(); m.second = m.hasSecond ? r.i64() : 0n; m.last = r.i32()
    d.members.push(m)
  }
  const objs = r.i32(); if (objs !== 0) throw new Error('32-byte object list is not empty: not decoded')
  const wars = r.vint(); const raids = r.vint(); if (wars.v !== 0 || raids.v !== 0) throw new Error('wars / raids not decoded')
  d.b88 = r.bool(); d.i80 = r.i32(); d.i84 = r.i32(); d.i92 = r.i32()
  const has72 = r.bool(); d.b100 = r.bool(); const has80 = r.bool()
  if (has72) throw new Error('object 72 (C5952C) not decoded')
  d.obj80 = null
  if (has80) {
    const o = {}
    o.v36 = r.vint(); o.b32 = r.bool(); o.v64 = r.vint(); o.v40 = r.vint(); o.s56 = r.str(); o.v44 = r.vint(); o.v280 = r.vint()
    o.hasHeader = r.bool(); o.header = o.hasHeader ? readHeader(r) : null
    o.s24 = r.str(); o.s16 = r.str(); o.v48 = r.vint()
    d.obj80 = o
  }
  d.end = r.o
  return d
}

function encode (d) {
  const w = new Writer()
  writeHeader(w, d.header); w.str(d.description); w.i32(d.members.length)
  for (const m of d.members) {
    w.i64(m.id); w.str(m.name); m.ints.forEach(v => w.i32(v)); w.bool(m.hasSecond); if (m.hasSecond) w.i64(m.second); w.i32(m.last)
  }
  w.i32(0); w.vint(0); w.vint(0)
  w.bool(d.b88); w.i32(d.i80); w.i32(d.i84); w.i32(d.i92)
  w.bool(false); w.bool(d.b100); w.bool(!!d.obj80)
  if (d.obj80) {
    const o = d.obj80
    w.vint(o.v36); w.bool(o.b32); w.vint(o.v64); w.vint(o.v40); w.str(o.s56); w.vint(o.v44); w.vint(o.v280)
    w.bool(o.hasHeader); if (o.hasHeader) writeHeader(w, o.header)
    w.str(o.s24); w.str(o.s16); w.vint(o.v48)
  }
  return w.done()
}

module.exports = { decode, encode, Reader, Writer }

/** Build a 25413 packet for a MySQL clan: keeps the proven sample as template and replaces only fields whose meaning is known. */
function build (clan, template) {
  const d = decode(template)
  const members = clan.members.slice(0, 50)
  const tpl = d.members[0]
  const sum = members.reduce((n, m) => n + m.trophies, 0)
  const h = Object.assign({}, d.header, { id: BigInt(clan.id), name: clan.name })
  h.ints = d.header.ints.slice(); h.ints[0] = clan.badge; h.ints[2] = members.length; h.ints[3] = Math.floor(sum / 2)
  d.header = h; d.description = clan.description
  d.members = members.map((m, i) => {
    const ints = tpl.ints.slice()
    ints[0] = m.role; ints[1] = (m.avatar && m.avatar.expLevel) || 1; ints[4] = m.trophies
    return Object.assign({}, tpl, { id: BigInt(m.id), name: m.name, ints, hasSecond: false, second: 0n })
  })
  if (d.obj80 && d.obj80.header) d.obj80.header = Object.assign({}, d.obj80.header, { id: h.id, name: h.name, ints: h.ints })
  return encode(d)
}
module.exports.build = build
