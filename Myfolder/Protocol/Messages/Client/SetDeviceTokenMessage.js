const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 13708 set device token (push notifications) - sent after login, nothing to answer.
 * The server does not answer it: it is accepted and ignored, so it stays out of the "undefined packet" log and out of Captures/.
 */
class SetDeviceTokenMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 13708
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = SetDeviceTokenMessage
