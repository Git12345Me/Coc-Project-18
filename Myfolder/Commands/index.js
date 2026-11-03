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
  '  save                              write all online players to MySQL now + show save status (autosave runs every 40 s anyway)',
  '  stop                              save everything and shut the server down (same as Ctrl+C)',
  '  top [n]                           the n players with the most trophies (default 10)',
  '  apply on | off | status           save moves and placed buildings to MySQL',
  '  apply upgrades on | off           also save upgrades (stored as already finished: there is no timer in the village JSON)',
  '  apply unsafe on | off             save placed buildings even without a template (can crash the client: Hero Hall, Spell Forge)',
  '  probe <offset> <number>           EXPERIMENT: change one number in your player block (see: probe help)',
  '  missions all | normal | show      EXPERIMENT: mark every tutorial mission as done in the login packet (stops forced tutorials?); show = what the game reported',
  '  reply search | all | commands | none | status   what the server answers after each end-of-turn message (all = original behaviour)',
  '  mark <text>                       write a marker into Captures/all.log, e.g. mark about to move a cannon',
  '  players                           list saved players (id, name, skins)',
  '  name [id] <new name>              change the player name',
  '  skin find <text>                  search skins.csv by name or hero, e.g. skin find king',
  '  skin list [id]                    skins stored for the player',
  '  skin give [id] <skinId> [equip]   store a skin (only ids that exist in skins.csv)',
  '  skin remove [id] <skinId>',
  '  skin equip [id] <skinId>',
  '  trees [clashmas|id,id,...]        add the Clashmas trees 2012-2025 (or specific obstacle ids)',
  '  trophies [id] <number>            set trophies (shown in the game after the next login) + old league / new tier info',
  '  avatar show [id]                  the player values sent at login: level, exp, gems, trophies, duel trophies, attacks/defenses won',
  '  avatar set [id] <level|exp|gems|duel|won|defended> <number>   change one value (shows in the game after the next login)',
  '  avatar clear [id] <field>         back to the original value',
  '  clan create [id] <name>           make a clan in MySQL with this player as leader (shown in the game after the next login)',
  '  clan leave [id] | clan show [id] | clan list',
  '  league show [id]                  trophies + league of the player',
  '  league tier [id] <0-34>           set the new-system tier directly (league tiers list: league tiers)',
  '  league old | league tiers         print the league lists from your CSVs',
  '  resources show [id]               gold / elixir / dark elixir ... stored in MySQL (players.avatar) and written into the login packet',
  '  resources set [id] <name|id> <n>  name: gold elixir darkElixir builderGold builderElixir (or a data id 3000000-3000099)',
  '  resources clear [id] <name|all>   back to the original captured amount',
  '  vjson show [id] [key]             the village JSON keys (Gold Pass = battlepass, magic items = consumable, army = active_army_loadout ...)',
  '  send <id> [hex]                  EXPERIMENT: sends one raw server message (id + body bytes in hex, e.g. send 26402 00000001) to the newest connected game, to test which message the game reacts to',
  '  goldpass [id] on|off|status       Gold Pass: on = season valid 30 days + premium flag (experimental), off = back, status = show',
  '  vjson set [id] <key> <json>       change one EXISTING key (same type only). Undo: village restore',
  '  townhall show [id]                TEST: Town Hall level, next_th_boost_level, will the boost popup show at the next login?',
  '  townhall seen [id]                TEST: mark the popup as seen (stored in MySQL). Log in again: gone?',
  '  townhall replay [id]              TEST: make the popup show once more at the next login',
  '  badges show [id]                  TEST: the "new item" counters stored in the village (Shop badge) + the news markers',
  '  badges clear [id]                 TEST: set those counters to 0 in MySQL. Log in again: is the Shop badge gone? (undo: village restore)',
  '  army show [id]                    the troops + spells you attack with (login packet AND attack screen; no own army = Battle.DefaultArmy)',
  '  army set [id] <troop> <count>     e.g. army set barbarian 100 | army spell [id] <spell> <count> | army level [id] <name|all> <lvl> | army remove [id] <name> | army clear [id]',
  '  bot add <name> [village file]     make an opponent in MySQL (a village you can attack) | bot list | bot remove <id>',
  '  village check [id]                check the stored village for mistakes',
  '  village restore [id]              go back to the last village that worked',
  '  village reset [id]                original default village',
  'Trophies are sent in the login packet (verified layout). The league icon/tier is stored only.',
  '[id] can be left out in single-player mode (default player ' + LoginOk.DEFAULT_LOW + ').',
  'Note: skins are stored in MySQL but not yet sent to the game.'
]

