/**
 * Placement.js - tile occupancy for a village, using the real sizes from buildings.csv / obstacles.csv.
 * x,y = top-left tile. Verified on the real default village: 63 main objects and 98 builder-base objects, 0 overlaps.
 */
const Buildings = require('./BuildingData')
const Obstacles = require('./ObstacleData')

class Grid {
  constructor (village, { builder = false } = {}) {
    this.occ = new Set()
    for (const [list, info] of [[village[builder ? 'buildings2' : 'buildings'], Buildings], [village[builder ? 'obstacles2' : 'obstacles'], Obstacles]]) {
      for (const e of list || []) {
        const i = info.info(e.data)
        if (i && Number.isInteger(e.x) && Number.isInteger(e.y)) this.mark(e.x, e.y, i.w, i.h)
      }
    }
  }

  mark (x, y, w, h) { for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) this.occ.add(`${x + dx},${y + dy}`) }

  free (x, y, w, h, margin = 0) {
    for (let dx = -margin; dx < w + margin; dx++) for (let dy = -margin; dy < h + margin; dy++) if (this.occ.has(`${x + dx},${y + dy}`)) return false
    return true
  }

  /** First free spot nearest to `near`, inside min..max. Marks it as used. Returns {x,y} or null. */
  find (w, h, { margin = 1, min = 8, max = 40, near = [24, 24] } = {}) {
    const spots = []
    for (let x = min; x + w <= max; x++) for (let y = min; y + h <= max; y++) spots.push([x, y])
    const d = ([x, y]) => Math.hypot(x + w / 2 - near[0], y + h / 2 - near[1])
    spots.sort((a, b) => d(a) - d(b))
    for (const [x, y] of spots) if (this.free(x, y, w, h, margin)) { this.mark(x, y, w, h); return { x, y } }
    return null
  }
}

/** All overlaps between buildings/obstacles of one village, as readable strings. */
function overlaps (village, { builder = false } = {}) {
  const out = []; const cells = new Map()
  for (const [list, info] of [[village[builder ? 'buildings2' : 'buildings'], Buildings], [village[builder ? 'obstacles2' : 'obstacles'], Obstacles]]) {
    for (const e of list || []) {
      const i = info.info(e.data)
      if (!i || !Number.isInteger(e.x) || !Number.isInteger(e.y)) continue
      let hit = null
      for (let dx = 0; dx < i.w && !hit; dx++) for (let dy = 0; dy < i.h && !hit; dy++) { const o = cells.get(`${e.x + dx},${e.y + dy}`); if (o && o !== e) hit = o }
      if (hit) out.push(`${i.name} at ${e.x},${e.y} overlaps data=${hit.data} at ${hit.x},${hit.y}`)
      for (let dx = 0; dx < i.w; dx++) for (let dy = 0; dy < i.h; dy++) cells.set(`${e.x + dx},${e.y + dy}`, e)
    }
  }
  return out
}

module.exports = { Grid, overlaps }
