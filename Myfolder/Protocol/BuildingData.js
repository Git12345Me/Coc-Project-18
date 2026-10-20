/** Building facts from the client's buildings.csv: data id = 1,000,000 + index among NAMED rows. */
const fs = require('fs')
const path = require('path')
const Csv = require('./Csv')
const { col, entries } = Csv.entries(fs.readFileSync(path.join(__dirname, '..', 'Data', 'buildings.csv'), 'utf8'))
const byId = new Map()
entries.forEach((e, i) => {
  const r = e.row
  byId.set(1000000 + i, { id: 1000000 + i, name: r[col.Name], w: Number(r[col.Width]) || 0, h: Number(r[col.Height]) || 0, cls: r[col.BuildingClass], builderBase: r[col.VillageType] !== '', levels: e.levels })
})
module.exports = { info: (id) => byId.get(Number(id)) || null, has: (id) => byId.has(Number(id)), all: () => [...byId.values()] }
