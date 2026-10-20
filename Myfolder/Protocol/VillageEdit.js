/** Shared village edits (used by the Tools and by the server commands). */
const Obstacles = require('./ObstacleData')
const { Grid } = require('./Placement')

const trees = () => Obstacles.all().filter(o => /CLASHMAS_TREE|XMAS_TREE/.test(o.tid) && !o.builderBase)
const yearOf = (o) => (o.tid.match(/(20\d\d)/) || [])[1]

/**
 * Adds obstacles by data id: next free id (503xxxxxx), a free spot in a block near `near`.
 * Mutates `village`. Unknown ids are refused (they could crash the client).
 */
function addObstacles (village, ids, { near = [14, 34], min = 6, max = 42 } = {}) {
  const bad = ids.filter(i => !Obstacles.has(i))
  if (bad.length) throw new Error('not in obstacles.csv: ' + bad.join(', '))
  village.obstacles = village.obstacles || []
  const grid = new Grid(village)
  let nextId = Math.max(503000000 - 1, ...village.obstacles.map(o => o.id)) + 1
  const added = []; const skipped = []
  for (const data of ids) {
    const info = Obstacles.info(data)
    if (village.obstacles.some(o => o.data === data)) { skipped.push(`${info.name} (already there)`); continue }
    const pos = grid.find(info.w, info.h, { margin: 1, min, max, near })
    if (!pos) { skipped.push(`${info.name} (no free spot)`); continue }
    village.obstacles.push({ data, id: nextId++, x: pos.x, y: pos.y })
    added.push({ data, id: nextId - 1, x: pos.x, y: pos.y, name: info.name, year: yearOf(info) })
  }
  return { added, skipped }
}

module.exports = { addObstacles, trees, yearOf }
