const PiranhaMessage = require('../../PiranhaMessage')

/** 12865: group 28. IDA C98C48/C98CAC: [bool has][long id][bool][int]. Only logged - no reply yet (the reply id is still unknown). */
class UnknownClient12865Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 12865
    this.version = 0
  }

  async decode () {
    const b = this.buffer; let o = 0
    this.id64 = null
    if (b[o++] === 1) { this.id64 = b.readUInt32BE(o).toString() + ':' + b.readUInt32BE(o + 4).toString(); o += 8 }
    const flag = b[o++]; const n = b.readInt32BE(o)
    this.info = `id=${this.id64} flag=${flag} int=${n}`
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[unknown 12865] ${this.info} - not answered yet`)
  }
}

module.exports = UnknownClient12865Message
