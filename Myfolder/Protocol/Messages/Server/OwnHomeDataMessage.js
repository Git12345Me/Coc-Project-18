const PiranhaMessage = require('../../PiranhaMessage')
const HomeData = require('../../HomeData')
const Database = require('../../../Database')

/**
 * 25195 OwnHomeData. Bytes come from Protocol/HomeData.js (readable JSON + name + ids).
 * With no player on the client it sends the original default data, byte for byte.
 * Original capture kept in Tools/original/.
 */
class OwnHomeDataMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 25195
    this.client = client
    this.version = 1
  }

  async encode () {
    const p = this.client.player
    // p.skins = [{ id: 52000102, equipped: true }, ...] is loaded from MySQL (player_skins).
    // TODO: write it into the packet once the skin field in the avatar section is located.
    // Until then skins are stored but not sent, so the game shows no change.
    const payload = p
      ? HomeData.build({ name: p.name, village: p.village, high: p.high, low: p.low })
      : HomeData.build()
    this.writeHex(payload.toString('hex'))
    Database.markGoodLater(this.client)
  }
}

module.exports = OwnHomeDataMessage
