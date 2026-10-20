/**
 * PatchLibg.js - sends EVERY client message as plain bytes (not only the ClientHello).
 *
 *   node Tools/PatchLibg.js libg.so                  checks the file (changes nothing)
 *   node Tools/PatchLibg.js libg.so libg_patched.so  writes a patched COPY
 *
 * Why: in sub_E8F898 (message send) the client tests "is the message type 10100?" twice. Only 10100 is copied
 * into the outgoing buffer; every other message goes to the encryption call. With encryption skipped but nothing
 * copied, the buffer stays uninitialized: right size, leftover memory as content (that is what all.log showed).
 *
 * The change is 4 bytes: the branch that jumps to the encryption path (B.NE, 01 01 00 54 at E8F9B4 in your build)
 * becomes a NOP (1F 20 03 D5), so the code falls through into the copy path for all messages.
 * The file offset is found by searching a 24-byte pattern that must match exactly once, so no address maths is needed.
 */
const fs = require('fs')
const [inFile, outFile] = process.argv.slice(2)
if (!inFile) { console.log('usage: node Tools/PatchLibg.js libg.so [libg_patched.so]'); process.exit(1) }

// MOV W8,#0x2774 | CMP W0,W8 | B.NE else | CBZ W23,done | MOV W8,W23 | ADD X0,X22,#7     (from your IDA listing)
const BEFORE = Buffer.from('88EE8452' + '1F00086B' + '01010054' + '77020034' + 'E803172A' + 'C01E0091', 'hex')
const AFTER = Buffer.from('88EE8452' + '1F00086B' + '1F2003D5' + '77020034' + 'E803172A' + 'C01E0091', 'hex')
const buf = fs.readFileSync(inFile)
const find = (pat) => { const hits = []; for (let i = buf.indexOf(pat); i >= 0; i = buf.indexOf(pat, i + 1)) hits.push(i); return hits }

const todo = find(BEFORE); const done = find(AFTER)
if (done.length === 1 && !todo.length) { console.log(`Already patched (NOP found at file offset 0x${(done[0] + 8).toString(16)}). Nothing to do.`); process.exit(0) }
if (todo.length !== 1) {
  console.log(todo.length === 0 ? 'Pattern not found: this libg.so is not the build from your IDA listing (or the code differs). Not changing anything.' : `Pattern found ${todo.length} times, expected exactly 1. Not changing anything.`)
  process.exit(1)
}
const at = todo[0] + 8 // the B.NE is the 3rd instruction of the pattern
console.log(`Found the send-path test at file offset 0x${at.toString(16)}: ${buf.subarray(at, at + 4).toString('hex')} (B.NE) -> 1f2003d5 (NOP)`)
if (!outFile) { console.log('Check only. Give an output name to write a patched copy.'); process.exit(0) }
const out = Buffer.from(buf); AFTER.copy(out, todo[0])
fs.writeFileSync(outFile, out)
let diff = 0; for (let i = 0; i < out.length; i++) if (out[i] !== buf[i]) diff++
console.log(`Written ${outFile}. ${diff} byte(s) differ from the original.`)
