/**
 * AvatarWalk.js - reads the part of the avatar block that comes AFTER the lists AvatarBlock writes (caps, resources, army, levels) in the exact order of
 * LogicClientAvatar::decode (IDA sub_A45B50) and the rest of OwnHomeData (sub_C9122C). Used to PROVE a login packet is well-formed: walk(post) must end exactly at post.length.
 *
 * Stream rules (IDA): int32 / long are big-endian (D785B0 / D78714), VInt = Supercell VInt, string = int32 length + bytes, and BOOLS ARE BIT-PACKED
 * (sub_D78084): consecutive bool reads share one byte, bit 0 first; any other read starts a new byte. Slot 280 is a variable-length number (1 byte when 0).
 *
 * Tail layout, offsets from the start of the tail (= first byte after the last list AvatarBlock writes):
 *   +0   3 x int32 empty lists | +12 3 x VInt empty (per-hero arrays) | +15 int32 alliance units (0)
 *   +19  mission BIT SET, 5 big-endian int32 words (+19..+38)            <- HomeData.applyMissionBits
 *   +39  int32 count + ids (table 22), then achievements, npc map, npc looted gold / elixir / dark elixir, ... (see walk())
 */
const AvatarBlock = require('./AvatarBlock')

const MISSION_AT = 19
const MISSION_WORDS = 5

/** @returns {{end:number, sections:{name:string, at:number, n?:number}[], missionBits:number, serverTimes:bigint[]}} */
function walk (post) {
  const t = AvatarBlock.parse(post).tail
  const start = post.length - t.length
  let o = start + MISSION_AT; let bit = 0
  const sections = []
  const mark = (name, n) => sections.push({ name, at: o, n })
  const need = (k) => { if (o + k > post.length) throw new Error(`avatar block ends too early at ${o} (needs ${k} more bytes)`) }
  const i32 = () => { bit = 0; need(4); const v = post.readInt32BE(o); o += 4; return v }
  const i64 = () => { bit = 0; need(8); const v = post.readBigInt64BE(o); o += 8; return v }
  const bool = () => { need(1); let v; if (bit === 0) { v = post[o++] & 1; bit = 1 } else { v = (post[o - 1] >> bit) & 1; bit = (bit + 1) & 7 } return v }
  const vint = () => { bit = 0; need(1); let x = post[o++]; const neg = !!(x & 0x40); let v = x & 0x3f; let bits = 6; while (x & 0x80) { need(1); x = post[o++]; v += (x & 0x7f) * 2 ** bits; bits += 7 } return neg ? v - 2 ** bits : v }
  const str = () => { const n = i32(); if (n > 0) { need(n); o += n } return n }
  const count = (n, c) => { if (c < 0 || c > 100000) throw new Error(`${n}: unreasonable count ${c} at ${o}`); return c }
  const slots = (n) => { const c = count(n, i32()); mark(n, c); for (let k = 0; k < c; k++) { i32(); vint() } }
  const ids = (n) => { const c = count(n, i32()); mark(n, c); need(4 * c); o += 4 * c }
  const vslots = (n, f) => { const c = count(n, vint()); mark(n, c); for (let k = 0; k < c; k++) f() }

  mark('missionBits', MISSION_WORDS); o += 4 * MISSION_WORDS
  ids('dataIds22'); slots('achievements'); slots('npcMapProgress'); slots('npcLootedGold'); slots('npcLootedElixir'); slots('npcLootedDarkElixir')
  slots('deployStepDisable'); o += 12; slots('previousHeroMode'); slots('heroMode'); i32(); ids('ints232')
  for (const n of ['previousArmySize', 'friendlyArmySize', 'capitalFriendlyArmySize', 'unitCounterForEvent', 'slots272', 'boosters', 'skins']) slots(n)
  { const c = count('pets', i32()); mark('pets', c); need(8 * c); o += 8 * c }
  i32(); bool(); ids('ids912')
  i32(); str(); str(); i32(); vint() /* sub_A41030 */; i64(); str()
  for (let k = 0; k < 7; k++) vint()
  vslots('dataIds81', () => { i32() })
  vslots('builderBaseSlots', () => { vint(); vint(); i32(); vint(); i32() })
  vslots('pairs464', () => { i32(); i32() })
  if (bool()) throw new Error('object sub_A698AC present: not decoded yet')
  vint() // sub_A41EF8: count of objects (0 in every capture)
  vslots('dataIds488', () => { i32() })
  vslots('characterItemClaimed', () => { i32(); vint() }); vslots('characterItemUpgrade', () => { i32(); i32() }); vslots('characterItemSlot', () => { i32(); vint() }); vslots('characterItemState', () => { i32(); vint() })
  bool(); bool(); vint() /* sub_A412FC */; if (bool()) i64(); i64(); i64(); for (let k = 0; k < 6; k++) bool()
  vslots('homeHeroLineUp', () => { i32() })
  vint(); vslots('allianceUnits2', () => { i32(); vint(); vint() })
  vint(); if (bool()) i64(); vint() /* slot 280 */; i32(); if (bool()) i64(); i64(); i32(); i32(); i64(); for (let k = 0; k < 5; k++) i32()
  mark('avatarEnd')
  // rest of sub_C9122C
  i32(); i32(); const serverTimes = [i64(), i64(), i64()]; i32()
  if (bool()) { for (let k = 0; k < 5; k++) i32(); vint(); vint() }
  ids('trailingIds')
  const w = []; for (let m = 0; m < MISSION_WORDS * 32; m++) w.push(m)
  const bits = w.filter(m => (post.readUInt32BE(start + MISSION_AT + 4 * (m >> 5)) >>> (m & 31)) & 1).length
  return { end: o, sections, missionBits: bits, serverTimes }
}

module.exports = { walk, MISSION_AT, MISSION_WORDS }
