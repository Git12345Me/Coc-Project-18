const PiranhaMessage = require('../../PiranhaMessage')
const AllianceStreamMessage = require('../Server/AllianceStreamMessage')

class AskForAllianceStreamMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 11186
    this.version = 1
  }

  async decode () {}

  async process () {
    const msg = new AllianceStreamMessage(this.client)
    const a = this.client && this.client.player && this.client.player.alliance
    if (a) {
      try {
        const Database = require('../../../Database')
        const clan = await Database.getAllianceFull(a.id)
        if (clan) msg.clan = clan
      } catch (e) { console.log('[Clan] >> could not read clan ' + a.id + ' from MySQL, sending the sample: ' + e.message) }
    }
    await msg.send()
  }
}

module.exports = AskForAllianceStreamMessage
