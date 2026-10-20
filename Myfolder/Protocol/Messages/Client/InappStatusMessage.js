const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 16203 InappStatusMessage - sent by the client in a burst right after login (billing/in-app product status).
 * The server does not need to answer it, so it is accepted and ignored. Registering it keeps it out of the
 * "undefined packet" log and out of Captures/.
 */
class InappStatusMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 16203
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = InappStatusMessage
