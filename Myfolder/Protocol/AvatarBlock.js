/**
 * AvatarBlock.js - the variable-length lists inside the avatar block of the login packet (25195).
 *
 * After the player name the block is:
 *   +0 .. +134   fixed int32 fields (level, exp, gems, trophies ... patched in place by HomeData.js)
 *   +135         list A: 17 entries   (int32 count, then count x [int32 data id, VInt value])   values like 4000, 200000: caps
 *   +236         list B:  6 entries   same shape                                              <- CURRENT RESOURCES
 *   +286         list C:  1 entry     4000000 -> 20                                           UNITS: the troops you can attack with (applyArmy)
 *   +295         list D:  spells (empty in the capture)                                       SPELLS (applyArmy)
 *   +299 ...     the rest, kept byte for byte
 *
 * Proof that list B is the resources: the captured player shows gold 999998289 and elixir 999999599 on screen,
 * and list B holds exactly (3000001, 999998289) and (3000002, 999999599).
 * Entries are VInts, so changing a resource changes the length of the block; this module rebuilds the block.
 * Only non-negative values are written (a resource is never negative).
 */
const FIXED = 135 // bytes before list A

// Names for the resource data ids. 3000001 and 3000002 are proven by the screenshot; the rest follow the game's usual numbering.
const RESOURCE_NAMES = {
  gold: 3000001, elixir: 3000002, darkElixir: 3000003, builderGold: 3000007, builderElixir: 3000008
}
const RESOURCE_IDS = new Set(Object.values(RESOURCE_NAMES))

function readVInt (buf, at) {
  let b = buf[at++]
  const neg = (b >> 6) & 1
  let v = b & 0x3f; let shift = 6
  while (b & 0x80) { b = buf[at++]; v += (b & 0x7f) * 2 ** shift; shift += 7 } // `+ * **`: stays exact above 2^31
  return { value: neg ? v - 2 ** shift : v, next: at }
}

function writeVInt (n) {
  if (!Number.isInteger(n) || n < 0 || n > 2147483647) throw new Error('value must be a whole number from 0 to 2147483647')
  const out = []
  let b = n % 64; n = Math.floor(n / 64)
  if (n > 0) b |= 0x80
  out.push(b)
  while (n > 0) { let c = n % 128; n = Math.floor(n / 128); if (n > 0) c |= 0x80; out.push(c) }
  return Buffer.from(out)
}

function readList (buf, at) {
  const count = buf.readInt32BE(at); at += 4
  if (count < 0 || count > 500) throw new Error('unexpected list size ' + count)
  const items = []
  for (let i = 0; i < count; i++) {
    const id = buf.readInt32BE(at); at += 4
    const r = readVInt(buf, at); at = r.next
    items.push([id, r.value])
  }
  return { items, next: at }
}

function writeList (items) {
  const parts = [Buffer.alloc(4)]
  parts[0].writeInt32BE(items.length, 0)
  for (const [id, value] of items) { const i = Buffer.alloc(4); i.writeInt32BE(id, 0); parts.push(i, writeVInt(value)) }
  return Buffer.concat(parts)
}

/**
 * Splits the post-name bytes into { fixed, caps, resources, units, spells, tail }.
 * Order = v9 LogicClientAvatar (Player.cs): resource caps, resources, UNITS (troop counts), SPELLS (spell counts), unit levels ...
 * `units` / `spells` are what the player can bring into an attack. The captured player had units = [4000000 -> 20], spells = [] : that
 * is where the "only 20 barbarians" came from.
 */
function parse (post) {
  const a = readList(post, FIXED)
  const b = readList(post, a.next)
  const c = readList(post, b.next)
  const d = readList(post, c.next)
  const e = readList(post, d.next) // unit levels
  const f = readList(post, e.next) // spell levels
  const g = readList(post, f.next) // hero levels
  return { fixed: post.subarray(0, FIXED), caps: a.items, resources: b.items, units: c.items, spells: d.items, unitLevels: e.items, spellLevels: f.items, heroLevels: g.items, tail: post.subarray(g.next) }
}

