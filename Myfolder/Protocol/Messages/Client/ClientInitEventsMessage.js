const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 17949 client start-up timing events (init_csv, init_to_splash, init_load, init_to_home, home_battle) - telemetry, nothing to answer.
 * The server does not answer it: it is accepted and ignored, so it stays out of the "undefined packet" log and out of Captures/.
 */
class ClientInitEventsMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 17949
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = ClientInitEventsMessage
