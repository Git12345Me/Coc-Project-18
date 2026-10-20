/** Obstacle facts from the client's obstacles.csv: data id = 8,000,000 + index among NAMED rows. */
const fs = require('fs')
const path = require('path')
const Csv = require('./Csv')
const { col, entries } = Csv.entries(fs.readFileSync(path.join(__dirname, '..', 'Data', 'obstacles.csv'), 'utf8'))
const byId = new Map()
entries.forEach((e, i) => {
  const r = e.row
  byId.set(8000000 + i, { id: 8000000 + i, name: r[col.Name], tid: r[col.TID], w: Number(r[col.Width]) || 1, h: Number(r[col.Height]) || 1, builderBase: r[col.VillageType] !== '' })
})
module.exports = { info: (id) => byId.get(Number(id)) || null, has: (id) => byId.has(Number(id)), all: () => [...byId.values()] }
