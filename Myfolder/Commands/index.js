/**
 * Server commands: type them in the server window (the black console that runs `node .`).
 * They change the MySQL save. The game reads it when it logs in, so after a command:
 * close the game and open it again (or reconnect).
 *
 * The same run(line) function can later be called from clan chat (/command) once the chat packets are decoded.
 */
const Database = require('../Database')
const HomeData = require('../Protocol/HomeData')
const LoginOk = require('../Protocol/LoginOkData')
const Skins = require('../Protocol/Skins')
const VillageCheck = require('../Protocol/VillageCheck')
const Leagues = require('../Protocol/Leagues')
const Capture = require('../Capture')
const { addObstacles, trees, yearOf } = require('../Protocol/VillageEdit')

const HELP = [
  'Commands (changes show up the next time the game logs in):',
  '  help                              this list',
  '  apply on | off | status           save moves and placed buildings to MySQL',
  '  apply upgrades on | off           also save upgrades (stored as already finished: there is no timer in the village JSON)',
  '  apply unsafe on | off             save placed buildings even without a template (can crash the client: Hero Hall, Spell Forge)',
  '  mark <text>                       write a marker into Captures/all.log, e.g. mark about to move a cannon',
  '  players                           list saved players (id, name, skins)',
  '  name [id] <new name>              change the player name',
  '  skin find <text>                  search skins.csv by name or hero, e.g. skin find king',
  '  skin list [id]                    skins stored for the player',
  '  skin give [id] <skinId> [equip]   store a skin (only ids that exist in skins.csv)',
  '  skin remove [id] <skinId>',
  '  skin equip [id] <skinId>',
  '  trees [clashmas|id,id,...]        add the Clashmas trees 2012-2025 (or specific obstacle ids)',
  '  trophies [id] <number>            set trophies; shows the old league and the new-system start tier',
  '  league show [id]                  trophies + league of the player',
  '  league tier [id] <0-34>           set the new-system tier directly (league tiers list: league tiers)',
  '  league old | league tiers         print the league lists from your CSVs',
  '  village check [id]                check the stored village for mistakes',
  '  village restore [id]              go back to the last village that worked',
  '  village reset [id]                original default village',
  'Trophies and league are stored in MySQL but not yet sent to the game.',
  '[id] can be left out in single-player mode (default player ' + LoginOk.DEFAULT_LOW + ').',
  'Note: skins are stored in MySQL but not yet sent to the game.'
]

const KNOWN = new Set(['help', '?', 'mark', 'players', 'name', 'skin', 'trees', 'village', 'trophies', 'league', 'apply'])
const isId = (t) => /^\d{4,}$/.test(t || '')

