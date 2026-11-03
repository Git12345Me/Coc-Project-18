const PiranhaMessage = require('../../PiranhaMessage')
const Database = require('../../../Database')

/**
 * 14308 (IDA sub_C64214, same address block as CreateAlliance 19044) = most likely "Leave clan".
 * IDA shows no encode/decode between the previous message and its type function, so the body is probably empty.
 * It has NEVER appeared in a capture yet (pressing Leave sends nothing in Captures7/8), so this is a candidate:
 * if it ever arrives, the player is removed from the clan in MySQL and the arrival is logged. No live reply yet.
 */
class LeaveAllianceMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14308
    this.version = 0
  }

  async decode () {}

  async process () {
    const p = this.client && this.client.player
    this.client.log(`[clan] 14308 arrived (len=${this.buffer ? this.buffer.length : 0}) - treated as LEAVE`)
    if (!p || p.guest || !Database.pool) return
    try {
      const r = await Database.leaveAlliance(p.id)
      p.alliance = null
      this.client.log(`[clan] left clan ${r.id}${r.deleted ? ' (empty, clan deleted)' : ''} in MySQL; the game shows it after the next clan screen open`)
    } catch (e) { this.client.log('[clan] leave failed: ' + e.message) }
  }
}

module.exports = LeaveAllianceMessage
