const PiranhaMessage = require('../../PiranhaMessage')

/** 16109: group 64. IDA C82918/C82970: [bool has][8-byte object sub_D7F798]. Only logged - no reply yet (the reply id is still unknown). */
class UnknownClient16109Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 16109
    this.version = 0
  }

  async decode () {
    const b = this.buffer
    this.info = 'has=' + b[0] + ' obj8=' + b.subarray(1, 9).toString('hex')
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[unknown 16109] ${this.info} - not answered yet`)
  }
}

module.exports = UnknownClient16109Message
