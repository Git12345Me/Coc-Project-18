/**
 * DecodeTurns.js - shows the commands inside every 14309 (end-of-turn) packet of Captures/all.log
 *   node Tools/DecodeTurns.js [Captures/all.log]
 * Heartbeats (0 commands) are hidden. Marks you typed in the server window are shown in between.
 * Building ids are named using the default village.
 */
const fs = require('fs')
const path = require('path')
const Turn = require('../Protocol/Turn')
const village = require('../Protocol/HomeData').DEFAULT_VILLAGE()
const file = process.argv[2] || path.join(__dirname, '..', 'Captures', 'all.log')
let shown = 0; let beats = 0
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  const mark = /^(\S+) ===== MARK: (.*)$/.exec(l)
  if (mark) { console.log(`\n${mark[1]}  ===== ${mark[2]}`); continue }
  const m = /^(\S+) id=14309 len=(\d+) \S+\s*(\S*)$/.exec(l)
  if (!m) continue
  const t = Turn.parse(Buffer.from(m[3], 'hex'))
  if (!t) continue
  if (!t.count) { beats++; continue }
  shown++; console.log(`${m[1]}  ${Turn.summary(t, village)}`)
}
console.log(`\n${shown} turn(s) with commands shown, ${beats} empty heartbeat(s) hidden.`)
