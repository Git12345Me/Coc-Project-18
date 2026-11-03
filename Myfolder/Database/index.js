/**
 * Database layer (MySQL via mysql2). With "Database.Enabled": false in config.json
 * the server behaves exactly like the original: one fixed guest player, nothing saved.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('../Config')
const HomeData = require('../Protocol/HomeData')
const LoginOk = require('../Protocol/LoginOkData')
const Skins = require('../Protocol/Skins')
const VillageCheck = require('../Protocol/VillageCheck')
const TownHallBoost = require('../Protocol/TownHallBoost')
const Store = require('./Store') // v9-style save engine: one shared object per online player, autosave, save on disconnect

const cfg = config.Database || { Enabled: false }
let pool = null

const guest = () => ({
  id: LoginOk.DEFAULT_LOW,
  high: LoginOk.DEFAULT_HIGH,
  low: LoginOk.DEFAULT_LOW,
  token: LoginOk.DEFAULT_TOKEN,
  name: HomeData.DEFAULT_NAME,
  village: HomeData.DEFAULT_VILLAGE(),
  trophies: 0,
  leagueTier: 0,
  skins: [],
  guest: true
})

const tryParse = (text) => { try { return { value: JSON.parse(text) } } catch (e) { return { error: e.message } } }

/**
 * Choose the village to send. A hand-edited village that is broken (bad JSON, duplicate ids, missing x/y)
 * never reaches the client: the last village that stayed connected is used instead, and the broken one stays
 * in MySQL untouched so you can fix it.
 */
function pickVillage (row) {
  const who = `player ${row.id}`
  const cur = tryParse(row.village)
  if (cur.error) console.log(`[DB] >> ${who}: village JSON is invalid (${cur.error})`)
  else {
    const { errors, warnings } = VillageCheck.check(cur.value)
    warnings.forEach(w => console.log(`[DB] >> ${who} warning: ${w}`))
    if (!errors.length) return { village: cur.value, source: 'current' }
    errors.forEach(e => console.log(`[DB] >> ${who} ERROR: ${e}`))
  }
  const ok = row.village_ok ? tryParse(row.village_ok) : null
  if (ok && ok.value) { console.log(`[DB] >> ${who}: sending the LAST GOOD village instead (your edit is still in the "village" column)`); return { village: ok.value, source: 'backup' } }
  console.log(`[DB] >> ${who}: no good backup yet, sending the default village`)
  return { village: HomeData.DEFAULT_VILLAGE(), source: 'default' }
}

