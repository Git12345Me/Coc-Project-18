const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 30000 device / analytics report (user agent string, ~5 KB) - sent after login, nothing to answer.
 * The server does not answer it: it is accepted and ignored, so it stays out of the "undefined packet" log and out of Captures/.
 */
class DeviceReportMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 30000
    this.version = 0
  }

  async decode () {}

  async process () {}
}

module.exports = DeviceReportMessage
