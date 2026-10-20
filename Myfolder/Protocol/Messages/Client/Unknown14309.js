const PiranhaMessage = require('../../PiranhaMessage')
const EnemyHomeDataMessage = require('../Server/EnemyHomeDataMessage')
const Turn = require('../../Turn')
const { applyTurn } = require('../../ApplyTurn')
const VillageCheck = require('../../VillageCheck')
const Database = require('../../../Database')
const config = require('../../../Config')

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
 * Server.TurnReply  "all" (default, the original behaviour: EnemyHomeData after EVERY turn) | "commands" (only after a turn
 *                   with commands) | "none". Change it only after testing the Attack button.
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
    if (turn && turn.count > 0 && config.Server.LogTurns !== false) {
      const village = this.client.player ? this.client.player.village : null
      this.client.log('[turn] ' + Turn.summary(turn, village))
    }
    if (turn && turn.count > 0 && config.Server.ApplyCommands) await this.save(turn)
    const mode = config.Server.TurnReply || 'all'
    if (mode === 'none' || (mode === 'commands' && !(turn && turn.count > 0))) return
    await new EnemyHomeDataMessage(this.client).send()
  }
}

Unknown14309.prototype.save = async function (turn) {
  const p = this.client.player
  if (!p || p.guest) return this.client.log('[save] no saved player on this connection (is the database on?)')
  if (p.villageSource !== 'current') return this.client.log(`[save] not saving: this session runs on the "${p.villageSource}" village, not your stored one`)
  const { changes, rejected } = applyTurn(p.village, turn, { upgrades: !!config.Server.InstantUpgrades, plain: !!config.Server.PlaceWithoutTemplate }) // mutates p.village
  rejected.forEach(r => this.client.log('[save] ignored: ' + r))
  if (!changes.length) return
  const { errors } = VillageCheck.check(p.village)
  if (errors.length) return this.client.log('[save] NOT saved, the result has errors: ' + errors[0])
  try { await Database.setVillage(p.id, p.village); changes.forEach(c => this.client.log('[save] ' + c)) } catch (e) { this.client.log('[save] MySQL error: ' + e.message) }
}

module.exports = Unknown14309
