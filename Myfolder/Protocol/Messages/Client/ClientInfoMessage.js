const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 15688 client info (device / app info) - IDA C956B4 (encode): bool+object, VInt, 3 strings (app version "18.0.5", OS "10", device "SM-S918B" ...), 2 optional lists, VInt, string. Sent once after login; nothing to answer.
 * The server does not answer it: it is accepted and ignored, so it stays out of the "undefined packet" log and out of Captures/.
 */
class ClientInfoMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 15688
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = ClientInfoMessage
