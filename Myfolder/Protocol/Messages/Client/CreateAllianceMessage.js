const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 19044 = the client asks to create a clan (confirmed with your ZZTEST capture).
 * Layout: string name | string description | 34 more bytes = 8 x int32 + 2 stray bytes. Strings are int32 length + utf8.
 *
 * Two captures: default settings gave ints [0, 1, 0, 0, 0, 0, 0, 0]; a clan with the badge changed and set to
 * "invite only" gave [1526727247 (0x5b00024f), 2, 0, 0, 0, 0, 0, 0]. You confirmed you changed exactly those two settings, so:
 *   int 1 = badge (0 = default badge, otherwise a packed value)
 *   int 2 = type: 1 = open, 2 = invite only (3 = closed is the classic value, not seen yet)
 * The remaining six ints were 0 in both captures (probably required trophies, war frequency, location ...: not mapped).
 *
 * For now the request is decoded and printed only. No reply is sent, so the game behaves as before (the clan is
 * not created) until the server's answer message is written.
 */
const TYPES = { 1: 'open', 2: 'invite only', 3: 'closed?' }

class CreateAllianceMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 19044
    this.version = 0
  }

  async decode () {
    const b = this.buffer; let pos = 0
    const str = () => { const n = b.readInt32BE(pos); pos += 4; const s = n > 0 ? b.toString('utf8', pos, pos + n) : ''; pos += Math.max(n, 0); return s }
    try {
      this.data = { name: str(), description: str(), fields: [], tail: '' }
      while (pos + 4 <= b.length) { this.data.fields.push(b.readInt32BE(pos)); pos += 4 }
      this.data.tail = b.subarray(pos).toString('hex') // bytes left over after the whole integers
      this.data.badge = this.data.fields[0]
      this.data.type = this.data.fields[1]
      this.data.typeName = TYPES[this.data.type] || 'unknown'
    } catch (e) { this.data = null }
  }

  async process () {
    if (!this.data) return this.client.log('[clan] create request could not be read')
    const d = this.data
    this.client.log(`[clan] create request: name="${d.name}" description="${d.description}" badge=${d.badge} type=${d.type} (${d.typeName}) other=[${d.fields.slice(2).join(',')}]${d.tail ? ' tail=' + d.tail : ''}`)
  }
}

module.exports = CreateAllianceMessage
