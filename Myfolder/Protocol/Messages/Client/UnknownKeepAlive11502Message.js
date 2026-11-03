const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 11502 - empty client message (0 bytes) seen in Captures6 right after the loading screen. Nothing to answer, so it is accepted and ignored
 * (it stays out of the "Gotcha undefined" log). Real meaning not found in IDA yet.
 */
class UnknownKeepAlive11502Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 11502
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = UnknownKeepAlive11502Message
