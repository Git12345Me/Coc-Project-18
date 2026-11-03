/**
 * BattleResult.js - what an attack changes, so it is SAVED and you move forward instead of everything starting again.
 *
 * What the capture of 2026-10-30 (Captures/all.log) shows about the end of an attack:
 *   1. Attack pressed                  turn with command 8000
 *   2. troops deployed                 turns with command 7408 (one per troop)
 *   3. the battle ends                 turn with command 7662 (body: only the tick)
 *   4. the game asks for home          message 10936 (GoHome)  -> the server answers with OwnHomeData
 * The game sends NO loot, stars or destruction at the end: the battle is calculated on the client. v9 has the same limit: its Go_Home
 * decides win or lose by itself (random) and only then changes the trophies. So this module does the same, in a way you can set
 * (config.json -> Battle):
 *   Result       "win" (default) | "lose" | "random"          what the server books for an attack that was fought
 *   LootPercent  share (0-100) of the loot that the attack screen offered (the enemy's stored gold / elixir / dark elixir)
 * The numbers are NOT the ones the game showed during the fight (the game does not tell the server). Real loot would need the
 * server to replay the battle (deploy commands + buildings) - not available.
 * Booked: your resources, trophies, attacks won; the enemy's resources, trophies, defenses won (never for "bot add" opponents).
 * Troops: the deploy commands (7408) are decoded, so the log shows which units were placed. They are used up only with Battle.ConsumeArmy = true
 * (default false: there is no training yet, the army is rebuilt at every login = free army).
 */
const config = require('../Config')
const AvatarBlock = require('./AvatarBlock')
const BattleData = require('./BattleData')
const Army = require('./Army')
const Database = require('../Database')

const DEPLOY = 7408; const END_BATTLE = 7662
const LOOT_IDS = [3000001, 3000002, 3000003] // gold, elixir, dark elixir
const cfg = () => config.Battle || {}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Remembers what the battle turns of this connection contained. Called for every turn. */
function noteTurn (client, turn) {
  const b = client && client.battle
  if (!b || !turn) return
  const Turn = require('./Turn')
  for (const c of turn.commands) {
    if (c.id === DEPLOY) {
      b.deployed = (b.deployed || 0) + 1
      const d = Turn.decodeDeploy(c) // which unit was placed (4000000+ troop, 26000000+ spell, 28000000+ hero); Clan Castle units are not yours
      if (d && !d.fromCastle) { b.units = b.units || {}; b.units[d.unit] = (b.units[d.unit] || 0) + 1 }
    } else if (c.id === END_BATTLE) b.ended = true
  }
}

/** Trophies for a win / a loss (approximation of the real table: 30 / 20 at equal trophies, more when the enemy is stronger). */
function trophyChange (mine, theirs) {
  const diff = (theirs | 0) - (mine | 0)
  return { win: clamp(Math.round(30 + diff / 20), 1, 59), lose: clamp(Math.round(20 - diff / 20), 1, 59) }
}

const isBot = (p) => !!p && typeof p.token === 'string' && p.token.startsWith('bot')
const total = (n) => clamp(Math.floor(Number(n) || 0), 0, 2147483647)

/**
 * Books the result of the fought attack of this connection. Returns a summary or null when nothing was fought
 * (attack screen opened but no troop deployed, or already booked).
 */
