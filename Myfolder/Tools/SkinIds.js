/**
 * SkinIds.js - builds Data/skin_ids.csv from Data/skins.csv
 *   node Tools/SkinIds.js            -> writes the table
 *   node Tools/SkinIds.js king       -> also prints rows whose name/hero/TID contains "king"
 *
 * Rule (standard Supercell CSV rule, same as buildings.csv):
 *   skin id = 52 000 000 + index among the NAMED rows of skins.csv. Rows with an empty Name are extra levels of
 *   the row above and do not get their own id.
 *   (An earlier version of this tool counted blank rows too. That was wrong for every id after the first blank row.)
 * Only ids that exist in the client's skins.csv are safe to send. Unknown ids can crash or kick the client.
 */
const fs = require('fs')
const path = require('path')

const Csv = require('../Protocol/Csv')

const { col, entries } = Csv.entries(fs.readFileSync(path.join(__dirname, '..', 'Data', 'skins.csv'), 'utf8'))
const out = ['id,name,hero,tid,isDefault']
entries.forEach((e, idx) => {
  const r = e.row
  out.push([52000000 + idx, r[col.Name], r[col.Character], r[col.TID], r[col.IsDefaultSkin]].join(','))
})
fs.writeFileSync(path.join(__dirname, '..', 'Data', 'skin_ids.csv'), out.join('\n'))
console.log(`${out.length - 1} skins written to Data/skin_ids.csv`)
const q = (process.argv[2] || '').toLowerCase()
if (q) out.slice(1).filter(l => l.toLowerCase().includes(q)).forEach(l => console.log(l))