/** The extra player values stored as JSON in players.avatar (level, exp, gems, duelTrophies, attacksWon, defensesWon). */
function parseAvatar (text) {
  if (!text) return {}
  try { const o = JSON.parse(text); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch (e) { console.log('[DB] >> players.avatar is not valid JSON, ignored: ' + e.message); return {} }
}

const toPlayer = (row) => {
  const { village, source } = pickVillage(row)
  return { id: Number(row.id), high: 0, low: Number(row.id), token: row.token, name: row.name, village, villageSource: source, trophies: Number(row.trophies || 0), leagueTier: Number(row.league_tier || 0), avatar: parseAvatar(row.avatar), alliance: null, skins: [], guest: false }
}

async function init () {
  if (!cfg.Enabled) return console.log('[DB] >> disabled, running without MySQL (guest player only).')
  const mysql = require('mysql2/promise') // required lazily so the server still starts if it is not installed
  // 1) run schema.sql (multipleStatements only for this one setup connection)
  const setup = await mysql.createConnection({ host: cfg.Host, port: cfg.Port, user: cfg.User, password: cfg.Password, charset: 'utf8mb4', multipleStatements: true })
  await setup.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/bcm/g, cfg.Name))
  await setup.end()
  // 2) normal pool
  pool = mysql.createPool({ host: cfg.Host, port: cfg.Port, user: cfg.User, password: cfg.Password, database: cfg.Name, connectionLimit: 10, charset: 'utf8mb4', waitForConnections: true, enableKeepAlive: true, keepAliveInitialDelay: 10000 })
  try {
  await pool.query('SELECT 1')
  const [col] = await pool.query("SHOW COLUMNS FROM players LIKE 'village_ok'")
  if (!col.length) await pool.query('ALTER TABLE players ADD COLUMN village_ok LONGTEXT NULL') // upgrade for tables created before
  for (const [name, def] of [['trophies', 'INT NOT NULL DEFAULT 0'], ['league_tier', 'INT NOT NULL DEFAULT 0'], ['avatar', 'LONGTEXT NULL']]) {
    const [c] = await pool.query(`SHOW COLUMNS FROM players LIKE '${name}'`)
    if (!c.length) await pool.query(`ALTER TABLE players ADD COLUMN ${name} ${def}`)
  }
  // clan tables made by an older version miss columns (error seen in game: "Unknown column 'description'") - add them, never block start-up
  for (const [name, def] of [['description', "VARCHAR(256) NOT NULL DEFAULT ''"], ['badge', 'INT NOT NULL DEFAULT 0'], ['leader_id', 'BIGINT UNSIGNED NOT NULL DEFAULT 0'], ['created_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP']]) {
    try {
      const [c] = await pool.query(`SHOW COLUMNS FROM alliances LIKE '${name}'`)
      if (!c.length) { await pool.query(`ALTER TABLE alliances ADD COLUMN ${name} ${def}`); console.log(`[DB] >> upgraded table alliances: added column ${name}`) }
    } catch (e) { console.log(`[DB] >> could not check alliances.${name}: ${e.message}`) }
  }
  } catch (e) { // the part that saving needs failed: say so and run without MySQL, instead of half working
    const failed = pool; pool = null
    try { await failed.end() } catch (e2) { /* closing anyway */ }
    throw e
  }
  // optional extras: if one fails, saving must still work
  try {
    const [idx] = await pool.query("SHOW INDEX FROM players WHERE Key_name = 'by_trophies'")
    if (!idx.length) await pool.query('ALTER TABLE players ADD KEY by_trophies (trophies)') // leaderboard (v9: GetTopPlayer)
  } catch (e) { console.log('[DB] >> trophy index not created (saving is not affected): ' + e.message) }
  try { await fillSkinCatalog() } catch (e) { console.log('[DB] >> skin catalog not filled (saving is not affected): ' + e.message) }
  console.log(`[DB] >> connected to MySQL "${cfg.Name}" on ${cfg.Host}:${cfg.Port} | autosave every ${cfg.AutosaveSeconds === undefined ? 40 : cfg.AutosaveSeconds}s, save on disconnect + shutdown`)
}

async function fillSkinCatalog () {
  const rows = Skins.all()
  await pool.query('DELETE FROM skin_catalog') // derived data: always rebuilt from skins.csv, so old wrong rows disappear
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    await pool.query('INSERT INTO skin_catalog (id, name, hero, tid, is_default) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name), hero = VALUES(hero), tid = VALUES(tid), is_default = VALUES(is_default)',
      [chunk.map(r => [r.id, r.name, r.hero, r.tid, r.isDefault ? 1 : 0])])
  }
}

async function loadAlliance (player) {
  if (!pool || player.guest) return player
  try { // a missing table or a failed query must never block a login
    const [rows] = await pool.execute('SELECT a.id, a.name, a.badge, m.role FROM alliance_members m JOIN alliances a ON a.id = m.alliance_id WHERE m.player_id = ?', [player.id])
    player.alliance = rows.length ? { id: Number(rows[0].id), name: rows[0].name, badge: Number(rows[0].badge), role: Number(rows[0].role), level: 1 } : null
  } catch (e) { console.log('[DB] >> could not read the clan of player ' + player.id + ', logging in without it: ' + e.message); player.alliance = null }
  return player
}

const loadExtras = async (player) => loadAlliance(await loadSkins(player))

async function loadSkins (player) {
  if (!pool || player.guest) return player
  try {
    const [rows] = await pool.execute('SELECT skin_id, equipped FROM player_skins WHERE player_id = ? ORDER BY skin_id', [player.id])
    player.skins = rows.map(r => ({ id: Number(r.skin_id), equipped: !!r.equipped }))
  } catch (e) { console.log('[DB] >> could not read the skins of player ' + player.id + ': ' + e.message) }
  return player
}

/** Give a skin. Throws for ids that are not in the client's skins.csv. */
async function giveSkin (playerId, skinId, equip = false) {
  if (!Skins.isValid(skinId)) throw new Error(`skin ${skinId} is not in skins.csv`)
  await pool.execute('INSERT IGNORE INTO player_skins (player_id, skin_id, equipped) VALUES (?, ?, 0)', [playerId, skinId])
  if (equip) await equipSkin(playerId, skinId)
}

