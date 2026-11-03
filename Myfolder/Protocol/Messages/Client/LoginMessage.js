const PiranhaMessage = require('../../PiranhaMessage')
const LoginOkMessage = require('../Server/LoginOkMessage')
const LoginFailedMessage = require('../Server/LoginFailedMessage')
const OwnHomeDataMessage = require('../Server/OwnHomeDataMessage')
const Database = require('../../../Database')
const Content = require('../../../Content/ContentUpdate')

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
    try { this.data.Sha = this.readString() } catch (e) { this.data.Sha = null } // client's current fingerprint sha
  }

  async process () {
    this.client.log(`10101 Login received (LowID ${this.data.LowID}) clientSha=${this.data.Sha}`)
    const upd = Content.check(this.data.LowID, this.data.Sha)
    if (upd) {
      this.client.log(`Content update required -> sending code 7 (server sha ${upd.sha})`)
      return new LoginFailedMessage(this.client, 7, '', 0, { fingerprint: upd.fingerprint, contentUrl: upd.contentUrl }).send()
    }
    const player = await Database.login(this.data.HighID, this.data.LowID, this.data.Token, this.client)
    if (!player) return new LoginFailedMessage(this.client, 9, 'Invalid account token', 0).send()
    this.client.player = player

    setTimeout(() => { // same 2s delay as the original
      new LoginOkMessage(this.client).send()
      new OwnHomeDataMessage(this.client).send()
    }, 2000)
  }
}

module.exports = LoginMessage
