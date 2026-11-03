const PiranhaMessage = require('../../PiranhaMessage')

/** 12866: group 49. IDA C99310/C99360: [bool has][long id]. Only logged - no reply yet (the reply id is still unknown). */
class UnknownClient12866Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 12866
    this.version = 0
  }

  async decode () {
    const b = this.buffer; let o = 0
    this.id64 = null
    if (b[o++] === 1) { this.id64 = b.readUInt32BE(o).toString() + ':' + b.readUInt32BE(o + 4).toString(); o += 8 }
    this.info = `id=${this.id64}`
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[unknown 12866] ${this.info} - not answered yet`)
  }
}

module.exports = UnknownClient12866Message