async function removeSkin (playerId, skinId) {
  await pool.execute('DELETE FROM player_skins WHERE player_id = ? AND skin_id = ?', [playerId, skinId])
}

/** Equip one skin; unequips the player's other skins of the same hero. */
async function equipSkin (playerId, skinId) {
  if (!Skins.isValid(skinId)) throw new Error(`skin ${skinId} is not in skins.csv`)
  const same = Skins.sameHero(skinId)
  await pool.execute(`UPDATE player_skins SET equipped = 0 WHERE player_id = ? AND skin_id IN (${same.map(() => '?').join(',')})`, [playerId, ...same])
  const [res] = await pool.execute('UPDATE player_skins SET equipped = 1 WHERE player_id = ? AND skin_id = ?', [playerId, skinId])
  if (!res.affectedRows) throw new Error(`player ${playerId} does not own skin ${skinId}`)
}

async function listSkins (playerId) {
  const [rows] = await pool.execute('SELECT skin_id, equipped FROM player_skins WHERE player_id = ? ORDER BY skin_id', [playerId])
  return rows.map(r => ({ ...Skins.info(r.skin_id), equipped: !!r.equipped }))
}

async function createPlayer () {
  const token = crypto.randomBytes(20).toString('hex') // 40 chars, same length as the original token
  const village = JSON.stringify(HomeData.DEFAULT_VILLAGE())
  const [res] = await pool.execute('INSERT INTO players (token, name, village) VALUES (?, ?, ?)', [token, HomeData.DEFAULT_NAME, village])
  return toPlayer({ id: res.insertId, token, name: HomeData.DEFAULT_NAME, village })
}

/**
 * Single-player mode (default while client packets are still encrypted):
 * every connection is the one main player, stored with the ORIGINAL account id so nothing changes
 * for the client except name/village now coming from MySQL.
 */
async function mainPlayer (client) {
  if (!pool) return guest()
  const id = LoginOk.DEFAULT_LOW
  const cached = await fromCache(id, client) // already online (hello + login, or a reconnect): the SAME object, never a second copy
  if (cached) return cached
  const [rows] = await pool.execute('SELECT * FROM players WHERE id = ?', [id])
  if (rows.length) return Store.attach(await loadExtras(toPlayer(rows[0])), client)
  const village = JSON.stringify(HomeData.DEFAULT_VILLAGE())
  await pool.execute('INSERT INTO players (id, token, name, village) VALUES (?, ?, ?, ?)', [id, LoginOk.DEFAULT_TOKEN, HomeData.DEFAULT_NAME, village])
  return Store.attach(toPlayer({ id, token: LoginOk.DEFAULT_TOKEN, name: HomeData.DEFAULT_NAME, village }), client)
}

/** The online object of this account (clan + skins refreshed), or undefined. null = it is online but the token is wrong. */
async function fromCache (id, client, token) {
  const hit = Store.peek(id)
  if (!hit) return undefined
  if (token !== undefined && hit.token !== token) return null
  await loadExtras(hit)
  return Store.attach(hit, client)
}

/** Client sent HighID/LowID/Token. LowID 0 = new account. Returns a player or null (bad token). */
async function login (high, low, token, client) {
  if (!pool) return guest()
  if (cfg.SinglePlayerMode !== false) return mainPlayer(client)
  if (!low) return Store.attach(await createPlayer(), client)
  const cached = await fromCache(Number(low), client, token)
  if (cached !== undefined) return cached
  const [rows] = await pool.execute('SELECT * FROM players WHERE id = ?', [low])
  if (!rows.length) return Store.attach(await createPlayer(), client)
  return rows[0].token === token ? Store.attach(await loadExtras(toPlayer(rows[0])), client) : null
}

/**
 * Called after OwnHomeData was sent. If the client is still connected 20 s later the village did not crash it,
 * so exactly the village that was sent becomes the "last good" backup.
 */
