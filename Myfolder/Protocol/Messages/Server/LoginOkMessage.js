const PiranhaMessage = require('../../PiranhaMessage')
const LoginOkData = require('../../LoginOkData')

class LoginOkMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 23654
    this.client = client
    this.version = 1
  }

  async encode () {
    const p = this.client.player
    const payload = p ? LoginOkData.build({ high: p.high, low: p.low, token: p.token }) : LoginOkData.build()
    this.writeHex(payload.toString('hex'))
  }
}

module.exports = LoginOkMessage