const KNOWN = new Set(['missions', 'reply', 'avatar', 'clan', 'probe', 'help', '?', 'mark', 'players', 'name', 'skin', 'trees', 'village', 'trophies', 'league', 'apply', 'save', 'stop', 'top', 'badges', 'townhall', 'resources', 'vjson', 'goldpass', 'army', 'bot', 'send'])
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
    if (cmd === 'send') {
      const id = Number(parts[0]); const hex = (parts.slice(1).join('') || '').replace(/[^0-9a-fA-F]/g, '')
      if (!Number.isInteger(id) || id < 20000 || id > 29999 || hex.length % 2) return ['usage: send <id 20000-29999> [hex body]   e.g.  send 26402 00000001']
      const c = module.exports.lastClient
      if (!c || c.destroyed) return ['no game is connected right now']
      const body = Buffer.from(hex, 'hex'); const h = Buffer.alloc(7)
      h.writeUInt16BE(id, 0); h.writeUIntBE(body.length, 2, 3); h.writeUInt16BE(0, 5)
      c.write(Buffer.concat([h, body]))
      return [`sent message ${id} with ${body.length} body byte(s) to the game. Watch the game and the console; nothing is saved.`]
    }
    if (cmd === 'army' || cmd === 'bot') return require('./Battle').run(cmd, parts)
    if (cmd === 'missions') {
      const config = require('../Config'); const a = (parts[0] || 'show').toLowerCase()
      if (a === 'all') config.Server.AllMissionsDone = true
      else if (a === 'normal') config.Server.AllMissionsDone = false
      else if (a === 'seen') { const v = (parts[1] || '').toLowerCase(); if (v !== 'on' && v !== 'off') return ['usage: missions seen on|off   (on = every mission the game reports, like 105 / 109 of the capital tutorial, is saved as DONE so the tutorial stops repeating)']; config.Server.MissionsSeenAreDone = v === 'on'; return ['missions seen are done: ' + (v === 'on' ? 'ON (log in again after the game has reported them)' : 'OFF')] }
      else if (a !== 'show') return ['usage: missions all | normal | seen on|off | show']
      let reported = 'no database'
      if (Database.pool && Database.singlePlayer()) { const r = await Database.getRow(LoginOk.DEFAULT_LOW); try { const m = JSON.parse((r && r.avatar) || '{}').missions; reported = Array.isArray(m) && m.length ? m.join(', ') : 'none yet' } catch (e) { reported = 'unreadable' } }
      return [`all missions done in the login packet: ${config.Server.AllMissionsDone ? 'ON' : 'OFF'} (sets all ${HomeData.MISSION_BYTES * 8} mission bits of the login bit set; completed missions the game reports are always set)`, `missions the game reported so far: ${reported}`, 'Close the game and open it again after changing it. If the login breaks: missions normal, then restart the game.']
    }
    if (cmd === 'reply') {
      const config = require('../Config'); const a = (parts[0] || 'status').toLowerCase()
      if (['search', 'all', 'commands', 'none'].includes(a)) config.Server.TurnReply = a
      else if (a !== 'status') return ['usage: reply search | all | commands | none | status']
      const m = config.Server.TurnReply || 'search'
      return [`reply mode: ${m}. ` + ({ search: 'EnemyHomeData (the attack screen) is sent only when the Attack button is pressed (command 8000). Default.', all: 'EnemyHomeData is sent after EVERY end-of-turn message, also the empty heartbeats (the original behaviour).', commands: 'EnemyHomeData is sent only after a turn that carries a command.', none: 'nothing is sent after end-of-turn messages (the Attack button will not work).' })[m], 'It lasts until the server restarts; for good set "TurnReply" under "Server" in config.json.']
    }
    if (cmd === 'probe') {
      const config = require('../Config'); config.Server.Probes = config.Server.Probes || {}
      const a = (parts[0] || 'help').toLowerCase()
      const base = Object.fromEntries(HomeData.postNameInts())
      if (a === 'help' || a === 'list') {
        const set = Object.entries(config.Server.Probes)
        return ['probe <offset> <number>   changes ONE whole number in your player block, <offset> = bytes after the name (0, 4, 8 ... up to ' + HomeData.PROBE_MAX + ', multiples of 4).',
          'probe clear               remove all probes.   probe table   shows the non-zero numbers you can try.',
          'It changes only the login packet, same length, nothing is saved. Close the game, open it, then look at your profile (tap your level badge).',
          set.length ? 'active probes: ' + set.map(([k, v]) => `+${k}=${v}`).join(', ') : 'active probes: none']
      }
      if (a === 'clear') { config.Server.Probes = {}; return ['all probes removed. Log in again.'] }
      if (a === 'table') return ['offset | original value  (the numbers worth trying)', ...Object.entries(base).filter(([, v]) => v !== 0).map(([k, v]) => `+${k}  |  ${v}`)]
      const at = Number(parts[0]); const val = Number(parts[1])
      if (!Number.isInteger(at) || at < 0 || at % 4 !== 0 || at > HomeData.PROBE_MAX || !Number.isInteger(val) || Math.abs(val) > 2147483647) return ['usage: probe <offset multiple of 4, 0-' + HomeData.PROBE_MAX + '> <whole number>   (probe help)']
      config.Server.Probes[at] = val
      return [`probe set: the number at +${at} (originally ${base[at]}) will be ${val} at the next login. Close the game, open it, then check your profile.`]
    }
    if (cmd === 'apply') {
      const config = require('../Config'); const S = config.Server
      const flag = ['upgrades', 'upgrade', 'unsafe'].includes((parts[0] || '').toLowerCase()) ? parts.shift().toLowerCase().replace(/^upgrade$/, 'upgrades') : 'main'
      const key = { main: 'ApplyCommands', upgrades: 'InstantUpgrades', unsafe: 'PlaceWithoutTemplate' }[flag]
      const a = (parts[0] || 'status').toLowerCase()
      if (a === 'on') S[key] = true
      else if (a === 'off') S[key] = false
      else if (a !== 'status') return ['usage: apply on|off|status    apply upgrades on|off    apply unsafe on|off']
      const st = (v) => (v ? 'ON' : 'OFF')
      return [`apply (moves + placing buildings): ${st(S.ApplyCommands)}`, `apply upgrades (an upgrade is stored as finished): ${st(S.InstantUpgrades)}`, `apply unsafe (save placed buildings that have no template): ${st(S.PlaceWithoutTemplate)}`, 'Both main switches start ON now (nothing to type). Typing here only changes them until the server restarts; for good set ApplyCommands / InstantUpgrades under "Server" in config.json. They need the database on.']
    }
    if (cmd === 'stop') { setImmediate(() => process.emit('SIGINT')); return ['stopping: saving all players first...'] }
    if (cmd === 'save') {
      if (!Database.pool) return ['MySQL is not running for this server (disabled in config.json, or it did not start: read the [DB] lines at the top of this window). Nothing can be saved.']
      const list = await Database.flushAll() // writes EVERY online player, then we read the row back to prove it
      const s = Database.status()
      const totals = `total writes since start: ${s.saves}, failed: ${s.failures}, autosave every ${s.autosaveSeconds} s${s.lastError ? ', last error: ' + s.lastError : ''}`
      if (!list.length) return ['nobody is online, so there is nothing to write. (A player is written every ' + s.autosaveSeconds + ' s while connected, after each saved action, and when he disconnects.)', totals]
      const TH = require('../Protocol/TownHallBoost')
      const out = []
      for (const x of list) {
        if (x.error) { out.push(`id ${x.id} "${x.name}": NOT SAVED: ${x.error}`); continue }
        if (!x.villageWritten) { out.push(`id ${x.id} "${x.name}": avatar/trophies written, VILLAGE NOT written: this session runs on the "${x.source}" village. Run: village check`); continue }
        const row = await Database.getRow(x.id); const mem = Database.peek(x.id)
        const same = !!(row && mem && row.village === JSON.stringify(mem.village))
        let th = ''; try { const v = JSON.parse(row.village); th = `, Town Hall ${TH.level(v)}, next_th_boost_level ${v.next_th_boost_level}` } catch (e) { /* shown below */ }
        out.push(`id ${x.id} "${x.name}": written. MySQL holds village ${row.village.length} bytes, updated ${new Date(row.updated_at).toLocaleTimeString()}, same as memory: ${same ? 'YES' : 'NO !!'}${th}`)
      }
      return [...out, totals]
    }
    if (cmd === 'top') {
      if (!Database.pool) return ['Database is disabled. Set "Database.Enabled": true in config.json and start MySQL.']
      const rows = await Database.getTopPlayers(Math.min(Number(parts[0]) || 10, 100))
      return rows.length ? rows.map((r, i) => `${i + 1}. ${r.name}  (id ${r.id})  ${r.trophies} trophies`) : ['no players yet: log in once']
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
    else if (cmd === 'resources') {
      const rest = parts.slice(1)
      if (!parts[0] || parts[0] === 'show') { id = isId(rest[0]) ? Number(rest[0]) : defaultId(); args = ['show'] }
      else if (['set', 'clear'].includes(parts[0])) { const need = parts[0] === 'set' ? 2 : 1; if (rest.length > need && isId(rest[0])) { id = Number(rest[0]); args = [parts[0], ...rest.slice(1)] } else id = defaultId() }
      else return ['usage: resources show [id] | resources set [id] <name|dataId> <number> | resources clear [id] <name|all>']
    } else if (cmd === 'goldpass') {
      if (isId(parts[0])) { id = Number(parts[0]); args = parts.slice(1) } else { id = defaultId(); args = parts }
    } else if (cmd === 'vjson') {
      const action = parts[0] || 'show'
      if (action === 'show') { if (isId(parts[1])) { id = Number(parts[1]); args = ['show', parts[2]] } else { id = defaultId(); args = ['show', parts[1]] } }
      else if (action === 'set') { if (isId(parts[1]) && parts.length >= 4) { id = Number(parts[1]); args = ['set', parts[2], parts.slice(3).join(' ')] } else { id = defaultId(); args = ['set', parts[1], parts.slice(2).join(' ')] } }
      else return ['usage: vjson show [id] [key] | vjson set [id] <key> <json>']
    }
    else if (cmd === 'avatar') {
      const rest = parts.slice(1)
      if (parts[0] === 'show') id = isId(rest[0]) ? Number(rest[0]) : defaultId()
      else if (['set', 'clear'].includes(parts[0])) { const need = parts[0] === 'set' ? 2 : 1; if (rest.length > need && isId(rest[0])) { id = Number(rest[0]); args = [parts[0], ...rest.slice(1)] } else id = defaultId() }
      else return ['usage: avatar show [id] | avatar set [id] <field> <number> | avatar clear [id] <field>   (fields: level exp gems duel won defended)']
    }
    else if (cmd === 'clan') {
      const rest = parts.slice(1)
      if (parts[0] === 'list') id = null
      else if (parts[0] === 'create') { if (rest.length >= 2 && isId(rest[0])) { id = Number(rest[0]); args = ['create', ...rest.slice(1)] } else id = defaultId() }
      else if (['leave', 'show'].includes(parts[0])) id = isId(rest[0]) ? Number(rest[0]) : defaultId()
      else return ['usage: clan create [id] <name> | clan leave [id] | clan show [id] | clan list']
    }
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
    } else if (cmd === 'village' || cmd === 'badges' || cmd === 'townhall') { id = isId(parts[1]) ? Number(parts[1]) : defaultId() }
    else return [`unknown command "${cmd}". Type help.`]

    if (cmd === 'clan' && parts[0] === 'list') {
      const l = await Database.listAlliances()
      return l.length ? l.map(c => `${c.id}  ${c.name}  badge ${c.badge}  members ${c.members}`) : ['no clans yet. Make one with: clan create <name>']
    }
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
    if (cmd === 'avatar') {
      const FIELDS = { level: 'expLevel', exp: 'expPoints', gems: 'gems', duel: 'duelTrophies', won: 'attacksWon', defended: 'defensesWon', trophies: 'trophies' }
      const av = (() => { try { return JSON.parse(row.avatar || '{}') } catch (e) { return {} } })()
      const show = () => ['stored values (a value that is not listed is the original one from the captured player):',
        ...Object.entries(FIELDS).map(([k, f]) => `  ${k.padEnd(9)} ${f === 'trophies' ? Number(row.trophies || 0) : (av[f] === undefined ? '(original)' : av[f])}`)]
      if (args[0] === 'show' || parts[0] === 'show') return show()
      const field = String(args[1] || '').toLowerCase()
      if (!FIELDS[field]) return ['fields: ' + Object.keys(FIELDS).join(', ')]
      if (args[0] === 'clear') { if (field === 'trophies') await Database.setTrophies(id, 0); else await Database.setAvatarField(id, FIELDS[field], null); return [`${field} is back to the original. Log in again.`] }
      const n = Number(args[2])
      if (!Number.isInteger(n) || n < 0 || n > 2147483647) return ['usage: avatar set [id] <field> <whole number 0-2147483647>']
      if (field === 'trophies') await Database.setTrophies(id, n); else await Database.setAvatarField(id, FIELDS[field], n)
      return [`${field} = ${n}. Close the game and open it again to see it (login packet).`]
    }
    if (cmd === 'clan') {
      const action = args[0] || parts[0]
      if (action === 'show') { const a = await Database.loadAlliance({ id, guest: false }); return a.alliance ? [`player ${id} is in clan ${a.alliance.id} "${a.alliance.name}" (badge ${a.alliance.badge}, role ${a.alliance.role})`] : [`player ${id} is not in a clan`] }
      if (action === 'leave') { const r = await Database.leaveAlliance(id); return [`left clan ${r.id}${r.deleted ? ' (it was empty, so it was deleted)' : ''}. Log in again.`] }
      const name = args.slice(1).join(' ').trim()
      if (!name || name.length > 32 || /[\u0000-\u001f]/.test(name)) return ['usage: clan create [id] <name>   (1-32 characters)']
      const c = await Database.createAlliance(id, { name })
      return [`clan ${c.id} "${c.name}" created with player ${id} as leader. Close the game and open it again: the clan shows in the login data.`, 'Note: the clan tab and joining are not written yet; only the player data shows the clan.']
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
      return [`player ${id}:`, ...describe(n, Number(row.league_tier || 0)), 'Trophies are sent in the login packet: log in again to see them. (League tier: stored only.)']
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
    if (cmd === 'resources') {
      const AB = require('../Protocol/AvatarBlock')
      const original = AB.readResources(Buffer.from(require('../Data/Home/segments.json').postName, 'hex'))
      const av = (() => { try { return JSON.parse(row.avatar || '{}') } catch (e) { return {} } })()
      const stored = av.resources && typeof av.resources === 'object' ? av.resources : {}
      const nameOf = (rid) => (Object.entries(AB.RESOURCE_NAMES).find(([, v]) => v === Number(rid)) || ['id ' + rid])[0]
      const toId = (t) => { const k = Object.keys(AB.RESOURCE_NAMES).find(n => n.toLowerCase() === String(t || '').toLowerCase()); return k ? AB.RESOURCE_NAMES[k] : (/^\d{7}$/.test(t || '') ? Number(t) : null) }
      const show = () => ['resources (a value marked "original" is the one of the captured player):',
        ...[...new Set([...Object.keys(original), ...Object.keys(stored)])].sort().map(k => `  ${nameOf(k).padEnd(14)} (${k})  ${stored[k] === undefined ? 'original ' + original[k] : stored[k]}`)]
      if (args[0] === 'show') return show()
      if (args[0] === 'clear') {
        if (String(args[1]).toLowerCase() === 'all') { await Database.setAvatarField(id, 'resources', null); return ['all resources are back to the original. Log in again.'] }
        const rid = toId(args[1]); if (!rid) return ['unknown resource. names: ' + Object.keys(AB.RESOURCE_NAMES).join(', ') + ', or all']
        const next = { ...stored }; delete next[rid]
        await Database.setAvatarField(id, 'resources', Object.keys(next).length ? next : null)
        return [`${nameOf(rid)} is back to the original. Log in again.`]
      }
      const rid = toId(args[1]); const n = Number(args[2])
      if (!rid) return ['unknown resource. names: ' + Object.keys(AB.RESOURCE_NAMES).join(', ') + ', or a data id 3000000-3000099']
      if (!Number.isInteger(n) || n < 0 || n > 2147483647) return ['usage: resources set [id] <name|dataId> <whole number 0-2147483647>']
      await Database.setAvatarField(id, 'resources', { ...stored, [rid]: n })
      return [`${nameOf(rid)} = ${n}. Close the game and open it again to see it (login packet).`, ...(rid === AB.RESOURCE_NAMES.darkElixir ? ['note: dark elixir is not in the captured list, so it is ADDED as a new entry (not tested in the game).'] : [])]
    }
    if (cmd === 'vjson') {
      let v; try { v = JSON.parse(row.village) } catch (e) { return ['ERROR invalid village JSON: ' + e.message] }
      const kind = (x) => (Array.isArray(x) ? 'list' : x === null ? 'null' : typeof x)
      const SKIP = new Set(['buildings', 'obstacles', 'traps', 'decos', 'vobjs', 'heroFlags', 'buildings2', 'obstacles2', 'traps2', 'decos2', 'vobjs2', 'heroFlags2'])
      const [action, key, text] = args
      if (action === 'show') {
        if (!key) return ['village JSON keys (vjson show <key> prints one):', ...Object.entries(v).map(([k, x]) => `  ${k.padEnd(30)} ${kind(x).padEnd(7)} ${JSON.stringify(x).slice(0, 70)}`)]
        if (!(key in v)) return ['no such key. vjson show lists them.']
        const out = JSON.stringify(v[key]); return [out.length > 1500 ? out.slice(0, 1500) + ' ... (' + out.length + ' characters)' : out]
      }
      if (!key || !(key in v)) return ['only an EXISTING key can be edited (vjson show lists them).']
      if (SKIP.has(key)) return [`"${key}" holds buildings/objects: use the village commands (check, reset, restore ...).`]
      if (!text) return ['usage: vjson set [id] <key> <json>   e.g.  vjson set last_news_seen 5']
      let val; try { val = JSON.parse(text) } catch (e) { return ['that is not valid JSON (' + e.message + '). Texts need double quotes: "abc"'] }
      if (kind(val) !== kind(v[key])) return [`NOT changed: "${key}" is a ${kind(v[key])}, you gave a ${kind(val)}. The game expects the same type.`]
      const before = JSON.stringify(v[key]); v[key] = val
      const { errors } = VillageCheck.check(v); if (errors.length) return ['NOT changed, the village has errors: ' + errors[0]]
      await Database.setVillage(id, v)
      return [`${key} changed.`, 'before: ' + before.slice(0, 200), ' after: ' + JSON.stringify(val).slice(0, 200), 'Close the game and log in again. Undo: village restore']
    }
    if (cmd === 'goldpass') {
      let v; try { v = JSON.parse(row.village) } catch (e) { return ['ERROR invalid village JSON: ' + e.message] }
      if (!v.battlepass || typeof v.battlepass !== 'object') return ['this village has no battlepass key']
      const bp = v.battlepass; const act = args[0] || 'status'
      const info = () => `seasonEnd ${bp.seasonEnd} (${new Date(bp.seasonEnd * 1000).toISOString().slice(0, 10)}${bp.seasonEnd * 1000 < Date.now() ? ', EXPIRED' : ''}) | score ${bp.score} | premium flag ${bp.premium === undefined ? 'not set' : bp.premium}`
      if (act === 'status') return [info()]
      if (act !== 'on' && act !== 'off') return ['usage: goldpass [id] on|off|status']
      const before = info()
      if (act === 'on') { bp.seasonEnd = Math.floor(Date.now() / 1000) + 30 * 86400; bp.premium = true } else { delete bp.premium }
      await Database.setVillage(id, v)
      return ['before: ' + before, ' after: ' + info(), 'Close the game and log in again. "premium" is a GUESS of the key name (the real one is not in IDA yet): if the banner stays, send the function behind sub_A0D368 and sub_CA9DCC. Undo: village restore']
    }
    if (cmd === 'townhall') {
      let v; try { v = JSON.parse(row.village) } catch (e) { return ['ERROR invalid village JSON: ' + e.message] }
      const TH = require('../Protocol/TownHallBoost')
      if (TH.level(v) === null) return ['this village has no Town Hall']
      const info = () => `Town Hall level ${TH.level(v)}, next_th_boost_level ${v.next_th_boost_level} -> popup at next login: ${TH.pending(v) ? 'YES' : 'no'}`
      const action = parts[0] || 'show'
      if (action === 'show') return [info(), 'Server.TownHallBoostOnce is ' + (require('../Config').Server.TownHallBoostOnce !== false ? 'on: the popup is counted as shown after 20 s online' : 'OFF: nothing marks the popup as shown')]
      if (action !== 'seen' && action !== 'replay') return ['usage: townhall show|seen|replay [id]']
      const before = info()
      if (action === 'seen') TH.markSeen(v); else TH.replay(v)
      const { errors } = VillageCheck.check(v)
      if (errors.length) return ['NOT changed, the village has errors: ' + errors[0]]
      await Database.setVillage(id, v)
      return ['before: ' + before, ' after: ' + info(), 'Close the game and log in again.']
    }
    if (cmd === 'badges') {
      let v; try { v = JSON.parse(row.village) } catch (e) { return ['ERROR invalid village JSON: ' + e.message] }
      const KEYS = ['newShopBuildings', 'newShopTraps', 'newShopDecos']
      const sum = (a) => (Array.isArray(a) ? a.reduce((x, y) => x + (Number(y) || 0), 0) : 0)
      const nz = (a) => (Array.isArray(a) ? a.filter(x => x).length : 0)
      const report = () => [...KEYS.map(k => `${k}: ${Array.isArray(v[k]) ? v[k].length + ' slots, ' + nz(v[k]) + ' marked new, sum ' + sum(v[k]) : '(not in this village)'}`),
        `last_news_seen: ${v.last_news_seen}   lastNewsStorySeen: ${v.lastNewsStorySeen}   last_season_seen: ${v.last_season_seen}   next_th_boost_level: ${v.next_th_boost_level}`]
      if ((parts[0] || 'show') === 'show') return [...report(), 'In your screenshot the Shop badge read 579. Run  badges clear , log in again and see if it is gone.']
      if (parts[0] === 'clear') {
        const before = KEYS.reduce((n, k) => n + sum(v[k]), 0)
        for (const k of KEYS) if (Array.isArray(v[k])) v[k] = v[k].map(() => 0) // same length, every item "seen"
        const { errors } = VillageCheck.check(v)
        if (errors.length) return ['NOT changed, the village has errors: ' + errors[0]]
        await Database.setVillage(id, v)
        return [`cleared: the new-item counters went from ${before} to 0 in MySQL. Close the game and log in again.`, 'If the Shop badge is still there, tell me: then it does not come from these counters. Undo with: village restore']
      }
      return ['usage: badges show|clear [id]']
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
