const PiranhaMessage = require('../../PiranhaMessage')
const Database = require('../../../Database')

/**
 * 14466 = "Send Mail" in the clan screen. Sample (8 bytes): 00000002 6969 0000 = string "ii" + 2 bytes (meaning unknown, kept in `rest`).
 * The text is saved in MySQL (alliance_chat). Delivering it to the members' game needs the alliance-stream entry message
 * (25418 AvatarStream / the clan chat message), which is not built yet - so the game shows the cooldown but not the mail.
 */
class AllianceMailMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14466
    this.version = 0
  }

  async decode () {
    const b = this.buffer
    try {
      const n = b.readInt32BE(0)
      this.text = n > 0 ? b.toString('utf8', 4, 4 + n) : ''
      this.rest = b.subarray(4 + Math.max(n, 0)).toString('hex')
    } catch (e) { this.text = null }
  }

  async process () {
    if (this.text === null) return this.client.log('[clan] mail request could not be read')
    this.client.log(`[clan] mail: "${this.text}"${this.rest ? ' rest=' + this.rest : ''}`)
    const p = this.client.player
    if (!p || p.guest || !Database.pool) return
    try { const id = await Database.addAllianceMail(p.id, this.text); this.client.log(`[clan] mail saved in MySQL (clan ${id}); it is not shown in the game yet`) } catch (e) { this.client.log('[clan] mail not saved: ' + e.message) }
  }
}

module.exports = AllianceMailMessage
