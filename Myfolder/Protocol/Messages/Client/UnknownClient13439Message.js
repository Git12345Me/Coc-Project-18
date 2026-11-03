const PiranhaMessage = require('../../PiranhaMessage')

/** 13439 - empty message seen once on the capital map in Captures7. Accepted and ignored (real meaning not found in IDA yet). */
class UnknownClient13439Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 13439
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = UnknownClient13439Message
