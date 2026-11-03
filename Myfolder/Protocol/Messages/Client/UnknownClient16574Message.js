const PiranhaMessage = require('../../PiranhaMessage')

/** 16574: group 75. IDA C92ADC/C92B3C: [bool has][8-byte object][VInt value]; sample = no object, value 17. Only logged - no reply yet (the reply id is still unknown). */
class UnknownClient16574Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 16574
    this.version = 0
  }

  async decode () {
    const b = this.buffer
    this.info = 'has=' + b[0] + ' value=' + (b.length > 1 ? b[b.length - 1] : '?')
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[unknown 16574] ${this.info} - not answered yet`)
  }
}

module.exports = UnknownClient16574Message