async function settle (client) {
  const b = client && client.battle
  const me = client && client.player
  if (!b || b.settled || !me || me.guest || !b.deployed) return null
  b.settled = true
  const mode = String(cfg().Result || 'win').toLowerCase()
  const win = mode === 'win' || (mode === 'random' && Math.random() < 0.5)
  const enemy = b.enemy || null
  const pct = clamp(Number(cfg().LootPercent === undefined ? 30 : cfg().LootPercent) || 0, 0, 100)

  // ---- loot: a share of what the attack screen offered
  const offered = BattleData.availableLoot(enemy)
  const have = Object.assign({}, AvatarBlock.readResources(Buffer.from(require('../Data/Home/segments.json').postName, 'hex')), (me.avatar || {}).resources)
  const gain = {}
  if (win) for (const id of LOOT_IDS) { const n = total((offered[id] || 0) * pct / 100); if (n > 0) gain[id] = n }
  const resources = Object.assign({}, (me.avatar || {}).resources)
  for (const [id, n] of Object.entries(gain)) resources[id] = Math.min(2147483647, total(have[id]) + n)

  // ---- trophies
  const t = trophyChange(me.trophies, enemy ? enemy.trophies : me.trophies)
  const before = me.trophies | 0
  me.trophies = win ? before + t.win : Math.max(0, before - t.lose)
  me.avatar = Object.assign({}, me.avatar, { resources, attacksWon: (win ? 1 : 0) + ((me.avatar && me.avatar.attacksWon) || 0) })
  if (!Object.keys(resources).length) delete me.avatar.resources
  // ---- optional: the troops and spells that were placed are used up (Battle.ConsumeArmy, default false = free army that is rebuilt at every login)
  const used = b.units || {}
  if (cfg().ConsumeArmy === true && Object.keys(used).length) {
    const army = Army.effective(me) || { units: {}, spells: {}, levels: {} }
    const units = Object.assign({}, army.units); const spells = Object.assign({}, army.spells)
    for (const [id, n] of Object.entries(used)) { const bucket = Number(id) >= 26000000 && Number(id) < 27000000 ? spells : units; if (bucket[id]) bucket[id] = Math.max(0, bucket[id] - n); if (!bucket[id]) delete bucket[id] }
    me.avatar = Object.assign({}, me.avatar, { army: { units, spells, levels: army.levels || {} } })
  }
  const summary = { win, mode, used, trophies: me.trophies - before, loot: gain, enemy: enemy ? enemy.name : '(practice base)' }

  // ---- the enemy (a real player, never a bot)
  if (enemy && !isBot(enemy) && enemy.id !== me.id) {
    try {
      await Database.applyToPlayer(enemy.id, (p) => {
        p.trophies = win ? Math.max(0, (p.trophies | 0) - t.win) : (p.trophies | 0) + t.lose
        const r = Object.assign({}, (p.avatar || {}).resources)
        for (const [id, n] of Object.entries(gain)) if (r[id] !== undefined) r[id] = Math.max(0, total(r[id]) - n)
        p.avatar = Object.assign({}, p.avatar, { resources: Object.keys(r).length ? r : undefined, defensesWon: (win ? 0 : 1) + ((p.avatar && p.avatar.defensesWon) || 0) })
        if (p.avatar.resources === undefined) delete p.avatar.resources
      })
    } catch (e) { client.log('[battle] could not update the enemy "' + enemy.name + '": ' + e.message) }
  }
  try { await Database.saveNow(me) } catch (e) { client.log('[battle] MySQL error (kept in memory, autosave retries): ' + e.message) }
  client.log(`[battle] booked: ${win ? 'WIN' : 'LOSS'} (Battle.Result "${mode}") vs ${summary.enemy}, trophies ${summary.trophies >= 0 ? '+' : ''}${summary.trophies}, used ${Object.keys(used).length ? Object.entries(used).map(([k, v]) => k + 'x' + v).join(' ') : 'nothing'}, loot ${Object.keys(gain).length ? Object.entries(gain).map(([k, v]) => k + '=' + v).join(' ') : 'none'}`)
  client.battle = null
  return summary
}

/**
 * The search fee of command 8000: `cost` of resource `resource` (normally gold). The game already took it on the client; the server must take
 * it too, otherwise coming home gives it back (the login packet shows the SERVER's number). Clamped at 0, saved to MySQL.
 * Returns what was taken ({ id, cost }) or null.
 */
async function chargeSearch (client, turn) {
  const me = client && client.player
  if (!me || me.guest || cfg().ChargeSearch === false || !turn) return null
  const Turn = require('./Turn')
  let taken = null
  for (const c of turn.commands) {
    const d = Turn.decodeSearch(c)
    if (!d || !(d.resource >= 3000000 && d.resource < 3000100) || !(d.cost > 0)) continue
    const have = Object.assign({}, AvatarBlock.readResources(Buffer.from(require('../Data/Home/segments.json').postName, 'hex')), (me.avatar || {}).resources)
    const left = Math.max(0, total(have[d.resource]) - Math.min(d.cost, 2147483647))
    me.avatar = Object.assign({}, me.avatar, { resources: Object.assign({}, (me.avatar || {}).resources, { [d.resource]: left }) })
    taken = { id: d.resource, cost: d.cost }
    client.log(`[battle] search fee: ${d.cost} of resource ${d.resource} taken, ${left} left`)
  }
  if (taken) { try { await Database.saveNow(me) } catch (e) { client.log('[battle] MySQL error (kept in memory, autosave retries): ' + e.message) } }
  return taken
}

module.exports = { chargeSearch, noteTurn, settle, trophyChange, DEPLOY, END_BATTLE }
