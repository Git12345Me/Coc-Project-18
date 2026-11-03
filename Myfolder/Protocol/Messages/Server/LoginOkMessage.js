const PiranhaMessage = require('../../PiranhaMessage')
const LoginOkData = require('../../LoginOkData')
const config = require('../../../Config')

class LoginOkMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 23654
    this.client = client
    this.version = 1
  }

  async encode () {
    const p = this.client.player
    const c = config.Content
    const eventUrl = c && c.Enabled && c.PublicUrl ? c.PublicUrl.replace(/\/+$/, '') + (c.EventUrlPath || '/event') : undefined
    const payload = p ? LoginOkData.build({ high: p.high, low: p.low, token: p.token, eventUrl }) : LoginOkData.build({ eventUrl })
    this.writeHex(payload.toString('hex'))
  }
}

module.exports = LoginOkMessage
