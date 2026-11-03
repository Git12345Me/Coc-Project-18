const PiranhaMessage = require('../../PiranhaMessage')
const Database = require('../../../Database')
const Turn = require('../../Turn')

/**
 * 11206 = the leader edits the clan settings (seen in your Captures: "clan" + the settings of the create screen).
 * Layout read from the real 46-byte sample (same fields as 19044 without the name):
 *   string description | int32 (-1 in the sample, meaning unknown) | 8 x int32 [badge, type, requiredScore, requiredDuelScore, requiredTownhall,
 *   warFrequency, originData, originLanguage] | bit-packed bools (byte 03 = publicWarLog + amical) | VInt label count + int32 labels
 * Saved to MySQL: description and badge. The other values are printed only. No reply is sent (reply message unknown), so the game
 * shows the new text after the next login.
 */
const INTS = ['badge', 'type', 'requiredScore', 'requiredDuelScore', 'requiredTownhallLevel', 'warFrequency', 'originData', 'originLanguage']

class EditAllianceSettingsMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 11206
    this.version = 0
  }

  async decode () {
    const b = this.buffer; let pos = 0
    try {
      const n = b.readInt32BE(pos); pos += 4
      const d = { description: n > 0 ? b.toString('utf8', pos, pos + n) : '' }; pos += Math.max(n, 0)
      d.unknown = b.readInt32BE(pos); pos += 4
      for (const k of INTS) { d[k] = b.readInt32BE(pos); pos += 4 }
      const f = b.length > pos ? b[pos++] : 0
      d.publicWarLog = (f & 1) === 1; d.amicalWarEnabled = (f & 2) === 2
      d.labels = []
      if (b.length > pos) { const t = Turn.readVInt(b, pos); if (t) { pos = t.next; for (let i = 0; i < t.value && pos + 4 <= b.length; i++) { d.labels.push(b.readInt32BE(pos)); pos += 4 } } }
      d.rest = b.subarray(pos).toString('hex')
      this.data = d
    } catch (e) { this.data = null }
  }

  async process () {
    if (!this.data) return this.client.log('[clan] edit request could not be read')
    const d = this.data
    this.client.log(`[clan] edit settings: description="${d.description}" badge=${d.badge} type=${d.type} requiredScore=${d.requiredScore} requiredDuelScore=${d.requiredDuelScore} requiredTownhall=${d.requiredTownhallLevel} warFrequency=${d.warFrequency} origin=${d.originData}/${d.originLanguage} publicWarLog=${d.publicWarLog} amical=${d.amicalWarEnabled} labels=[${d.labels.join(',')}]${d.rest ? ' rest=' + d.rest : ''}`)
    const p = this.client.player
    if (!p || p.guest || !Database.pool) return this.client.log('[clan] edit not saved: no saved player on this connection')
    try {
      const r = await Database.updateAllianceSettings(p.id, { description: d.description, badge: d.badge })
      this.client.log(`[clan] clan ${r.id}: description and badge saved to MySQL (the game shows them after the next login; no live reply is known yet)`)
      await Database.loadAlliance(p)
    } catch (e) { this.client.log('[clan] edit not saved: ' + e.message) }
  }
}

module.exports = EditAllianceSettingsMessage
