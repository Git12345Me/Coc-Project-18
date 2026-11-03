/**
 * Server commands for the attack screen: `army` (what YOU can attack with) and `bot` (opponents in MySQL).
 * Called from Commands/index.js. Both change MySQL only; the game shows the change at the next login / the next Attack press.
 */
const fs = require('fs')
const path = require('path')
const Database = require('../Database')
const LoginOk = require('../Protocol/LoginOkData')
const VillageCheck = require('../Protocol/VillageCheck')
const HomeData = require('../Protocol/HomeData')
const config = require('../Config')
const Army = require('../Protocol/Army')

// Data ids of the common troops / spells (ids never change between versions; names from the old client's characters.csv / spells.csv).
// Any other id works too: army set 4000051 3
const TROOPS = { barbarian: 4000000, archer: 4000001, goblin: 4000002, giant: 4000003, wallbreaker: 4000004, balloon: 4000005, wizard: 4000006, healer: 4000007, dragon: 4000008, pekka: 4000009, minion: 4000010, hogrider: 4000011, valkyrie: 4000012, golem: 4000013, witch: 4000015, lavahound: 4000017, bowler: 4000022, babydragon: 4000023, miner: 4000024, electrodragon: 4000051 }
const SPELLS = { lightning: 26000000, healing: 26000001, rage: 26000002, jump: 26000003, freeze: 26000005, poison: 26000009, earthquake: 26000010, haste: 26000011 }
const HEROES = { barbarianking: 28000000, king: 28000000, bk: 28000000, archerqueen: 28000001, queen: 28000001, aq: 28000001, grandwarden: 28000002, warden: 28000002, gw: 28000002, royalchampion: 28000004, champion: 28000004, rc: 28000004 }
const nameOf = (table, id) => (Object.entries(table).find(([, v]) => v === Number(id)) || ['id ' + id])[0]
const toId = (table, t) => { const k = String(t || '').toLowerCase().replace(/[^a-z]/g, ''); if (table[k]) return table[k]; return /^\d{7,8}$/.test(String(t)) ? Number(t) : null }
const isId = (t) => /^\d{4,}$/.test(t || '')

const CAPTURED = { units: { 4000000: 20 }, spells: {} } // what the login packet had before (hardcoded in the capture)

function defaultId () {
  if (Database.singlePlayer()) return LoginOk.DEFAULT_LOW
  throw new Error('give the player id (see: players)')
}

