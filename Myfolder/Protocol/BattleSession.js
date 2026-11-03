/**
 * BattleSession.js - which village the attack screen shows (v9: Search_Opponent + Pc_Battle_Data).
 *
 * The 18.0.5 client has no separate "search opponent" message that this server has decoded; it sends its end-of-turn message
 * (14309) and the server answers with EnemyHomeData. So the rules are:
 *   - a turn that carries a COMMAND (Attack, Next ...) = "search": a NEW opponent is chosen from MySQL;
 *   - an empty heartbeat turn re-sends the opponent already chosen (up to Battle.HoldSeconds), so the village does not change every 5 s.
 * The opponent is another player of the `players` table (never yourself, never one of your last Battle.RecentEnemies opponents).
 * With nobody else in MySQL the built-in practice base is used (Battle.FallbackBot), exactly the old behaviour.
 * Add opponents with the server command:  bot add <name> [village file]
 */
const Database = require('../Database')
const config = require('../Config')
const BattleData = require('./BattleData')
const Capture = require('../Capture')

const cfg = () => config.Battle || {}

function townHall (village) {
  const b = ((village && village.buildings) || []).find(x => x.data === 1000001)
  return b ? b.lvl + 1 : '?'
}

/**
 * The opponent for this connection: { enemy: object|null, at: ms, fresh: bool }.
 * @param {object} client
 * @param {boolean} search  true = pick a new opponent now (a turn with a command), false = keep the current one if it is not too old
 */
async function opponent (client, search) {
  const now = Date.now()
  const hold = Math.max(0, Number(cfg().HoldSeconds) || 0) * 1000
  const cur = client.battle
  if (!search && cur && now - cur.at < hold) return { ...cur, fresh: false }
  const me = client.player
  let enemy = null
  if (me && !me.guest && Database.pool) {
    if (!Array.isArray(me.recentEnemies)) me.recentEnemies = []
    try { enemy = await Database.findOpponent(me, me.recentEnemies, { trophyRange: cfg().TrophyRange, keep: cfg().RecentEnemies }) } catch (e) { client.log('[battle] could not search an opponent in MySQL: ' + e.message) }
  }
  client.battle = { enemy, at: now }
  if (config.Server.CaptureAllPackets) Capture.mark(`server: attack screen sent, opponent ${enemy ? '"' + enemy.name + '" (id ' + enemy.id + ')' : 'practice base'}`) // boundary for reading Captures/all.log
  if (enemy) client.log(`[battle] opponent: "${enemy.name}" (id ${enemy.id}), ${enemy.trophies} trophies, Town Hall ${townHall(enemy.village)}${enemy.alliance ? ', clan "' + enemy.alliance.name + '"' : ''}`)
  else client.log('[battle] no other player in MySQL' + (cfg().FallbackBot !== false ? ': using the built-in practice base. Add real opponents with the server command  bot add <name> [village file]' : ' and Battle.FallbackBot is off: nothing is sent'))
  return { ...client.battle, fresh: true }
}

/**
 * The EnemyHomeData payload for this connection, or null when there is nothing to attack (no opponent and no fallback).
 * @returns {Promise<Buffer|null>}
 */
async function payload (client, search) {
  const o = await opponent(client, search)
  if (!o.enemy && cfg().FallbackBot === false) return null
  return BattleData.build({ attacker: client.player || undefined, enemy: o.enemy || undefined })
}

module.exports = { opponent, payload, townHall }
