const PiranhaMessage = require('../../PiranhaMessage')
const EnemyHomeDataMessage = require('../Server/EnemyHomeDataMessage')
const Experience = require('../../Experience')
const Turn = require('../../Turn')
const { applyTurn } = require('../../ApplyTurn')
const VillageCheck = require('../../VillageCheck')
const Database = require('../../../Database')
const config = require('../../../Config')
const BattleResult = require('../../BattleResult')

/**
 * 14309 = the client's "end of turn" message: tick, checksum, command count, commands.
 * With 0 commands it is a heartbeat sent about every 5 seconds; actions (move, upgrade, ...) arrive as commands.
 * See Protocol/Turn.js for what is decoded.
 *
 * Server.LogTurns   (default true)  print every turn that carries commands
 * Server.ApplyCommands (default false) apply the commands that are understood (so far: moving a building) to the village and
 *                   save it to MySQL. Switch on in the server window with:  apply on
 * Server.InstantUpgrades (default false) also store an upgrade as finished (the JSON has no 'upgrading' state)
 * Server.PlaceWithoutTemplate (default false) save a placed building even if no building of that type exists to copy fields from
 * Server.TurnReply  "search" (default) | "all" | "commands" | "none"
 *   search   EnemyHomeData (the attack screen) is sent ONLY when the turn carries command 8000 = the Attack button (v9: Search_Opponent).
 *            Nothing is sent for heartbeats, for home commands or for the battle turns (deploy ...), like v9 / a real server.
 *   all      the old behaviour: EnemyHomeData after EVERY turn. In the capture of 2026-10-30 this re-sent the attack screen again and
 *            again while the battle was running (every turn with a command picked a NEW opponent), and the game went home.
 *   commands after every turn that has any command | none = never
 */
class Unknown14309 extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14309
    this.version = 1
  }

  async decode () {
    this.turn = Turn.parse(this.buffer)
  }

  async process () {
    const turn = this.turn
    BattleResult.noteTurn(this.client, turn) // remembers deploy (7408) / end of battle (7662) turns for the result
    if (turn && turn.count > 0 && config.Server.LogTurns !== false) {
      const village = this.client.player ? this.client.player.village : null
      this.client.log('[turn] ' + Turn.summary(turn, village))
    }
    if (turn && turn.count > 0 && config.Server.ApplyCommands) await this.save(turn)
    if (Turn.hasSearch(turn)) await BattleResult.chargeSearch(this.client, turn) // the search fee, so coming home does not give it back
    const mode = config.Server.TurnReply || 'search'
    if (mode === 'none' || (mode === 'commands' && !(turn && turn.count > 0))) return
    if (mode === 'search') {
      if (!Turn.hasSearch(turn)) return
      return new EnemyHomeDataMessage(this.client, { search: true }).send()
    }
    // a turn with a command = "search": a new opponent; an empty heartbeat keeps the opponent that was already chosen (Protocol/BattleSession.js)
    await new EnemyHomeDataMessage(this.client, { search: !!(turn && turn.count > 0) }).send()
  }
}

Unknown14309.prototype.save = async function (turn) {
  const p = this.client.player
  if (!p || p.guest) return this.client.log('[save] no saved player on this connection (is the database on?)')
  if (p.villageSource !== 'current') return this.client.log(`[save] not saving: this session runs on the "${p.villageSource}" village, not your stored one`)
  // mission commands (8030): remember progress (claim=0) and completed missions (claim=1) separately
  const ms = turn.commands.map(c => Turn.decodeMission(c)).filter(Boolean)
  if (ms.length) {
    const av = p.avatar || {}
    const known = new Set(Array.isArray(av.missions) ? av.missions : [])
    const claimed = new Set(Array.isArray(av.missionsClaimed) ? av.missionsClaimed : [])
    const fresh = ms.filter(m => !known.has(m.id)).map(m => m.id)
    const freshClaim = ms.filter(m => (m.claim || config.Server.MissionsSeenAreDone === true) && !claimed.has(m.id)).map(m => m.id)
    if (fresh.length || freshClaim.length) {
      const seenDone = config.Server.MissionsSeenAreDone === true // every mission the game reports counts as done (stops repeating tutorials)
      ms.forEach(m => { known.add(m.id); if (m.claim || seenDone) claimed.add(m.id) })
      p.avatar = Object.assign({}, av, { missions: [...known].sort((a, b) => a - b), missionsClaimed: [...claimed].sort((a, b) => a - b) })
      try { await Database.saveNow(p); this.client.log(`[save] missions reported by the game: started/seen ${fresh.join(', ') || '-'}; completed ${freshClaim.join(', ') || '-'}`) } catch (e) { this.client.log('[save] MySQL error (kept in memory, autosave retries): ' + e.message) }
    }
  }
  // start-up state commands (5052 flag, 6340 int, 6154 VInt): the client repeats them after every login; the last values are kept in MySQL
  const st = turn.commands.map(c => Turn.decodeState(c)).filter(Boolean)
  if (st.length) {
    const cur = Object.assign({}, p.avatar && p.avatar.clientState)
    const changed = st.filter(x => cur[x.id] !== x.value)
    if (changed.length) {
      changed.forEach(x => { cur[x.id] = x.value })
      p.avatar = Object.assign({}, p.avatar, { clientState: cur })
      try { await Database.saveNow(p); this.client.log('[save] client state: ' + changed.map(x => x.id + '=' + x.value).join(' ')) } catch (e) { this.client.log('[save] MySQL error (kept in memory, autosave retries): ' + e.message) }
    }
  }
  // Work on a COPY: the live village is only replaced when the result passed the check, so a bad change can never
  // sit in memory and be written to MySQL by the next autosave.
  const draft = JSON.parse(JSON.stringify(p.village))
  const { changes, rejected, xp } = applyTurn(draft, turn, { upgrades: !!config.Server.InstantUpgrades, plain: !!config.Server.PlaceWithoutTemplate })
  rejected.forEach(r => this.client.log('[save] ignored: ' + r))
  if (!changes.length) return
  const { errors } = VillageCheck.check(draft)
  if (errors.length) return this.client.log('[save] NOT saved, the result has errors: ' + errors[0])
  p.village = draft
  if (xp > 0) { // experience for finished upgrades (v9 rule: sqrt of the build time), saved with the village
    const r = Experience.addXp(p.avatar, xp); p.avatar = r.avatar
    this.client.log(`[save] +${xp} XP -> level ${r.avatar.expLevel}, ${r.avatar.expPoints} XP${r.gained ? ' (' + r.gained + ' level up)' : ''}`)
  }
  try { await Database.saveNow(p); changes.forEach(c => this.client.log('[save] ' + c)) } catch (e) { this.client.log('[save] MySQL error (kept in memory, autosave retries): ' + e.message) }
}

module.exports = Unknown14309