function markGoodLater (client, ms = 20000) {
  const p = client.player
  if (!pool || !p || p.guest) return
  if (p.villageSource !== 'current') return console.log(`[DB] >> this session runs on the "${p.villageSource}" village, not your stored one: NOTHING of this session is saved to the village (run: village check, then village restore or fix the errors)`)
  let sent = JSON.stringify(p.village)
  // The Town Hall popup was on screen for a while: remember it, so it shows once per new Town Hall level (not at every login)
  const popupMs = Math.min(ms, Number(config.Server.TownHallBoostSeconds || 10) * 1000)
  if (config.Server.TownHallBoostOnce !== false && TownHallBoost.pending(p.village)) {
    console.log(`[DB] >> Town Hall ${TownHallBoost.level(p.village)} popup is pending (next_th_boost_level ${p.village.next_th_boost_level}): counted as shown if you stay ${Math.round(popupMs / 1000)} s`)
    setTimeout(async () => {
      if (client.destroyed || !TownHallBoost.pending(p.village)) return
      TownHallBoost.markSeen(p.village)
      const v = JSON.parse(sent); TownHallBoost.markSeen(v); sent = JSON.stringify(v)
      try { await Store.saveNow(p); console.log(`[DB] >> Town Hall ${TownHallBoost.level(p.village)} popup counted as shown and SAVED: next_th_boost_level = ${p.village.next_th_boost_level}`) } catch (e) { console.log('[DB] >> could not save the Town Hall popup state:', e.message) }
    }, popupMs).unref()
  }
  setTimeout(async () => {
    if (client.destroyed) return
    try { await pool.execute('UPDATE players SET village_ok = ? WHERE id = ?', [sent, p.id]) } catch (e) { console.log('[DB] >> could not save backup:', e.message) }
  }, ms).unref()
}

/**
 * Admin edits (server commands) write straight into MySQL. If that player is online, the pending game changes are
 * written first and the edited values are loaded into the online object afterwards, so the next autosave
 * cannot overwrite the edit with an old copy.
 */
async function adminEdit (playerId, fn) {
  await Store.flushById(playerId)
  const result = await fn()
  await Store.reload(playerId)
  return result
}

async function saveVillage (playerId, village) {
  if (!pool) return
  await pool.execute('UPDATE players SET village = ? WHERE id = ?', [JSON.stringify(village), playerId])
}

async function getRow (playerId) {
  const [rows] = await pool.execute('SELECT * FROM players WHERE id = ?', [playerId])
  return rows[0] || null
}

async function listPlayers () {
  const [rows] = await pool.execute('SELECT p.id, p.name, (SELECT COUNT(*) FROM player_skins s WHERE s.player_id = p.id) AS skins FROM players p ORDER BY p.id')
  return rows
}

const setVillage = (playerId, village) => adminEdit(playerId, () => pool.execute('UPDATE players SET village = ? WHERE id = ?', [JSON.stringify(village), playerId]))

const setTrophies = (playerId, trophies) => adminEdit(playerId, () => pool.execute('UPDATE players SET trophies = ? WHERE id = ?', [trophies, playerId]))

const setLeagueTier = (playerId, tier) => adminEdit(playerId, () => pool.execute('UPDATE players SET league_tier = ? WHERE id = ?', [tier, playerId]))

const setAvatarField = (playerId, key, value) => adminEdit(playerId, async () => {
  const row = await getRow(playerId)
  if (!row) throw new Error(`player ${playerId} does not exist`)
  const av = parseAvatar(row.avatar)
  if (value === null) delete av[key]; else av[key] = value
  await pool.execute('UPDATE players SET avatar = ? WHERE id = ?', [JSON.stringify(av), playerId])
  return av
})

/** Admin clan helpers (the in-game create/join replies are not written yet). Roles: 1 member, 2 leader, 3 elder, 4 co-leader. */
async function createAlliance (playerId, { name, badge = 0, description = '' }) {
  const [mine] = await pool.execute('SELECT alliance_id FROM alliance_members WHERE player_id = ?', [playerId])
  if (mine.length) throw new Error('this player is already in a clan: leave first')
  const [res] = await pool.execute('INSERT INTO alliances (name, description, badge, leader_id) VALUES (?, ?, ?, ?)', [String(name).slice(0, 32), description, badge, playerId])
  await pool.execute('INSERT INTO alliance_members (alliance_id, player_id, role) VALUES (?, ?, 2)', [res.insertId, playerId])
  return { id: Number(res.insertId), name, badge }
}

