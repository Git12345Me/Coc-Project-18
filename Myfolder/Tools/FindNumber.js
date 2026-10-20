/**
 * FindNumber.js - finds where a number is stored inside a packet (to locate fields like trophies).
 *
 *   node Tools/FindNumber.js <packet> <number> [<number> ...]
 *   <packet> = OwnHomeData | PlayerProfile | VisitHome | EnemyHomeData | SearchPlayer | NpcData | AllianceStream | a path to a .js/.hex file
 *
 * Idea: open a profile or an enemy village IN THE GAME, read the numbers it shows (trophies, level, wins ...),
 * and search those numbers in the packet the server sent for that screen. The offsets show the field layout.
 * Searches: VInt (the protocol's variable-size number), and 4-byte big/little-endian integers.
 * Compressed JSON parts are skipped. Small numbers (under 64) match by chance a lot: use big, unusual numbers.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function writeVInt (v) { // same encoding as ByteStream.writeVInt
  v &= 0xFFFFFFFF; let sv = v & 0x80000000 ? v - 0x100000000 : v
  let temp = (sv >> 25) & 0x40; let flipped = sv ^ (sv >> 31); temp |= sv & 0x3F; sv >>= 6; flipped >>= 6
  if (flipped === 0) return Buffer.from([temp & 0xFF])
  const out = [(temp | 0x80) & 0xFF]; flipped >>= 7; let r = flipped ? 0x80 : 0; out.push(((sv & 0x7F) | r) & 0xFF); sv >>= 7
  while (flipped !== 0) { flipped >>= 7; r = flipped ? 0x80 : 0; out.push(((sv & 0x7F) | r) & 0xFF); sv >>= 7 }
  return Buffer.from(out)
}

function loadPacket (what) {
  const dir = path.join(__dirname, '..', 'Protocol', 'Messages', 'Server')
  if (/^OwnHome/i.test(what)) {
    const buf = Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'Data', 'Home', 'original.hex'), 'utf8').trim(), 'hex')
    // skip the three compressed blobs: int32BE(len+4) | int32LE(rawLen) | zlib
    const skip = []; let pos = 37
    for (let i = 0; i < 3; i++) { const len = buf.readUInt32BE(pos); skip.push([pos, pos + 8 + len - 4]); pos += 8 + len - 4 + 1 }
    return { buf, skip, name: 'OwnHomeData (original capture)' }
  }
  const file = fs.existsSync(what) ? what : path.join(dir, what.replace(/Message(\.js)?$/, '') + 'Message.js')
  const text = fs.readFileSync(file, 'utf8')
  const hex = file.endsWith('.hex') ? text.trim() : /writeHex\(\s*["']([0-9a-fA-F]+)["']/.exec(text.replace(/\/\*[\s\S]*?\*\//g, ''))[1]
  const buf = Buffer.from(hex, 'hex')
  const skip = []
  for (let i = 8; i < buf.length - 2; i++) { // skip any zlib stream (78 9c) that really inflates
    if (buf[i] === 0x78 && buf[i + 1] === 0x9c) { const l = buf.readUInt32BE(i - 8) - 4; try { if (l > 0 && zlib.inflateSync(buf.subarray(i, i + l)).length) { skip.push([i - 8, i + l]); i += l } } catch (e) { /* not a stream */ } }
  }
  return { buf, skip, name: path.basename(file) }
}

if (require.main === module) {
  const [what, ...nums] = process.argv.slice(2)
  if (!what || !nums.length) { console.log('usage: node Tools/FindNumber.js <packet> <number> [<number> ...]'); process.exit(1) }
  const { buf, skip, name } = loadPacket(what)
  console.log(`${name}: ${buf.length} bytes (${skip.length} compressed part(s) skipped)`)
  const inSkip = (i) => skip.some(([a, b]) => i >= a && i < b)
  for (const s of nums) {
    const n = Number(s)
    const be = Buffer.alloc(4); be.writeInt32BE(n | 0); const le = Buffer.alloc(4); le.writeInt32LE(n | 0)
    const pats = [['VInt', writeVInt(n)], ['int32 BE', be], ['int32 LE', le]]
    console.log(`\n${n}${n < 64 && n >= 0 ? '   (small number: chance matches are likely)' : ''}`)
    let any = false
    for (const [kind, p] of pats) {
      for (let i = buf.indexOf(p); i >= 0; i = buf.indexOf(p, i + 1)) {
        if (inSkip(i)) continue
        any = true
        console.log(`  ${kind.padEnd(8)} at offset ${String(i).padStart(5)} (0x${i.toString(16)})  ...${buf.subarray(Math.max(0, i - 6), i).toString('hex')} [${p.toString('hex')}] ${buf.subarray(i + p.length, i + p.length + 6).toString('hex')}...`)
      }
    }
    if (!any) console.log('  not found')
  }
}
module.exports = { writeVInt, loadPacket }
