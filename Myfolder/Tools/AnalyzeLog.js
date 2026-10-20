/**
 * AnalyzeLog.js - summarizes Captures/all.log.
 *   node Tools/AnalyzeLog.js [Captures/all.log]
 *
 * 1) decodes the ClientHello (the one message the client sends readable)
 * 2) per packet id: how many, sizes, and whether payloads look like real data or like leftover memory
 * 3) what arrived after each "mark" you typed in the server window (keepalives hidden)
 */
const fs = require('fs')
const path = require('path')
const file = process.argv[2] || path.join(__dirname, '..', 'Captures', 'all.log')
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => {
  const mark = /^(\S+) ===== MARK: (.*)$/.exec(l)
  if (mark) return { time: mark[1], mark: mark[2] }
  const m = /^(\S+) id=(\d+) len=(\d+) (known|UNKNOWN)\s*(\S*)$/.exec(l)
  return m ? { time: m[1], id: Number(m[2]), len: Number(m[3]), known: m[4] === 'known', payload: Buffer.from(m[5] || '', 'hex') } : null
}).filter(Boolean)

const hello = rows.find(r => r.id === 10100)
if (hello && hello.payload.length >= 24) {
  const p = hello.payload; const n = p.readUInt32BE(20)
  console.log(`ClientHello: protocol ${p.readUInt32BE(0)}, key ${p.readUInt32BE(4)}, version ${p.readUInt32BE(8)}.${p.readUInt32BE(12)}.${p.readUInt32BE(16)}, content hash ${p.subarray(24, 24 + n).toString()}`)
}

const text = (p) => (p.toString('latin1').match(/[ -~]{10,}/g) || [])
const groups = new Map()
for (const r of rows.filter(r => r.id !== undefined)) { if (!groups.has(r.id)) groups.set(r.id, []); groups.get(r.id).push(r) }
console.log('\nid      count  sizes                  payloads')
for (const [id, list] of [...groups].sort((a, b) => a[0] - b[0])) {
  const sizes = [...new Set(list.map(r => r.len))].sort((a, b) => a - b)
  const zero = list.filter(r => r.len && !r.payload.some(Boolean)).length
  const stray = list.filter(r => text(r.payload).length).length
  const verdict = list.every(r => r.len === 0) ? 'empty' : `${zero} all-zero, ${stray} with readable text` + (id === 10100 ? '  <- decoded above' : '')
  console.log(`${String(id).padEnd(7)} ${String(list.length).padEnd(6)} ${(sizes.slice(0, 5).join(',') + (sizes.length > 5 ? ',...' : '')).padEnd(22)} ${verdict}`)
}

console.log('\nTimeline (keepalive 10108 hidden):')
for (const r of rows) {
  if (r.mark) console.log(`\n${r.time}  ===== ${r.mark}`)
  else if (r.id !== 10108) console.log(`${r.time}  id ${r.id}  ${r.len} bytes  ${r.payload.subarray(0, 24).toString('hex')}${r.payload.length > 24 ? '...' : ''}`)
}
if (!rows.some(r => r.mark)) console.log('\n(no marks: type  mark <what you do>  in the server window before each action)')
