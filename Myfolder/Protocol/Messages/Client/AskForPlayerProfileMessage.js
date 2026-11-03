const PiranhaMessage = require('../../PiranhaMessage')
const PlayerProfileMessage = require('../Server/PlayerProfileMessage')
const Database = require('../../../Database')

class AskForPlayerProfileMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 11734
    this.version = 1
  }

  async decode () {
    try { this.high = this.readInt(); this.low = this.readInt() } catch (e) { this.high = this.low = undefined }
  }

  async process () {
    const me = this.client.player
    let target = me
    if (me && this.low && Number(this.low) !== Number(me.low)) {
      try {
        const row = await Database.getRow(Number(this.low))
        if (row) {
          let village = null; try { village = JSON.parse(row.village) } catch (e) {}
          let avatar = {}; try { avatar = JSON.parse(row.avatar || '{}') } catch (e) {}
          target = { name: row.name, village, trophies: Number(row.trophies || 0), avatar, alliance: null }
        }
      } catch (e) { console.log('[profile] lookup failed: ' + e.message) }
    }
    if (me && this.client.log) this.client.log(`[profile] 11734 for id ${this.low}: ${target ? 'built from "' + target.name + '"' : 'sample'}`)
    await new PlayerProfileMessage(this.client, target).send()
  }
}

module.exports = AskForPlayerProfileMessage
