/**
 * BattleData.js - builds the EnemyHomeData (21940) packet: the "attack a village" packet.
 * Replaces the old Protocol/EnemyHomeData.js + Data/EnemyHome/*.json (removed), which always sent ONE fixed village and ONE fixed army.
 *
 * It works like v9 (Pc_Battle_Data.cs):   Home(enemy)  +  Enemy.Avatar  +  Attacker.Avatar
 *   - the enemy village  = the village JSON of another player of the MySQL table `players` (chosen by Database.findOpponent)
 *   - the enemy avatar   = that player's name, trophies, clan, Town Hall, stored values and loot (resources)
 *   - the attacker avatar = YOUR player block, written by the same code as the login packet: so the troops and spells you
 *                           are allowed to attack with (avatar.army in MySQL, command: army ...) and your resources are the same.
 * Before, both avatars were fixed hex from a capture, which is where "only 20 barbarians" came from (troop list 4000000 -> 20).
 *
 * Byte layout: Data/Battle/segments.json (made by Tools/ExtractBattleTemplate.js), notes in Data/battle_packet_notes.md.
 * With no enemy and no attacker given, the output is byte-identical to the old captured packet (proved by `npm test`).
 */
const fs = require('fs')
const path = require('path')
const HomeData = require('./HomeData')
const Army = require('./Army')

const seg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'Data', 'Battle', 'segments.json'), 'utf8'))
const T = (key) => Buffer.from(seg[key], 'hex')
const TEMPLATE_ENEMY_ID = Buffer.from('000000000000002b', 'hex') // account id 43 of the captured enemy (appears in prefix, enemyPre x2, enemyPost x1)
const PREFIX_ID_AT = 12 // the enemy id (two int32) inside the 37-byte prefix
const CLAN_FLAG_AT = 17 // [00][id 8][id 8] then the "in a clan" byte
const zlib = require('zlib')

/** The enemy village goes out as plain JSON, like the captured enemy packet (the login packet uses PHP-style escaping). */
function plainBlob (obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8')
  const z = zlib.deflateSync(raw)
  const hdr = Buffer.alloc(8)
  hdr.writeUInt32BE(z.length + 4, 0)
  hdr.writeUInt32LE(raw.length, 4)
  return Buffer.concat([hdr, z])
}

/** The captured enemy was in a clan. Returns the same block without the clan (the bool is 0), so HomeData.patchAvatar can add any clan. */
function withoutClan (pre) {
  if (pre[CLAN_FLAG_AT] === 0) return Buffer.from(pre)
  const nameLen = pre.readInt32BE(CLAN_FLAG_AT + 1 + 8)
  const end = CLAN_FLAG_AT + 1 + 8 + 4 + nameLen + 12 // flag, long id, string, badge, role, level
  return Buffer.concat([pre.subarray(0, CLAN_FLAG_AT), Buffer.from([0]), pre.subarray(end)])
}

function setEnemyId (buf, high, low) {
  const repl = Buffer.alloc(8); repl.writeInt32BE(high, 0); repl.writeInt32BE(low, 4)
  for (let i = buf.indexOf(TEMPLATE_ENEMY_ID); i >= 0; i = buf.indexOf(TEMPLATE_ENEMY_ID, i + 8)) repl.copy(buf, i)
}

/** Player values -> the "avatar" object that HomeData.patchAvatar / applyPostLists understand. */
const avatarOf = (p) => Object.assign({}, p.avatar, { trophies: p.trophies, alliance: p.alliance || undefined })
/** The attacker also gets the army (own stored army > Battle.DefaultArmy > captured). The enemy's army list is never touched. */
const attackerAvatar = (p) => Object.assign(avatarOf(p), { army: Army.effective(p) || undefined })

/**
 * @param {object} [o]
 * @param {object} [o.attacker]  the attacking player { name, high, low, village, trophies, alliance, avatar } (client.player). Without it the captured player is sent.
 * @param {object} [o.enemy]     the village owner { name, high, low, village, trophies, alliance, avatar }. Without it the captured enemy (Calipso2) with the default village is sent.
 * @param {object} [o.home]      override of the enemy village JSON (tests)
 * @param {object} [o.events]    override of the events JSON (tests)
 * @param {object} [o.globals]   override of the globals JSON (tests)
 * @returns {Buffer}
 */
function build ({ attacker, enemy, home, events, globals } = {}) {
  // ---- enemy ----
  let prefix = T('prefix')
  let epre = T('enemyPre')
  let epost = T('enemyPost')
  let ename = seg.enemyName
  let village = HomeData.DEFAULT_VILLAGE()
  if (enemy) {
    const high = enemy.high | 0; const low = enemy.low | 0
    prefix.writeInt32BE(high, PREFIX_ID_AT); prefix.writeInt32BE(low, PREFIX_ID_AT + 4)
    epre = withoutClan(epre)
    setEnemyId(epre, high, low); setEnemyId(epost, high, low)
    const av = avatarOf(enemy)
    epre = HomeData.patchAvatar(epre, epost, av, enemy.village) // Town Hall byte, trophies, level, clan ...
    epost = HomeData.applyPostLists(epost, { resources: av.resources }, '[battle]') // the loot the attacker can win; the enemy's own army list stays as captured
    ename = enemy.name
    village = enemy.village
  }
  // ---- attacker (you) ----
  let apre = T('attackerPre')
  let apost = T('attackerPost')
  let aname = seg.attackerName
  if (attacker) {
    if (attacker.high !== undefined || attacker.low !== undefined) {
      const h = attacker.high === undefined ? 0 : attacker.high
      const l = attacker.low === undefined ? HomeData.ORIG_ID.readInt32BE(4) : attacker.low
      for (const part of [apre, apost]) HomeData.replaceId(part, h, l)
    }
    const av = attackerAvatar(attacker)
    apre = HomeData.patchAvatar(apre, apost, av, attacker.village)
    apost = HomeData.applyPostLists(apost, av, '[battle]') // resources + army (troops / spells) from MySQL
    aname = attacker.name
  }
  return Buffer.concat([
    prefix, plainBlob(home === undefined ? village : home),
    T('betweenHomeEvents'), plainBlob(events === undefined ? HomeData.EVENTS : events),
    T('betweenEventsGlobals'), plainBlob(globals === undefined ? HomeData.GLOBALS : globals),
    epre, HomeData.str(ename), epost,
    apre, HomeData.str(aname), apost
  ])
}

/** The loot the attack screen offers for this enemy: { dataId: amount } = the captured template amounts overridden by the enemy's stored resources. */
function availableLoot (enemy) {
  const base = require('./AvatarBlock').readResources(T('enemyPost'))
  return Object.assign({}, base, enemy && enemy.avatar && enemy.avatar.resources)
}

module.exports = { build, withoutClan, availableLoot }
