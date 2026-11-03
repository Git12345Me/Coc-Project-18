const PiranhaMessage = require('../../PiranhaMessage')
const OwnHomeDataMessage = require('../Server/OwnHomeDataMessage')
const Capture = require('../../../Capture')
const config = require('../../../Config')
const BattleResult = require('../../BattleResult')

class GoHomeMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 10936
    this.version = 1
  }

  async decode () {}

  async process () {
    if (config.Server.CaptureAllPackets) Capture.mark('client: GO HOME (10936) - the game asks for the home village again (end of an attack or a reload)')
    // coming home after a fought attack: book trophies / loot FIRST, so the home packet already shows them and they are saved
    try { await BattleResult.settle(this.client) } catch (e) { this.client.log('[battle] result not booked: ' + e.message) }
    await new OwnHomeDataMessage(this.client).send()
  }
}

module.exports = GoHomeMessage