/**
 * VillageCheck.js - sanity checks for the in-game village JSON before it is sent to the client.
 * It can only catch structural mistakes. It cannot know the client's CSV rules (sizes, limits, which fields
 * a building needs), so a village that passes can still crash the client. That is what the "last good
 * village" backup in Database/ is for.
 *
 * Layout facts taken from the real default village (Data/Home/village.json):
 *   building  {data:1000001, id:500000000, lvl, x, y, ...extra fields per building type}
 *   obstacle  {data:8000007, id:503000000, x, y}
 *   vobj      {data:39000000, id:508000000, lvl, x, y}
 * ids must be unique inside one village: the main-village lists together, and the builder-base lists (…2) together.
 * (The real default data reuses the same id numbers in both villages, so ids are NOT unique across the whole file.)
 */
const Buildings = require('./BuildingData')
const Obstacles = require('./ObstacleData')
const { overlaps } = require('./Placement')
const LISTS = ['buildings', 'obstacles', 'traps', 'decos', 'vobjs', 'buildings2', 'obstacles2', 'traps2', 'decos2', 'vobjs2']
const TABLE = { buildings: 1, buildings2: 1, obstacles: 8, obstacles2: 8 } // data id / 1,000,000, only where verified
const NEEDS_XY = new Set(['buildings', 'obstacles', 'traps', 'decos', 'buildings2', 'obstacles2', 'traps2', 'decos2'])
const isInt = (n) => Number.isInteger(n)

function check (v) {
  const errors = []; const warnings = []
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { errors: ['village is not a JSON object'], warnings }
  const seenByGroup = { main: new Map(), builder: new Map() }
  for (const list of LISTS) {
    const seen = seenByGroup[list.endsWith('2') ? 'builder' : 'main']
    if (v[list] === undefined) { if (list === 'buildings') errors.push('"buildings" is missing'); continue }
    if (!Array.isArray(v[list])) { errors.push(`"${list}" must be an array`); continue }
    v[list].forEach((e, i) => {
      const at = `${list}[${i}]${e && e.data !== undefined ? ' data=' + e.data : ''}`
      if (!e || typeof e !== 'object') return errors.push(`${at}: not an object`)
      if (!isInt(e.data)) errors.push(`${at}: "data" must be a whole number`)
      if (!isInt(e.id)) errors.push(`${at}: "id" must be a whole number`)
      else if (seen.has(e.id)) errors.push(`${at}: id ${e.id} is already used by ${seen.get(e.id)}`)
      else seen.set(e.id, at)
      if (NEEDS_XY.has(list) && (!isInt(e.x) || !isInt(e.y))) errors.push(`${at}: needs whole-number "x" and "y"`)
      if (TABLE[list] && isInt(e.data) && Math.floor(e.data / 1000000) !== TABLE[list]) errors.push(`${at}: data id belongs to another table (expected ${TABLE[list]}xxxxxx)`)
      // an id the client's own CSV does not have is the classic reason for a crash or a kick
      if (isInt(e.data) && ['buildings', 'buildings2'].includes(list) && !Buildings.has(e.data)) errors.push(`${at}: data id is not in buildings.csv`)
      if (isInt(e.data) && ['obstacles', 'obstacles2'].includes(list) && !Obstacles.has(e.data)) errors.push(`${at}: data id is not in obstacles.csv`)
      if (list === 'buildings' && e.lvl !== undefined && !isInt(e.lvl)) errors.push(`${at}: "lvl" must be a whole number`)
      if (['buildings', 'obstacles'].includes(list) && isInt(e.x) && isInt(e.y) && (e.x < 0 || e.y < 0 || e.x > 50 || e.y > 50)) warnings.push(`${at}: position ${e.x},${e.y} is outside 0..50 (the default village uses 3..45)`)
    })
  }
  // two buildings with the exact same top-left tile can never be right
  const tiles = new Map()
  for (const e of v.buildings || []) {
    if (!e || !isInt(e.x) || !isInt(e.y)) continue
    const k = `${e.x},${e.y}`
    if (tiles.has(k)) warnings.push(`buildings: data=${e.data} and data=${tiles.get(k)} start on the same tile ${k}`)
    else tiles.set(k, e.data)
  }
  // overlaps (real sizes from the CSVs). A warning: the client may still load it, but it is never what the game itself produces.
  for (const builder of [false, true]) overlaps(v, { builder }).forEach(o => warnings.push(`${builder ? 'builder base: ' : ''}${o}`))
  return { errors, warnings }
}

module.exports = { check }
