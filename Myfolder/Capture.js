/** Capture.js - one place that writes Captures/all.log (used by the server and by the "mark" command). */
const fs = require('fs')
const path = require('path')
const DIR = path.join(__dirname, 'Captures')
const stamp = () => new Date().toISOString().slice(11, 23)

function line (text) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.appendFileSync(path.join(DIR, 'all.log'), text + '\n')
}

/** A packet that arrived from the client. */
function packet (message, known) {
  line(`${stamp()} id=${message.id} len=${message.len} ${known ? 'known  ' : 'UNKNOWN'} ${message.payload.subarray(0, 4096).toString('hex')}`)
}

/** A marker, so the log shows what you did in the game: "mark moved a cannon". */
function mark (text) { line(`${stamp()} ===== MARK: ${text}`) }

module.exports = { packet, mark, line }