async function leaveAlliance (playerId) {
  const [mine] = await pool.execute('SELECT alliance_id FROM alliance_members WHERE player_id = ?', [playerId])
  if (!mine.length) throw new Error('this player is not in a clan')
  const aid = mine[0].alliance_id
  await pool.execute('DELETE FROM alliance_members WHERE player_id = ?', [playerId])
  const [left] = await pool.execute('SELECT COUNT(*) AS n FROM alliance_members WHERE alliance_id = ?', [aid])
  if (!Number(left[0].n)) await pool.execute('DELETE FROM alliances WHERE id = ?', [aid]) // an empty clan disappears
  return { id: Number(aid), deleted: !Number(left[0].n) }
}

async function listAlliances () {
  const [rows] = await pool.execute('SELECT a.id, a.name, a.badge, (SELECT COUNT(*) FROM alliance_members m WHERE m.alliance_id = a.id) AS members FROM alliances a ORDER BY a.id')
  return rows
}

/** Clan + members for the clan screen (25413). Roles: 1 member, 2 leader, 3 elder, 4 co-leader. */
async function getAllianceFull (id) {
  if (!pool) return null
  const [a] = await pool.execute('SELECT id, name, description, badge, leader_id FROM alliances WHERE id = ?', [id])
  if (!a.length) return null
  const [m] = await pool.execute('SELECT p.id, p.name, p.trophies, p.avatar, m.role FROM alliance_members m JOIN players p ON p.id = m.player_id WHERE m.alliance_id = ? ORDER BY m.role = 2 DESC, p.trophies DESC, p.id ASC', [id])
  return { id: Number(a[0].id), name: a[0].name, description: a[0].description || '', badge: Number(a[0].badge), members: m.map(r => ({ id: Number(r.id), name: r.name, trophies: Number(r.trophies || 0), role: Number(r.role), avatar: parseAvatar(r.avatar) })) }
}

/** Clan settings edit (11206): leader (2) or co-leader (4) only. Only the fields MySQL stores are written. */
async function updateAllianceSettings (playerId, { description, badge }) {
  const [m] = await pool.execute('SELECT alliance_id, role FROM alliance_members WHERE player_id = ?', [playerId])
  if (!m.length) throw new Error('this player is not in a clan')
  if (![2, 4].includes(Number(m[0].role))) throw new Error('only the leader or a co-leader can edit the clan')
  const sets = []; const vals = []
  if (typeof description === 'string') { sets.push('description = ?'); vals.push(description.slice(0, 256)) }
  if (Number.isInteger(badge)) { sets.push('badge = ?'); vals.push(badge) }
  if (sets.length) await pool.execute(`UPDATE alliances SET ${sets.join(', ')} WHERE id = ?`, [...vals, m[0].alliance_id])
  return { id: Number(m[0].alliance_id), changed: sets.length }
}

/** Clan mail (14466) is kept in alliance_chat so it is not lost (it is not delivered to the game yet). */
async function addAllianceMail (playerId, message) {
  const [m] = await pool.execute('SELECT alliance_id FROM alliance_members WHERE player_id = ?', [playerId])
  if (!m.length) throw new Error('this player is not in a clan')
  await pool.execute('INSERT INTO alliance_chat (alliance_id, player_id, message) VALUES (?, ?, ?)', [m[0].alliance_id, playerId, String(message).slice(0, 256)])
  return Number(m[0].alliance_id)
}

async function renamePlayer (playerId, name) {
  if (!pool) return
  await adminEdit(playerId, () => pool.execute('UPDATE players SET name = ? WHERE id = ?', [name.slice(0, 32), playerId]))
}

/** Top players by trophies (v9: MySQL_V2.GetTopPlayer, LIMIT 100). Ready for the leaderboard packets. */
async function getTopPlayers (limit = 100) {
  await Store.autosave() // so the list includes what online players just earned
  const [rows] = await pool.query('SELECT id, name, trophies, league_tier FROM players ORDER BY trophies DESC, id ASC LIMIT ?', [Math.max(1, Math.min(Number(limit) || 100, 1000))])
  return rows
}

// ---------------------------------------------------------------------------
// Opponents for the attack screen (v9: Search_Opponent + Core.Players.Get). The enemy village is ANOTHER row of `players`.
// ---------------------------------------------------------------------------

/**
 * Picks the village the attacker will see. Like v9: never yourself, never one of the last `keep` opponents; when everybody has
 * been seen the list starts over. `recent` (the attacker's list of ids) is changed in place.
 * An opponent whose stored village is broken (bad JSON, check errors) is skipped: a broken village would crash the client.
 * @returns the opponent player object { id, high, low, name, village, trophies, avatar, alliance } or null when nobody else exists
 */
