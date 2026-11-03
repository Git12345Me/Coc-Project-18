/**
 * HomeData.js
 * Rebuilds the OwnHomeData (25195) payload from readable parts.
 * The byte layout is exactly the one found in the original hex capture,
 * see Tools/ExtractHomeData.js for how the pieces were found.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const AvatarBlock = require('./AvatarBlock')
const DataFiles = require('./DataFiles')

const DIR = path.join(__dirname, '..', 'Data', 'Home')
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const seg = readJson('segments.json')
const S = (k) => Buffer.from(seg[k], 'hex')

// Defaults (what the original server always sent)
const DEFAULT_VILLAGE = readJson('village.json')
const EVENTS = DataFiles.readEvents() // events.json, else calendar.json, else oldevents.json (see Protocol/DataFiles.js)
const GLOBALS = readJson('globals.json')
const DEFAULT_NAME = seg.defaultName

// ---- Player ("avatar") block. Verified against 8 real avatars in the captures and your v14 Player.cs (LogicClientAvatar):
//   [long id][long id][bool clan + (long id, string name, int badge, int role, int level)][bool league ...] ... town hall byte (head +136) ... [string name]
//   after the name (bytes): +4 level, +8 exp, +12 gems, +16 gems, +20 = 1200 (constant), +24 = 60 (constant), +28 trophies, +32 duel trophies,
//   +36 attacks won, +40 (0), +44 defenses won
const AVATAR_HEAD = 149 // bytes from the first avatar id to the name's length field (all inside `preName`)
const TH_BYTE = 136 // town hall level byte, counted from the first avatar id
// LogicClientAvatar::decode (A45B50): after 7 unknown bytes come 13 level BYTES (0-based, 255 = none): +360 town hall, +364 TH village 2, +368 laboratory, +372 lab 2,
// +376 pet shop, +380 recovery building, +384 barracks, +388 dark barracks, +392 spell factory, +396 dark spell factory, +400 workshop, +404 blacksmith, +408 hero tavern.
// building data id -> stream offset counted from the first avatar id
const BUILDING_BYTES = { 1000007: 138, 1000068: 140, 1000006: 142, 1000026: 143, 1000020: 144, 1000029: 145, 1000059: 146, 1000070: 147, 1000071: 148 } // the 13 bytes are CONSECUTIVE in the stream (136 = town hall, 137 = TH village 2, 138 = laboratory ...)
const ORIG_ID = Buffer.from('00000000001b8d01', 'hex') // the account id of the captured player
const POST_FIELDS = { expLevel: [4], expPoints: [8], gems: [12, 16], trophies: [28], duelTrophies: [32], attacksWon: [36], defensesWon: [44] }
const isInt32 = (v) => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647

// FINISHED MISSIONS = a bit set (IDA: A31820 / A35F30 / sub_D92424). sub_D92424 reads N plain int32 words (no count in the stream); mission number m = data id - 21000000
// is bit (m & 31) of word (m >> 5), the words are BIG-ENDIAN int32. Position in the avatar block: right after the base lists, in the "tail" (the part after the last list
// AvatarBlock writes): tail+0..11 three empty int32 lists, +12..14 three empty VInt lists (sub_CD749C x3), +15..18 int32 alliance-unit count (0), then the bit sets:
// tail+19 .. +38 = 5 words = bit set #1 (the capture has word0 = 0x00001fff: missions 0-12 done, word1 = 0x0020e000, word2 = 0x00c00000 = 45-47, 53, 86, 87 done; the ones the
// client still reports in the captures (54, 89-94, 109-111, 115) are NOT set - exactly the open tutorial steps). Then int32 count (table 22 list) at +39, achievements at +43.
const MISSION_AT = 19 // offset inside the tail
const MISSION_WORDS = 5
const MISSION_BYTES = MISSION_WORDS * 4
function missionBase (post) { const t = AvatarBlock.parse(post).tail; return post.length - t.length + MISSION_AT }
/** Sets the bits of the completed missions (never removes one). Returns how many numbers were valid. */
function applyMissionBits (post, claimed) {
  const base = missionBase(post); let n = 0
  for (const m of Array.isArray(claimed) ? claimed : []) {
    if (!Number.isInteger(m) || m < 0 || m >= MISSION_WORDS * 32) continue
    const at = base + 4 * (m >> 5); post.writeUInt32BE((post.readUInt32BE(at) | (1 << (m & 31))) >>> 0, at); n++
  }
  return n
}
/** The mission numbers that are set in the bit set (for logging and tests). */
function readMissionBits (post) {
  const base = missionBase(post); const out = []
  for (let m = 0; m < MISSION_WORDS * 32; m++) if ((post.readUInt32BE(base + 4 * (m >> 5)) >>> (m & 31)) & 1) out.push(m)
  return out
}

