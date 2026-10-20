/**
 * ApplyTurn.js - applies decoded client commands to the village (the server side of "save").
 * Only what was checked against labeled captures (your `mark` runs) is implemented.
 *
 *  5559  MOVE a building   fields [tick, y, buildingId, 0, x]
 *        Confirmed by 3 captures: Barrack (21,28) -> y 32, x 21 | Cannon (24,28) "right only" -> y 28, x 34 |
 *        Cannon "down only" -> y 32, x 34. A move is only saved if the building exists, stays on the map and overlaps nothing.
 *  5048  PLACE a building  body = VInt tick, VInt y, VInt 0, VInt x, int32 data id (e.g. 1000071 = Hero Hall).
 *        The x/y order is ruled by the map: Hero Hall at x=25,y=17 would overlap the Elixir Pump, x=17,y=25 is free.
 *        The new building gets the next id (max + 1), which is the id the client uses for it afterwards.
 *        It needs a "template" (a building of the same type already in the village) for its extra fields. Without one it is NOT
 *        saved, because a building with missing fields can crash the client at login (that happened with a hand-written Hero Hall).
 *        Set options.plain to write only data/id/lvl/x/y anyway.
 *  6338  START an upgrade  fields [tick, 0, 0, buildingId]   (confirmed: "upgraded something without gems" on the Gold Storage)
 *        The village JSON has no field for "upgrade in progress" (none in your default village), so the upgrade is stored as FINISHED:
 *        the building is one level higher after the next login, with no timer. Only with options.upgrades.
 *  5040  (speed up / finish now, probably) is ignored: nothing to store.
 *
 * Resources and gems are not part of the village JSON; they are not tracked here.
 */
const Buildings = require('./BuildingData')
const Turn = require('./Turn')
const { Grid } = require('./Placement')

const MOVE_BUILDING = 5559
const PLACE_BUILDING = 5048
const UPGRADE_START = 6338
const LIMIT = 50 // the default village uses tiles 3..45; the client itself already refuses illegal drops
const BASE_KEYS = ['data', 'id', 'lvl', 'x', 'y']

const clone = (o) => JSON.parse(JSON.stringify(o))

function insideAndFree (village, ignore, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > LIMIT || y + h > LIMIT) return 'is outside the map'
  const others = Object.assign({}, village, { buildings: village.buildings.filter(e => e !== ignore) })
  return new Grid(others).free(x, y, w, h, 0) ? null : 'overlaps another building or obstacle'
}

/** @returns {{changes:string[], rejected:string[]}} mutates `village` for accepted commands */
function applyTurn (village, turn, options = {}) {
  const changes = []; const rejected = []
  for (const cmd of turn.commands) {
    if (cmd.id === MOVE_BUILDING) {
      if (cmd.fields.length !== 5 || cmd.fields.some(f => typeof f !== 'number')) { rejected.push(`move: unexpected fields ${JSON.stringify(cmd.fields)}`); continue }
      const [, y, id, , x] = cmd.fields
      const b = (village.buildings || []).find(e => e.id === id)
      if (!b) { rejected.push(`move: building id ${id} is not in this village`); continue }
      const info = Buildings.info(b.data); const name = info ? info.name : b.data
      if (b.x === x && b.y === y) continue // already there: nothing to change, nothing to save
      const why = insideAndFree(village, b, x, y, info ? info.w : 1, info ? info.h : 1)
      if (why) { rejected.push(`move ${name}: ${x},${y} ${why}`); continue }
      changes.push(`moved ${name} (${id}) from ${b.x},${b.y} to ${x},${y}`)
      b.x = x; b.y = y
    } else if (cmd.id === UPGRADE_START && options.upgrades) {
      if (cmd.fields.length !== 4 || cmd.fields.some(f => typeof f !== 'number')) { rejected.push(`upgrade: unexpected fields ${JSON.stringify(cmd.fields)}`); continue }
      const b = (village.buildings || []).find(e => e.id === cmd.fields[3])
      if (!b) { rejected.push(`upgrade: building id ${cmd.fields[3]} is not in this village`); continue }
      const info = Buildings.info(b.data); const name = info ? info.name : b.data
      if (!info) { rejected.push(`upgrade: building type ${b.data} is not in buildings.csv`); continue }
      if (b.lvl >= info.levels - 1) { rejected.push(`upgrade ${name}: already at the highest level (${b.lvl + 1})`); continue }
      changes.push(`upgraded ${name} (${b.id}) to level ${b.lvl + 2}`)
      b.lvl += 1
    } else if (cmd.id === PLACE_BUILDING) {
      const body = Buffer.from(cmd.hex, 'hex'); let pos = 0; const v = []
      for (let i = 0; i < 4; i++) { const r = Turn.readVInt(body, pos); if (!r) break; v.push(r.value); pos = r.next }
      if (v.length !== 4 || body.length - pos !== 4) { rejected.push(`place: unexpected layout ${cmd.hex}`); continue }
      const [, y, zero, x] = v; const data = body.readInt32BE(pos)
      const info = Buildings.info(data)
      if (zero !== 0 || !info || info.builderBase) { rejected.push(`place: building type ${data} is not a main-village building from buildings.csv`); continue }
      const template = village.buildings.find(b => b.data === data)
      if (!template && !options.plain) { rejected.push(`place ${info.name}: not saved, no building of this type in the village to copy its extra fields from (a missing field can crash the client)`); continue }
      const why = insideAndFree(village, null, x, y, info.w, info.h)
      if (why) { rejected.push(`place ${info.name}: ${x},${y} ${why}`); continue }
      const extra = template ? clone(Object.fromEntries(Object.entries(template).filter(([k]) => !BASE_KEYS.includes(k)))) : {}
      const id = Math.max(499999999, ...village.buildings.map(b => b.id)) + 1
      village.buildings.push({ data, id, lvl: 0, x, y, ...extra })
      changes.push(`placed ${info.name} (${id}) at ${x},${y} (it shows as finished after the next login)`)
    }
  }
  return { changes, rejected }
}

module.exports = { applyTurn, MOVE_BUILDING, PLACE_BUILDING, UPGRADE_START }
