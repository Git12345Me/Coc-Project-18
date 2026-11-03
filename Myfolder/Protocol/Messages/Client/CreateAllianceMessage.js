const PiranhaMessage = require('../../PiranhaMessage')
const Database = require('../../../Database')
const config = require('../../../Config')
const Turn = require('../../Turn')

/**
 * 19044 = the client asks to create a clan (confirmed with your ZZTEST capture).
 *
 * Layout (field names from your v14 C# CreateAllianceMessage, checked against two real 18.0.5 captures):
 *   string name | string description | int badge | int type | int requiredScore | int requiredDuelScore |
 *   int requiredTownhallLevel | int warFrequency | int originData | int originLanguage | bool publicWarLog | bool amicalWarEnabled
 *   Strings are int32 length + utf8.
 *   badge and type are confirmed (you changed exactly those: badge 0 -> 1526727247, type 1 open -> 2 invite only).
 *   The other six ints were 0 in both captures, so their order is taken from v14 and NOT verified.
 *   v14 then sends a label count (1 byte) + int labels. The 18.0.5 captures end after the two bools (2 bytes), so that part
 *   differs or the count is left out when there are no labels. If bytes remain, they are kept in `rest`.
 *
 * Only decoded and printed for now. No reply is sent, so the game behaves as before (the clan is not created).
 * In v14 the reply to a create is NOT its own message: it is a server command message carrying "join alliance" and
 * "change alliance role" commands. Those command encodings are not available yet.
 */
const TYPES = { 1: 'open', 2: 'invite only', 3: 'closed?' }
const INTS = ['badge', 'type', 'requiredScore', 'requiredDuelScore', 'requiredTownhallLevel', 'warFrequency', 'originData', 'originLanguage']

class CreateAllianceMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 19044
    this.version = 0
  }

  async decode () {
    const b = this.buffer; let pos = 0
    const str = () => { const n = b.readInt32BE(pos); pos += 4; const s = n > 0 ? b.toString('utf8', pos, pos + n) : ''; pos += Math.max(n, 0); return s }
    try {
      const d = { name: str(), description: str() }
      for (const k of INTS) { d[k] = b.readInt32BE(pos); pos += 4 }
      // IDA C63B14 (decode of 19044): string, string, int32 badge, 5 x int32, 2 x int32 data ref (origin, language), 3 x bool, VInt label count, label data ids (table 55)
      d.publicWarLog = b.length > pos ? b[pos++] === 1 : false
      d.amicalWarEnabled = b.length > pos ? b[pos++] === 1 : false
      d.thirdFlag = b.length > pos ? b[pos++] === 1 : false
      d.labels = []
      if (b.length > pos) {
        const t = Turn.readVInt(b, pos)
        if (t) { pos = t.next; for (let i = 0; i < t.value && pos + 4 <= b.length; i++) { d.labels.push(b.readInt32BE(pos)); pos += 4 } }
      }
      d.typeName = TYPES[d.type] || 'unknown'
      d.rest = b.subarray(pos).toString('hex')
      this.data = d
    } catch (e) { this.data = null }
  }

  async process () {
    if (!this.data) return this.client.log('[clan] create request could not be read')
    const d = this.data
    this.client.log(`[clan] create request: name="${d.name}" description="${d.description}" badge=${d.badge} type=${d.type} (${d.typeName}) ` +
      `requiredScore=${d.requiredScore} requiredDuelScore=${d.requiredDuelScore} requiredTownhall=${d.requiredTownhallLevel} warFrequency=${d.warFrequency} ` +
      `origin=${d.originData}/${d.originLanguage} publicWarLog=${d.publicWarLog} amical=${d.amicalWarEnabled} third=${d.thirdFlag} labels=[${(d.labels || []).join(',')}]${d.rest ? ' rest=' + d.rest : ''}`)
    await this.create(d)
  }

  /**
   * The clan is created in MySQL (alliances + alliance_members, you = leader) and put on the player, so it shows in the login data of the NEXT login.
   * The live reply ("you joined / you are the leader" server commands) is not known for 18.0.5 yet, so the game itself still shows nothing:
   * close the game and open it again. Switch off with Server.ClanCreateOnRequest = false.
   */
  async create (d) {
    const p = this.client.player
    if (config.Server.ClanCreateOnRequest === false) return
    if (!p || p.guest || !Database.pool) return this.client.log('[clan] not created: no saved player on this connection (is the database on?)')
    const name = String(d.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32)
    if (!name) return this.client.log('[clan] not created: the clan name is empty')
    const cost = Number.isInteger(config.Server.ClanCreateCost) ? config.Server.ClanCreateCost : 40000 // the 40000 gold of the create button
    const av = p.avatar || {}; const gold = Number(av.resources && av.resources[3000001])
    if (cost > 0 && Number.isFinite(gold) && gold < cost) return this.client.log(`[clan] not created: you have ${gold} gold, the clan costs ${cost}`)
    try {
      const c = await Database.createAlliance(p.id, { name, badge: Number.isInteger(d.badge) ? d.badge : 0, description: String(d.description || '').slice(0, 256) })
      await Database.loadAlliance(p)
      if (cost > 0 && Number.isFinite(gold)) { p.avatar = Object.assign({}, av, { resources: Object.assign({}, av.resources, { 3000001: gold - cost }) }); await Database.saveNow(p); this.client.log(`[clan] ${cost} gold paid: ${gold} -> ${gold - cost}`) }
      this.client.log(`[clan] CREATED in MySQL: clan ${c.id} "${c.name}", you are the leader. The game shows it after you close it and log in again (the live reply message is not decoded yet).`)
    } catch (e) { this.client.log('[clan] could not create the clan: ' + e.message) }
  }
}

module.exports = CreateAllianceMessage