function build (parts) {
  return Buffer.concat([parts.fixed, writeList(parts.caps), writeList(parts.resources), writeList(parts.units), writeList(parts.spells), writeList(parts.unitLevels), writeList(parts.spellLevels), writeList(parts.heroLevels), parts.tail])
}

/** The army of the block as { units: { dataId: count }, spells: { dataId: count } }. */
function readArmy (post) {
  const p = parse(post)
  // levels are shown 1-based here; the packet stores them 0-based (v9 Unit_Upgrades: count = level - 1)
  const lv = (items) => Object.fromEntries(items.map(([k, v]) => [k, v + 1]))
  return { units: Object.fromEntries(p.units), spells: Object.fromEntries(p.spells), levels: { units: lv(p.unitLevels), spells: lv(p.spellLevels), heroes: lv(p.heroLevels) } }
}

/**
 * Returns a new post-name block that carries this army. army = { units: { "4000000": 100 }, spells: { "26000000": 2 } }.
 * Troop ids are 4000000-4999999, spell ids 26000000-26999999, hero ids 28000000-28999999. army.levels = { units, spells, heroes } with 1-based levels (a troop that is not listed stays level 1). Invalid entries are skipped and reported in `skipped`.
 * A missing part (units or spells) is left as it is.
 */
function applyArmy (post, army) {
  const p = parse(post)
  const skipped = []
  const clean = (obj, lo, hi, kind) => {
    const out = []
    for (const [k, v] of Object.entries(obj || {})) {
      const id = Number(k)
      if (!Number.isInteger(id) || id < lo || id > hi) { skipped.push(`${k}: not a ${kind} id (${lo}-${hi})`); continue }
      if (!Number.isInteger(v) || v < 0 || v > 2147483647) { skipped.push(`${k}: ${v} is not a whole number from 0 to 2147483647`); continue }
      if (v > 0) out.push([id, v])
    }
    return out.sort((x, y) => x[0] - y[0])
  }
  const levels = (obj, lo, hi, kind) => clean(Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, Number.isInteger(v) ? v : NaN])), lo, hi, kind).map(([id, v]) => [id, v - 1]) // 1-based in, 0-based out
  const next = { ...p }
  const L = army && army.levels
  if (L && L.units && typeof L.units === 'object') next.unitLevels = levels(L.units, 4000000, 4999999, 'troop')
  if (L && L.spells && typeof L.spells === 'object') next.spellLevels = levels(L.spells, 26000000, 26999999, 'spell')
  if (L && L.heroes && typeof L.heroes === 'object') next.heroLevels = levels(L.heroes, 28000000, 28999999, 'hero')
  if (army && army.units && typeof army.units === 'object') next.units = clean(army.units, 4000000, 4999999, 'troop')
  if (army && army.spells && typeof army.spells === 'object') next.spells = clean(army.spells, 26000000, 26999999, 'spell')
  return { post: build(next), skipped }
}

/** The resources of the block as { dataId: amount }. */
function readResources (post) {
  return Object.fromEntries(parse(post).resources)
}

/**
 * Returns a new post-name block whose resource list B has the given amounts.
 * values = { "3000001": 5000, ... } (data id -> amount). Existing entries keep their place; new ids are appended in id order.
 * Invalid entries are skipped and reported in `skipped`.
 */
function applyResources (post, values) {
  const p = parse(post)
  const skipped = []
  const map = new Map(p.resources)
  for (const [k, v] of Object.entries(values || {})) {
    const id = Number(k)
    if (!Number.isInteger(id) || id < 3000000 || id > 3000099) { skipped.push(`${k}: not a resource id (3000000-3000099)`); continue }
    if (!Number.isInteger(v) || v < 0 || v > 2147483647) { skipped.push(`${k}: ${v} is not a whole number from 0 to 2147483647`); continue }
    map.set(id, v)
  }
  const known = new Set(p.resources.map(e => e[0]))
  const items = [...p.resources.map(([id]) => [id, map.get(id)]), ...[...map].filter(([id]) => !known.has(id)).sort((x, y) => x[0] - y[0])]
  return { post: build({ ...p, resources: items }), skipped }
}

module.exports = { FIXED, RESOURCE_NAMES, RESOURCE_IDS, readVInt, writeVInt, parse, build, readResources, applyResources, readArmy, applyArmy }