// Probe zone: the first 128 bytes after the name are plain int32 fields. Lists whose length matters start later, so probes stop here.
const PROBE_MAX = 128

// Offset inside `head`
const HEAD_SERVER_TIME = 8 // uint32 BE unix time

// The original server wrote JSON PHP-style: "/" is escaped as "\/" and non-ASCII as \uXXXX.
// Keeping that style makes the output byte-identical to the capture.
function serialize (obj) {
  return JSON.stringify(obj)
    .replace(/\//g, '\\/')
    .replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

function blob (obj) {
  const raw = Buffer.from(serialize(obj), 'utf8')
  const z = zlib.deflateSync(raw)
  const hdr = Buffer.alloc(8)
  hdr.writeUInt32BE(z.length + 4, 0) // compressed length + 4
  hdr.writeUInt32LE(raw.length, 4) // uncompressed length (little endian!)
  return Buffer.concat([hdr, z])
}

function str (s) {
  const b = Buffer.from(s, 'utf8')
  const l = Buffer.alloc(4)
  l.writeUInt32BE(b.length, 0)
  return Buffer.concat([l, b])
}

/** Replaces the captured account id (8 bytes) everywhere in an uncompressed segment with a new high/low id. */
function replaceId (buf, high, low) {
  const repl = Buffer.alloc(8); repl.writeInt32BE(high, 0); repl.writeInt32BE(low, 4)
  for (let i = buf.indexOf(ORIG_ID); i >= 0; i = buf.indexOf(ORIG_ID, i + 8)) repl.copy(buf, i)
  return buf
}

/**
 * Writes player values into the avatar block. `post` (the bytes after the name) is changed in place; the new `pre` is returned
 * (it gets longer when the player is in a clan). Unknown or invalid values are skipped.
 * avatar = { expLevel, expPoints, gems, trophies, duelTrophies, attacksWon, defensesWon, alliance: {id, name, badge, role, level} }
 */
function patchAvatar (pre, post, av, village) {
  const A = pre.length - AVATAR_HEAD // index of the first avatar id inside `pre`
  if (A < 0) return pre
  const th = ((village && village.buildings) || []).find(b => b.data === 1000001) // Town Hall: v14 writes its level as a byte
  if (th && Number.isInteger(th.lvl) && th.lvl >= 0 && th.lvl < 256) pre[A + TH_BYTE] = th.lvl
  if (village && Array.isArray(village.buildings)) { // highest level (0-based) of the key buildings, 255 = none (IDA A45B50 / A35F9C, verified on the capture)
    for (const [data, at] of Object.entries(BUILDING_BYTES)) {
      const lv = village.buildings.filter(b => b.data === Number(data) && Number.isInteger(b.lvl)).map(b => b.lvl)
      pre[A + at] = lv.length ? Math.max(0, Math.min(254, Math.max(...lv))) : 255
    }
  }
  for (const [key, offsets] of Object.entries(POST_FIELDS)) {
    const v = av[key]
    if (isInt32(v)) for (const o of offsets) post.writeInt32BE(v, o)
  }
  const c = av.alliance
  if (c && pre[A + 16] === 0 && Number.isInteger(c.id) && c.id >= 0 && typeof c.name === 'string') {
    const nameB = Buffer.from(c.name, 'utf8')
    const blk = Buffer.alloc(1 + 8 + 4 + nameB.length + 12)
    let at = 0; blk[at++] = 1 // "has a clan"
    blk.writeUInt32BE(Math.floor(c.id / 4294967296), at); blk.writeUInt32BE(c.id >>> 0, at + 4); at += 8 // long id
    blk.writeInt32BE(nameB.length, at); at += 4; nameB.copy(blk, at); at += nameB.length
    blk.writeInt32BE(c.badge | 0, at); blk.writeInt32BE(c.role | 0, at + 4); blk.writeInt32BE(Number.isInteger(c.level) ? c.level : 1, at + 8)
    pre = Buffer.concat([pre.subarray(0, A + 16), blk, pre.subarray(A + 17)])
  }
  return pre
}

/**
 * The variable-length lists after the name: resources (gold, elixir ...) and the army (troops + spells you can attack with).
 * They change the length of the block, so this runs LAST, after every fixed-offset patch. Returns the new `post` block.
 * av = { resources: { "3000001": n }, army: { units: { "4000000": n }, spells: { "26000000": n } } }; a missing part stays as captured.
 */
function applyPostLists (post, av, tag = '[login]') {
  if (av && av.resources && typeof av.resources === 'object') {
    const r = AvatarBlock.applyResources(post, av.resources)
    post = r.post
    for (const why of r.skipped) console.log(tag + ' stored resource ignored: ' + why)
  }
  if (av && av.army && typeof av.army === 'object') {
    const r = AvatarBlock.applyArmy(post, av.army)
    post = r.post
    for (const why of r.skipped) console.log(tag + ' stored army entry ignored: ' + why)
  }
  return post
}

/**
 * @param {object} p
 * @param {string} [p.name]      player name (any utf8 string, length is handled)
 * @param {object} [p.village]   village JSON (what you store in MySQL)
 * @param {number} [p.high]      account id high part
 * @param {number} [p.low]       account id low part
 * @param {number} [p.time]      server time override (unix seconds)
 * @param {object} [p.avatar]    player values for the avatar block (see patchAvatar); without it the block is the original capture
 * @param {object} [p.probes]    experiment: { offsetAfterName: int32 }
 * @returns {Buffer} payload for OwnHomeData
 */
function build ({ name = DEFAULT_NAME, village = DEFAULT_VILLAGE, high, low, time, probes, avatar, parts } = {}) {
  const head = Buffer.from(S('head'))
  if (time !== undefined) head.writeUInt32BE(time >>> 0, HEAD_SERVER_TIME)
  let pre = Buffer.from(S('preName'))
  let post = Buffer.from(S('postName'))
  if (high !== undefined || low !== undefined) {
    const h = high === undefined ? 0 : high; const l = low === undefined ? ORIG_ID.readInt32BE(4) : low
    for (const part of [head, pre, post]) replaceId(part, h, l)
  }
  if (avatar) pre = patchAvatar(pre, post, avatar, village)
  for (const [k, v] of Object.entries(probes || {})) { // experiment: overwrite one int32 right after the name (same length, nothing shifts)
    const at = Number(k)
    if (Number.isInteger(at) && at >= 0 && at % 4 === 0 && at <= PROBE_MAX && Number.isInteger(v)) post.writeInt32BE(v | 0, at)
  }
  // Resources (gold, elixir ...) live in a variable-length list, so they are written LAST, after every fixed-offset patch above.
  // avatar.resources = { "3000001": amount, ... } (data id -> amount); without it the captured amounts stay.
  // avatar.army = { units, spells } (same lists, same place as in the attack packet: Protocol/BattleData.js)
  if (avatar) post = applyPostLists(post, avatar, '[login]')
  if (avatar) { // finished missions go in AFTER the lists (their position depends on the list lengths)
    applyMissionBits(post, avatar.missionsClaimed)
    if (avatar.missionsAllDone === true) post.fill(0xff, missionBase(post), missionBase(post) + MISSION_BYTES)
  }
  if (parts) parts.post = post // for Tools / tests: the block after the name
  return Buffer.concat([
    head,
    blob(village), S('mid1'),
    blob(EVENTS), S('mid2'),
    blob(GLOBALS),
    pre, str(name), post
  ])
}

module.exports = {
  build,
  patchAvatar,
  applyPostLists,
  replaceId,
  str,
  ORIG_ID,
  EVENTS,
  GLOBALS,
  PROBE_MAX,
  MISSION_AT,
  applyMissionBits,
  readMissionBits,
  MISSION_BYTES,
  AVATAR_HEAD,
  TH_BYTE,
  postNameInts: () => { const p = S('postName'); const o = []; for (let k = 0; k + 4 <= PROBE_MAX + 4; k += 4) o.push([k, p.readInt32BE(k)]); return o },
  DEFAULT_NAME,
  DEFAULT_VILLAGE: () => JSON.parse(JSON.stringify(DEFAULT_VILLAGE))
}