/** Runs one command line, returns the lines to print. Never throws. */
async function run (line) {
  const parts = String(line || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return []
  if (parts[0].startsWith('/')) parts[0] = parts[0].slice(1)
  let cmd = parts.shift().toLowerCase()
  if (['marked', 'marks', 'note', 'label', 'mark:'].includes(cmd)) cmd = 'mark' // common slips
  if (!KNOWN.has(cmd)) {
    return [`"${cmd}" is not a command. To write a label into the packet log, start the line with the word  mark , for example:`, '  mark upgraded the cannon', 'Type  help  for all commands.']
  }
  try {
    if (cmd === 'help' || cmd === '?') return HELP
    if (cmd === 'apply') {
      const config = require('../Config'); const S = config.Server
      const flag = ['upgrades', 'unsafe'].includes((parts[0] || '').toLowerCase()) ? parts.shift().toLowerCase() : 'main'
      const key = { main: 'ApplyCommands', upgrades: 'InstantUpgrades', unsafe: 'PlaceWithoutTemplate' }[flag]
      const a = (parts[0] || 'status').toLowerCase()
      if (a === 'on') S[key] = true
      else if (a === 'off') S[key] = false
      else if (a !== 'status') return ['usage: apply on|off|status    apply upgrades on|off    apply unsafe on|off']
      const st = (v) => (v ? 'ON' : 'OFF')
      return [`apply (moves + placing buildings): ${st(S.ApplyCommands)}`, `apply upgrades (an upgrade is stored as finished): ${st(S.InstantUpgrades)}`, `apply unsafe (save placed buildings that have no template): ${st(S.PlaceWithoutTemplate)}`, 'These switches last until the server restarts; for good set them under "Server" in config.json. They need the database on.']
    }
    if (cmd === 'mark') { const text = parts.join(' ').trim(); if (!text) return ['usage: mark <what you are about to do in the game>']; Capture.mark(text); return ['marked in Captures/all.log: ' + text] }
    if (cmd === 'skin' && parts[0] === 'find') {
      const q = parts.slice(1).join(' ').toLowerCase()
      if (!q) return ['usage: skin find <text>']
      const hits = Skins.all().filter(s => `${s.name} ${s.hero}`.toLowerCase().includes(q))
      return hits.length ? [...hits.slice(0, 20).map(s => `${s.id}  ${s.name}  (${s.hero})${s.isDefault ? '  [default]' : ''}`), ...(hits.length > 20 ? [`... ${hits.length - 20} more, be more specific`] : [])] : ['no skin matches "' + q + '"']
    }
    if (cmd === 'league' && parts[0] === 'old') return Leagues.oldLeagues.map(l => `${l.idx}  ${l.name}  ${l.low}-${l.high > 100000 ? 'up' : l.high} trophies`)
    if (cmd === 'league' && parts[0] === 'tiers') return Leagues.tiers.map(t => `${t.idx}  ${t.name}  (division ${t.division})${t.trophyFloor ? '  floor ' + t.trophyFloor : ''}`)
    if (!Database.pool) return ['Database is disabled. Set "Database.Enabled": true in config.json and start MySQL.']
    // The player id is optional. Numbers are ambiguous (skin ids, obstacle ids, even names), so each command
    // only reads an id where an id can really be: when there are more arguments than the command itself needs.
    const defaultId = () => { if (Database.singlePlayer()) return LoginOk.DEFAULT_LOW; throw new Error('give the player id (see: players)') }
    let id; let args = parts
    if (cmd === 'players') { const rows = await Database.listPlayers(); return rows.length ? rows.map(r => `${r.id}  ${r.name}  skins: ${r.skins}`) : ['no players yet: log in once'] }
    if (cmd === 'name') { if (parts.length >= 2 && isId(parts[0])) { id = Number(parts[0]); args = parts.slice(1) } else id = defaultId() }
    else if (cmd === 'trophies') { if (parts.length >= 2 && isId(parts[0])) { id = Number(parts[0]); args = parts.slice(1) } else id = defaultId() }
    else if (cmd === 'league') {
      const rest = parts.slice(1)
      if (parts[0] === 'show') id = isId(rest[0]) ? Number(rest[0]) : defaultId()
      else if (parts[0] === 'tier') { if (rest.length >= 2 && isId(rest[0])) { id = Number(rest[0]); args = ['tier', ...rest.slice(1)] } else id = defaultId() }
      else return ['usage: league show [id] | league tier [id] <0-34> | league old | league tiers']
    }
    else if (cmd === 'trees') { if (parts.length >= 2 && isId(parts[0])) { id = Number(parts[0]); args = parts.slice(1) } else id = defaultId() }
    else if (cmd === 'skin') {
      const action = parts[0]; const rest = parts.slice(1)
      if (action === 'list') id = isId(rest[0]) ? Number(rest[0]) : defaultId()
      else if (rest.length >= 2 && isId(rest[0]) && isId(rest[1])) { id = Number(rest[0]); args = [action, ...rest.slice(1)] }
      else id = defaultId()
    } else if (cmd === 'village') { id = isId(parts[1]) ? Number(parts[1]) : defaultId() }
    else return [`unknown command "${cmd}". Type help.`]

    const row = await Database.getRow(id)
    if (!row) return [`player ${id} does not exist yet: log in once with the game first`]

    if (cmd === 'name') {
      const name = args.join(' ').trim()
      if (!name) return ['usage: name [id] <new name>']
      if (name.length > 32 || /[\u0000-\u001f]/.test(name)) return ['name must be 1-32 characters, no control characters']
      await Database.renamePlayer(id, name)
      return [`player ${id} is now called "${name}". Log in again to see it.`]
    }
    if (cmd === 'skin') {
      const action = args[0]; const skinId = Number(args[1]); const equip = args[2] === 'equip'
      if (action === 'list') { const l = await Database.listSkins(id); return l.length ? l.map(s => `${s.id}  ${s.name}  (${s.hero})${s.equipped ? '  [equipped]' : ''}`) : ['no skins stored'] }
      if (!['give', 'remove', 'equip'].includes(action) || !skinId) return ['usage: skin list|give|remove|equip [id] <skinId>   (find ids with: skin find king)']
      if (action === 'give') await Database.giveSkin(id, skinId, equip)
      if (action === 'remove') await Database.removeSkin(id, skinId)
      if (action === 'equip') await Database.equipSkin(id, skinId)
      const s = Skins.info(skinId)
      return [`${action} ok: ${s ? s.name + ' (' + s.hero + ')' : skinId}. Stored in MySQL (not yet sent to the game).`]
    }
    const describe = (trophies, tierIdx) => {
      let th = null; try { const b = (JSON.parse(row.village).buildings || []).find(x => x.data === 1000001); th = b ? b.lvl + 1 : null } catch (e) { /* invalid village JSON: no Town Hall level */ }
      const ol = Leagues.oldLeague(trophies); const mt = th ? Leagues.migrate(th, trophies) : null; const t = Leagues.tier(tierIdx)
      return [`trophies: ${trophies}`, `old system: league_type ${ol.idx} = ${ol.name} (${ol.low}-${ol.high > 100000 ? 'up' : ol.high})`,
        `new system, stored tier: ${t ? t.name + ' (tier ' + t.idx + ')' : tierIdx}`,
        th ? (mt ? `new system, start tier by migration table for Town Hall ${th}: ${mt.name} (tier ${mt.idx})` : `Town Hall ${th}: ${trophies} trophies is below the migration table, no start tier from it`) : 'Town Hall level unknown (the village JSON is unreadable or has no Town Hall)']
    }
    if (cmd === 'trophies') {
      const n = Number(args[0])
      if (!Number.isInteger(n) || n < 0 || n > 99999) return ['usage: trophies [id] <whole number 0-99999>']
      await Database.setTrophies(id, n)
      return [`player ${id}:`, ...describe(n, Number(row.league_tier || 0)), 'Stored in MySQL (not yet sent to the game).']
    }
    if (cmd === 'league') {
      if (args[0] === 'tier') {
        const idx = Number(args[1])
        if (!Number.isInteger(idx) || !Leagues.tier(idx)) return [`usage: league tier [id] <0-${Leagues.tiers.length - 1}>   (see: league tiers)`]
        await Database.setLeagueTier(id, idx)
        return [`player ${id}: new-system tier is now ${Leagues.tier(idx).name} (tier ${idx}). Stored in MySQL (not yet sent to the game).`]
      }
      return [`player ${id}:`, ...describe(Number(row.trophies || 0), Number(row.league_tier || 0))]
    }
    if (cmd === 'trees') {
      const what = args[0] || 'clashmas'
      const ids = what === 'clashmas' ? trees().map(t => t.id) : what.split(',').map(Number)
      const v = JSON.parse(row.village)
      const { added, skipped } = addObstacles(v, ids)
      const { errors } = VillageCheck.check(v)
      if (errors.length) return ['not saved, the result has errors:', ...errors.slice(0, 10)]
      if (added.length) await Database.setVillage(id, v)
      return [`${added.length} obstacle(s) added${added.length ? ': ' + added.map(a => a.year || a.name).join(', ') : ''}`, ...skipped.map(s => 'skipped: ' + s), ...(added.length ? ['Log in again to see them. Undo with: village restore'] : []), ...(what === 'clashmas' ? ['(there is no 2026 tree in this client\'s obstacles.csv)'] : [])]
    }
    if (cmd === 'village') {
      const action = parts[0]
      if (action === 'check') {
        let v; try { v = JSON.parse(row.village) } catch (e) { return ['ERROR invalid JSON: ' + e.message] }
        const { errors, warnings } = VillageCheck.check(v)
        return [...errors.slice(0, 15).map(e => 'ERROR ' + e), ...warnings.slice(0, 15).map(w => 'warn  ' + w), `${errors.length} error(s), ${warnings.length} warning(s)`]
      }
      if (action === 'restore') {
        if (!row.village_ok) return ['no backup yet: a village is saved as "good" after the client stayed connected for 20 s']
        await Database.setVillage(id, JSON.parse(row.village_ok)); return ['restored the last good village. Log in again.']
      }
      if (action === 'reset') { await Database.setVillage(id, HomeData.DEFAULT_VILLAGE()); return ['village reset to the default. Log in again.'] }
      return ['usage: village check|restore|reset [id]']
    }
    return ['unreachable']
  } catch (e) {
    return ['ERROR: ' + e.message]
  }
}

module.exports = { run, HELP }
