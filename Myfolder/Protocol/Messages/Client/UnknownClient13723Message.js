const PiranhaMessage = require('../../PiranhaMessage')

/** 13723: group 13. IDA: [bool has][long id][int]. Only logged - no reply yet (the reply id is still unknown). */
class UnknownClient13723Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 13723
    this.version = 0
  }

  async decode () {
    const b = this.buffer; let o = 0
    this.id64 = null
    if (b[o++] === 1) { this.id64 = b.readUInt32BE(o).toString() + ':' + b.readUInt32BE(o + 4).toString(); o += 8 }
    const n = b.readInt32BE(o)
    this.info = `id=${this.id64} int=${n}`
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[unknown 13723] ${this.info} - not answered yet`)
  }
}

module.exports = UnknownClient13723Message
