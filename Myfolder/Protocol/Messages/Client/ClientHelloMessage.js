const PiranhaMessage = require('../../PiranhaMessage')
const ServerHelloMessage = require('../Server/ServerHelloMessage')
const LoginOkMessage = require('../Server/LoginOkMessage')
const OwnHomeDataMessage = require('../Server/OwnHomeDataMessage')
const Database = require('../../../Database')

class ClientHelloMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 10100
    this.version = 0
  }

  async decode () {}

  async process () {
    if (Database.singlePlayer()) this.client.player = await Database.mainPlayer()
    await new ServerHelloMessage(this.client).send()

    await new LoginOkMessage(this.client).send()
    await new OwnHomeDataMessage(this.client).send()
  }
}

module.exports = ClientHelloMessage