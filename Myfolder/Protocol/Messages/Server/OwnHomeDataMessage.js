const PiranhaMessage = require('../../PiranhaMessage')
const HomeData = require('../../HomeData')
const Database = require('../../../Database')
const config = require('../../../Config')

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
    let payload
    try {
      payload = p
        // the stored player values (level, trophies, clan ...) are written into the avatar block of the login packet
        ? HomeData.build({ name: p.name, village: p.village, high: p.high, low: p.low, probes: config.Server.Probes, avatar: Object.assign({}, p.avatar, { trophies: p.trophies, alliance: p.alliance || undefined, army: require('../../Army').effective(p) || undefined, missionsAllDone: config.Server.AllMissionsDone === true, missionsClaimed: config.Server.MissionBits === false ? undefined : (p.avatar && p.avatar.missionsClaimed) }) })
        : HomeData.build({ probes: config.Server.Probes })
    } catch (e) { // never let a bad stored value break the login: fall back to the plain packet
      console.log('[login] could not apply the stored player values, sending the plain packet: ' + e.message)
      payload = HomeData.build({ name: p ? p.name : undefined, village: p ? p.village : undefined, high: p ? p.high : undefined, low: p ? p.low : undefined })
    }
    if (p && !p.guest && this.client && typeof this.client.log === 'function') { // shows what was really written into the login packet
      const av = p.avatar || {}
      this.client.log(`[login] sent to "${p.name}": trophies ${p.trophies}, duel trophies ${av.duelTrophies === undefined ? '(original)' : av.duelTrophies}, level ${av.expLevel === undefined ? '(original)' : av.expLevel}, ` +
        `gems ${av.gems === undefined ? '(original)' : av.gems}, resources ${av.resources ? Object.entries(av.resources).map(([k, n]) => k + '=' + n).join(' ') : '(original)'}, clan ${p.alliance ? '"' + p.alliance.name + '" (role ' + p.alliance.role + ')' : 'none'}`)
    }
    this.writeHex(payload.toString('hex'))
    Database.markGoodLater(this.client)
  }
}

module.exports = OwnHomeDataMessage
