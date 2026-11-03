/**
 * Army.js - which troops, spells and levels a player attacks with.
 *
 *   1. the army stored for the player (players.avatar.army, server command: army ...), each part separately:
 *      a stored `units` list replaces the automatic troops, stored `levels` replace the automatic levels ...
 *   2. otherwise AUTOMATIC from the player's own village (Battle.DefaultArmy = "auto", the default):
 *        troop space  = sum of the Troop Housing (army camp) capacity at their real levels   (Data/buildings.csv, HousingSpace)
 *        spell space  = Spell Forge capacity at its real level                               (Data/buildings.csv, UnitProduction)
 *      so a Town Hall 18 village with 4 maxed camps gets a full army, a Town Hall 5 village a small one.
 *      Levels come from Battle.TroopLevel / Battle.SpellLevel in config.json (1-based; see the note there).
 *   3. Battle.DefaultArmy as an object { units, spells, levels } = your own fixed default
 *   4. Battle.DefaultArmy = null = leave the captured army (20 barbarians) - the old behaviour
 */
const fs = require('fs')
const path = require('path')
const config = require('../Config')

// troop id -> housing space (standard values) and the share of the camp space the automatic army gives it
const RECIPE = [
  { id: 4000009, space: 25, share: 0.20 }, // P.E.K.K.A
  { id: 4000008, space: 20, share: 0.25 }, // Dragon
  { id: 4000003, space: 5, share: 0.15 }, // Giant
  { id: 4000006, space: 4, share: 0.12 }, // Wizard
  { id: 4000007, space: 14, share: 0.08 } // Healer
  // whatever is left over is filled with Barbarians (space 1)
]
const FILLER = 4000000
// spell id -> share of the spell space (every spell takes 1 space here)
const SPELLS = [{ id: 26000001, share: 0.3 }, { id: 26000002, share: 0.4 }, { id: 26000005, share: 0.2 }, { id: 26000000, share: 0.1 }] // healing, rage, freeze, lightning

let table = null
function building (dataId, lvl) {
  if (!table) {
    table = {}
    const lines = fs.readFileSync(path.join(__dirname, '..', 'Data', 'buildings.csv'), 'utf8').split(/\r?\n/)
    const cols = (l) => { const o = []; let c = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = '' } else c += ch } o.push(c); return o }
    const head = cols(lines[0]); const hi = head.indexOf('HousingSpace'); const ui = head.indexOf('UnitProduction')
    let n = -1
    for (const l of lines.slice(2)) {
      if (!l.trim()) continue
      const c = cols(l); if (c[0]) n++ // the id counts NAMED rows only (same rule as Protocol/VillageCheck)
      const id = 1000000 + n; if (!table[id]) table[id] = []
      table[id].push({ housing: Number(c[hi]) || 0, units: Number(c[ui]) || 0 })
    }
  }
  const rows = table[dataId] || []
  return rows[Math.min(Math.max(lvl, 0), rows.length - 1)] || { housing: 0, units: 0 }
}

/** { troops, spells }: how much space the village has (Troop Housing = 1000000, Spell Forge = 1000020). */
function capacity (village) {
  let troops = 0; let spells = 0
  for (const b of (village && village.buildings) || []) {
    if (b.data === 1000000) troops += building(1000000, b.lvl | 0).housing
    else if (b.data === 1000020) spells += building(1000020, b.lvl | 0).units
  }
  return { troops, spells }
}

/** The automatic army for a village: fills the camps and the spell forge, with the levels from config. */
function auto (village) {
  const cap = capacity(village)
  const units = {}; let used = 0
  for (const r of RECIPE) { const n = Math.floor(cap.troops * r.share / r.space); if (n > 0) { units[r.id] = n; used += n * r.space } }
  // the floors leave some space over: hand it out one troop at a time, in the order of the recipe, before falling back to Barbarians
  for (let progress = true; progress;) {
    progress = false
    for (const r of RECIPE) if (cap.troops - used >= r.space) { units[r.id] = (units[r.id] || 0) + 1; used += r.space; progress = true }
  }
  if (cap.troops - used > 0) units[FILLER] = cap.troops - used
  const spells = {}; let su = 0
  for (const s of SPELLS) { const n = Math.floor(cap.spells * s.share); if (n > 0) { spells[s.id] = n; su += n } }
  if (cap.spells - su > 0) spells[SPELLS[1].id] = (spells[SPELLS[1].id] || 0) + cap.spells - su
  const B = config.Battle || {}
  const levels = { units: {}, spells: {}, heroes: {} }
  for (const id of Object.keys(units)) levels.units[id] = Number(B.TroopLevel) || 1
  for (const id of Object.keys(spells)) levels.spells[id] = Number(B.SpellLevel) || 1
  return { units, spells, levels }
}

const has = (o) => o && typeof o === 'object' && Object.keys(o).length > 0
const valid = (a) => a && typeof a === 'object' && (a.units || a.spells || a.levels)

/** @returns {{units: object, spells: object, levels: object}|null} null = keep the captured army */
function effective (player) {
  const B = config.Battle || {}
  let base
  if (B.DefaultArmy === null) base = null
  else if (valid(B.DefaultArmy)) base = B.DefaultArmy
  else base = auto(player && player.village)
  const stored = player && player.avatar && player.avatar.army
  if (!valid(stored)) return base
  const out = { ...(base || {}) }
  if (stored.units) out.units = stored.units
  if (stored.spells) out.spells = stored.spells
  if (has(stored.levels)) out.levels = { units: {}, spells: {}, heroes: {}, ...stored.levels }
  else if (base && base.levels) out.levels = base.levels
  // troops the player added by hand that have no level yet: they get the default level instead of level 1
  if (out.levels && !has(stored.levels)) {
    out.levels = { units: { ...(out.levels.units || {}) }, spells: { ...(out.levels.spells || {}) }, heroes: { ...(out.levels.heroes || {}) } }
    for (const id of Object.keys(out.units || {})) if (!out.levels.units[id]) out.levels.units[id] = Number(B.TroopLevel) || 1
    for (const id of Object.keys(out.spells || {})) if (!out.levels.spells[id]) out.levels.spells[id] = Number(B.SpellLevel) || 1
  }
  return out
}

module.exports = { effective, auto, capacity }