const parseAvatar = (row) => { try { const o = JSON.parse(row.avatar || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch (e) { return {} } }

function describeArmy (army) {
  const lines = []
  const u = Object.entries(army.units || {}); const s = Object.entries(army.spells || {})
  lines.push('  troops: ' + (u.length ? u.map(([k, v]) => `${nameOf(TROOPS, k)} x${v}`).join(', ') : '(none)'))
  lines.push('  spells: ' + (s.length ? s.map(([k, v]) => `${nameOf(SPELLS, k)} x${v}`).join(', ') : '(none)'))
  const L = army.levels || {}; const lv = (o, t) => Object.entries(o || {}).map(([k, v]) => `${nameOf(t, k)} lvl ${v}`).join(', ')
  if (L.units && Object.keys(L.units).length) lines.push('  troop levels: ' + lv(L.units, TROOPS))
  if (L.spells && Object.keys(L.spells).length) lines.push('  spell levels: ' + lv(L.spells, SPELLS))
  if (L.heroes && Object.keys(L.heroes).length) lines.push('  hero levels: ' + lv(L.heroes, HEROES))
  return lines
}

async function army (parts) {
  const action = (parts[0] || 'show').toLowerCase()
  let rest = parts.slice(1); let id
  // [id] is optional: it is read only when there is one more argument than the command needs (data ids look like ids too)
  const needs = { show: 0, clear: 0, set: 2, spell: 2, remove: 1, level: 2 }[action]
  if (needs !== undefined && rest.length > needs && isId(rest[0])) { id = Number(rest[0]); rest = rest.slice(1) } else id = defaultId()
  const row = await Database.getRow(id)
  if (!row) return [`player ${id} does not exist yet: log in once with the game first`]
  const av = parseAvatar(row)
  const stored = av.army && typeof av.army === 'object' ? av.army : null
  let village = null; try { village = JSON.parse(row.village) } catch (e) { /* army from config only */ }
  const dflt = Army.effective({ village, avatar: {} }) // what this player gets without an own army (automatic from his village)
  const effective = Army.effective({ village, avatar: av }) || CAPTURED
  const where = stored ? 'stored for this player (players.avatar.army)' : dflt ? 'automatic from his village (camp + spell forge capacity), Battle.DefaultArmy in config.json' : 'the captured army (20 barbarians)'
  if (action === 'show') return [`army of player ${id} "${row.name}": ${where}`, ...describeArmy(effective), 'The login packet and the attack screen both use it.']
  if (action === 'clear') { await Database.setAvatarField(id, 'army', null); return [`own army removed: ${dflt ? 'the automatic army of the village' : 'the captured 20 barbarians'} is used again.`] }
  if (!['set', 'spell', 'remove', 'level'].includes(action)) return ['usage: army show [id] | army set [id] <troop> <count> | army spell [id] <spell> <count> | army level [id] <troop|spell|hero|all> <level> | army remove [id] <troop|spell> | army clear [id]', 'troops: ' + Object.keys(TROOPS).join(' ') + '   spells: ' + Object.keys(SPELLS).join(' ') + '   (or a data id)']
  const el = effective.levels || {}
  const next = { units: { ...(effective.units || {}) }, spells: { ...(effective.spells || {}) }, levels: { units: { ...(el.units || {}) }, spells: { ...(el.spells || {}) }, heroes: { ...(el.heroes || {}) } } }
  if (action === 'level') {
    const key = String(rest[0] || ''); const n = Number(rest[1])
    if (!Number.isInteger(n) || n < 1 || n > 200) return ['usage: army level [id] <troop|spell|hero|all> <level 1-200>   e.g. army level dragon 11   army level all 9   army level king 60']
    const k = key.toLowerCase().replace(/[^a-z]/g, '')
    if (k === 'all') { for (const t of Object.keys(next.units)) next.levels.units[t] = n; for (const t of Object.keys(next.spells)) next.levels.spells[t] = n } else if (HEROES[k]) next.levels.heroes[HEROES[k]] = n
    else if (toId(TROOPS, key)) next.levels.units[toId(TROOPS, key)] = n
    else if (toId(SPELLS, key)) next.levels.spells[toId(SPELLS, key)] = n
    else return [`unknown name "${key}". Names: all, heroes (${Object.keys(HEROES).join(' ')}), ${Object.keys(TROOPS).join(' ')}, ${Object.keys(SPELLS).join(' ')}`]
  } else if (action === 'remove') {
    const key = String(rest[0] || ''); const tid = toId(TROOPS, key); const sid = toId(SPELLS, key)
    if (tid && next.units[tid] !== undefined) delete next.units[tid]
    else if (sid && next.spells[sid] !== undefined) delete next.spells[sid]
    else return [`"${key}" is not in the army. army show lists it.`]
  } else {
    const table = action === 'set' ? TROOPS : SPELLS
    const did = toId(table, rest[0]); const n = Number(rest[1])
    if (!did) return [`unknown ${action === 'set' ? 'troop' : 'spell'} "${rest[0]}". Names: ${Object.keys(table).join(' ')} (or a data id)`]
    if (!Number.isInteger(n) || n < 0 || n > 100000) return [`usage: army ${action} [id] <name|dataId> <count 0-100000>`]
    const bucket = action === 'set' ? next.units : next.spells
    if (n === 0) delete bucket[did]; else bucket[did] = n
  }
  const B = config.Battle || {} // a troop / spell that has no level yet gets the default level, not level 1
  for (const t of Object.keys(next.units)) if (!next.levels.units[t]) next.levels.units[t] = Number(B.TroopLevel) || 1
  for (const t of Object.keys(next.spells)) if (!next.levels.spells[t]) next.levels.spells[t] = Number(B.SpellLevel) || 1
  await Database.setAvatarField(id, 'army', next)
  return [`army of player ${id} saved:`, ...describeArmy(next), 'Close the game and open it again (login packet); the next Attack press uses it too.', 'Levels above what the client knows for a troop can crash the attack screen: if it does, lower them (army level <troop> <n>) or run: army clear.']
}

async function bot (parts) {
  if (!Database.pool) return ['Database is disabled. Set "Database.Enabled": true in config.json and start MySQL.']
  const action = (parts[0] || 'list').toLowerCase()
  if (action === 'list') {
    const rows = await Database.listBots()
    return rows.length ? ['opponents created with "bot add" (real players are listed by: players):', ...rows.map(r => `  ${r.id}  ${r.name}  ${r.trophies} trophies`)] : ['no bots yet. Create one:  bot add <name> [village file]   (default village: the standard one)']
  }
  if (action === 'remove') {
    const id = Number(parts[1])
    if (!Number.isInteger(id)) return ['usage: bot remove <id>   (ids: bot list; only bots can be removed this way)']
    return [(await Database.removeBot(id)) ? `bot ${id} removed.` : `${id} is not a bot (or does not exist). Real players are never deleted by this command.`]
  }
  if (action === 'add') {
    const args = parts.slice(1)
    if (!args.length) return ['usage: bot add <name> [village file]   e.g.  bot add Dummy Data/Home/village_th18_levels.json   (name: no spaces, 1-32 characters)']
    let file = null
    if (args.length > 1 && /\.json$/i.test(args[args.length - 1])) file = args.pop()
    const name = args.join(' ').trim()
    if (!name || name.length > 32 || /[\u0000-\u001f]/.test(name)) return ['the name must be 1-32 characters']
    let village = HomeData.DEFAULT_VILLAGE(); let source = 'default village'
    if (file) {
      const f = path.isAbsolute(file) ? file : path.join(__dirname, '..', file)
      if (!fs.existsSync(f)) return [`file not found: ${f}`]
      try { village = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return ['that file is not valid JSON: ' + e.message] }
      source = file
    }
    const { errors } = VillageCheck.check(village)
    if (errors.length) return ['not created, the village has errors:', ...errors.slice(0, 5)]
    const id = await Database.createBot({ name, village })
    return [`bot ${id} "${name}" created (${source}). It can now be chosen as your opponent when you press Attack.`, 'Set its trophies with:  trophies ' + id + ' <n>   (Battle.TrophyRange in config.json can match opponents by trophies)']
  }
  return ['usage: bot list | bot add <name> [village file] | bot remove <id>']
}

/** @returns {Promise<string[]>} */
async function run (cmd, parts) {
  if (!Database.pool) return ['Database is disabled. Set "Database.Enabled": true in config.json and start MySQL.']
  return cmd === 'army' ? army(parts) : bot(parts)
}

module.exports = { run, TROOPS, SPELLS }