async function findOpponent (me, recent, { trophyRange = 0, keep = 20 } = {}) {
  if (!pool) return null
  keep = Math.max(1, Number(keep) || 20)
  const myId = Number(me && me.id)
  const attempt = async (exclude, range) => {
    let sql = 'SELECT * FROM players WHERE id NOT IN (?)'
    const params = [exclude]
    if (range > 0) { sql += ' AND trophies BETWEEN ? AND ?'; params.push(Math.max(0, Number(me.trophies || 0) - range), Number(me.trophies || 0) + range) }
    sql += ' ORDER BY RAND() LIMIT 25'
    const [rows] = await pool.query(sql, params)
    for (const row of rows) {
      const live = Store.peek(Number(row.id)) // an online player: his CURRENT village / values, not the last autosave
      const p = live || toPlayer(row)
      if (!live && p.villageSource !== 'current') continue
      if (live && VillageCheck.check(live.village).errors.length) continue
      return p
    }
    return null
  }
  const exclude = [myId, ...(Array.isArray(recent) ? recent.map(Number) : [])]
  let enemy = null
  if (trophyRange > 0) enemy = await attempt(exclude, trophyRange)
  if (!enemy) enemy = await attempt(exclude, 0)
  if (!enemy && exclude.length > 1) { recent.length = 0; enemy = await attempt([myId], 0) } // everybody was seen: start over
  if (!enemy) return null
  if (Array.isArray(recent)) { recent.push(enemy.id); while (recent.length > keep) recent.shift() }
  return loadExtras({ ...enemy, avatar: enemy.avatar || {} })
}

/** Opponents made with the server command "bot add": rows whose token starts with "bot". Real players are never touched. */
async function createBot ({ name, village, trophies = 0 }) {
  const token = ('bot' + crypto.randomBytes(20).toString('hex')).slice(0, 40)
  const [res] = await pool.query('INSERT INTO players (token, name, village, trophies) VALUES (?, ?, ?, ?)', [token, String(name).slice(0, 32), JSON.stringify(village), trophies])
  return Number(res.insertId)
}

async function listBots () {
  const [rows] = await pool.query("SELECT id, name, trophies FROM players WHERE token LIKE 'bot%' ORDER BY id")
  return rows.map(r => ({ id: Number(r.id), name: r.name, trophies: Number(r.trophies || 0) }))
}

async function removeBot (id) {
  const [res] = await pool.query("DELETE FROM players WHERE id = ? AND token LIKE 'bot%'", [id])
  return res.affectedRows > 0
}

/**
 * Changes another player (the enemy after an attack): the online object when he is online (saved by the autosave), otherwise the row.
 * `mutate(player)` changes trophies / avatar in place.
 */
async function applyToPlayer (id, mutate) {
  if (!pool) return
  const live = Store.peek(Number(id))
  if (live) { mutate(live); Store.touch(live); return }
  const [rows] = await pool.query('SELECT * FROM players WHERE id = ?', [Number(id)])
  if (!rows.length) return
  const p = toPlayer(rows[0])
  mutate(p)
  await pool.execute('UPDATE players SET avatar = ?, trophies = ? WHERE id = ?', [JSON.stringify(p.avatar || {}), Number(p.trophies) || 0, Number(id)])
}

// The save engine starts HERE, not inside init(): whatever happens during start-up, it always asks for the current pool when it saves.
Store.init({ pool: () => pool, convert: (row) => toPlayer(row), autosaveSeconds: cfg.AutosaveSeconds, debounceMs: cfg.SaveDebounceMs })

module.exports = { applyToPlayer, findOpponent, createBot, listBots, removeBot, init, login, attach: Store.attach, touch: Store.touch, saveNow: Store.saveNow, release: Store.release, flushAll: Store.saveAll, peek: Store.peek, shutdown: Store.shutdown, status: Store.status, getTopPlayers, setAvatarField, createAlliance, leaveAlliance, listAlliances, updateAllianceSettings, addAllianceMail, getAllianceFull, loadAlliance, setTrophies, setLeagueTier, getRow, listPlayers, setVillage, markGoodLater, giveSkin, removeSkin, equipSkin, listSkins, mainPlayer, singlePlayer: () => cfg.SinglePlayerMode !== false, _setPool: (p) => { pool = p }, saveVillage, renamePlayer, guest, get pool () { return pool } }
