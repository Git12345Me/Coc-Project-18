const PiranhaMessage = require('../../PiranhaMessage')
const LoginOkMessage = require('../Server/LoginOkMessage')
const LoginFailedMessage = require('../Server/LoginFailedMessage')
const OwnHomeDataMessage = require('../Server/OwnHomeDataMessage')
const Database = require('../../../Database')

class LoginMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 10101
    this.version = 1
  }

  async decode () {
    this.data = {}
    this.data.HighID = this.readInt()
    this.data.LowID = this.readInt()
    this.data.Token = this.readString()
    this.data.Major = this.readVInt()
    this.data.Build = this.readVInt()
    this.data.Content = this.readVInt()
  }

  async process () {
    this.client.log(`10101 Login received (LowID ${this.data.LowID})`)
    const player = await Database.login(this.data.HighID, this.data.LowID, this.data.Token)
    if (!player) return new LoginFailedMessage(this.client, 9, 'Invalid account token', 0).send()
    this.client.player = player

    setTimeout(() => { // same 2s delay as the original
      new LoginOkMessage(this.client).send()
      new OwnHomeDataMessage(this.client).send()
    }, 2000)
  }
}

module.exports = LoginMessage
