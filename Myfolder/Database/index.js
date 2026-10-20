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

const toPlayer = (row) => {
  const { village, source } = pickVillage(row)
  return { id: Number(row.id), high: 0, low: Number(row.id), token: row.token, name: row.name, village, villageSource: source, trophies: Number(row.trophies || 0), leagueTier: Number(row.league_tier || 0), skins: [], guest: false }
}

async function init () {
  if (!cfg.Enabled) return console.log('[DB] >> disabled, running without MySQL (guest player only).')
  const mysql = require('mysql2/promise') // required lazily so the server still starts if it is not installed
  // 1) run schema.sql (multipleStatements only for this one setup connection)
  const setup = await mysql.createConnection({ host: cfg.Host, port: cfg.Port, user: cfg.User, password: cfg.Password, multipleStatements: true })
  await setup.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/bcm/g, cfg.Name))
  await setup.end()
  // 2) normal pool
  pool = mysql.createPool({ host: cfg.Host, port: cfg.Port, user: cfg.User, password: cfg.Password, database: cfg.Name, connectionLimit: 10 })
  await pool.query('SELECT 1')
  const [col] = await pool.query("SHOW COLUMNS FROM players LIKE 'village_ok'")
  if (!col.length) await pool.query('ALTER TABLE players ADD COLUMN village_ok LONGTEXT NULL') // upgrade for tables created before
  for (const [name, def] of [['trophies', 'INT NOT NULL DEFAULT 0'], ['league_tier', 'INT NOT NULL DEFAULT 0']]) {
    const [c] = await pool.query(`SHOW COLUMNS FROM players LIKE '${name}'`)
    if (!c.length) await pool.query(`ALTER TABLE players ADD COLUMN ${name} ${def}`)
  }
  await fillSkinCatalog()
  console.log(`[DB] >> connected to MySQL "${cfg.Name}" on ${cfg.Host}:${cfg.Port}`)
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

async function loadSkins (player) {
  if (!pool || player.guest) return player
  const [rows] = await pool.execute('SELECT skin_id, equipped FROM player_skins WHERE player_id = ? ORDER BY skin_id', [player.id])
  player.skins = rows.map(r => ({ id: Number(r.skin_id), equipped: !!r.equipped }))
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
async function mainPlayer () {
  if (!pool) return guest()
  const id = LoginOk.DEFAULT_LOW
  const [rows] = await pool.execute('SELECT * FROM players WHERE id = ?', [id])
  if (rows.length) return loadSkins(toPlayer(rows[0]))
  const village = JSON.stringify(HomeData.DEFAULT_VILLAGE())
  await pool.execute('INSERT INTO players (id, token, name, village) VALUES (?, ?, ?, ?)', [id, LoginOk.DEFAULT_TOKEN, HomeData.DEFAULT_NAME, village])
  return toPlayer({ id, token: LoginOk.DEFAULT_TOKEN, name: HomeData.DEFAULT_NAME, village })
}

/** Client sent HighID/LowID/Token. LowID 0 = new account. Returns a player or null (bad token). */
async function login (high, low, token) {
  if (!pool) return guest()
  if (cfg.SinglePlayerMode !== false) return mainPlayer()
  if (!low) return createPlayer()
  const [rows] = await pool.execute('SELECT * FROM players WHERE id = ?', [low])
  if (!rows.length) return createPlayer()
  return rows[0].token === token ? loadSkins(toPlayer(rows[0])) : null
}

/**
 * Called after OwnHomeData was sent. If the client is still connected 20 s later the village did not crash it,
 * so exactly the village that was sent becomes the "last good" backup.
 */
function markGoodLater (client, ms = 20000) {
  const p = client.player
  if (!pool || !p || p.guest || p.villageSource !== 'current') return
  const sent = JSON.stringify(p.village)
  setTimeout(async () => {
    if (client.destroyed) return
    try { await pool.execute('UPDATE players SET village_ok = ? WHERE id = ?', [sent, p.id]) } catch (e) { console.log('[DB] >> could not save backup:', e.message) }
  }, ms).unref()
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

async function setVillage (playerId, village) {
  await pool.execute('UPDATE players SET village = ? WHERE id = ?', [JSON.stringify(village), playerId])
}

async function setTrophies (playerId, trophies) {
  await pool.execute('UPDATE players SET trophies = ? WHERE id = ?', [trophies, playerId])
}

async function setLeagueTier (playerId, tier) {
  await pool.execute('UPDATE players SET league_tier = ? WHERE id = ?', [tier, playerId])
}

async function renamePlayer (playerId, name) {
  if (!pool) return
  await pool.execute('UPDATE players SET name = ? WHERE id = ?', [name.slice(0, 32), playerId])
}

module.exports = { init, login, setTrophies, setLeagueTier, getRow, listPlayers, setVillage, markGoodLater, giveSkin, removeSkin, equipSkin, listSkins, mainPlayer, singlePlayer: () => cfg.SinglePlayerMode !== false, _setPool: (p) => { pool = p }, saveVillage, renamePlayer, guest, get pool () { return pool } }
