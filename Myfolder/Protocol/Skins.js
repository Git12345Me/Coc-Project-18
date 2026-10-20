/**
 * Skins.js - skin catalog read from the client's own skins.csv (via Data/skin_ids.csv).
 * Only ids that exist in that CSV are valid: sending an id the client does not know can crash or kick it.
 */
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'Data', 'skin_ids.csv')
if (!fs.existsSync(file)) require('../Tools/SkinIds') // builds the table from Data/skins.csv

const byId = new Map()
for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
  const [id, name, hero, tid, isDefault] = line.split(',')
  if (id) byId.set(Number(id), { id: Number(id), name, hero, tid, isDefault: isDefault.trim() === 'TRUE' })
}

module.exports = {
  all: () => [...byId.values()],
  isValid: (id) => byId.has(Number(id)),
  info: (id) => byId.get(Number(id)) || null,
  sameHero: (id) => { const s = byId.get(Number(id)); return s ? [...byId.values()].filter(x => x.hero === s.hero).map(x => x.id) : [] }
}
