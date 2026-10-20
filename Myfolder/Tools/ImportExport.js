/**
 * ImportExport.js - turns a "cnt" layout export (no x, y, id) into the in-game village JSON.
 *
 *   node Tools/ImportExport.js export.json [out.json]
 *   node Tools/VillageAdmin.js import <playerId> out.json      (checks it again, then stores it in MySQL)
 *
 * How it works (all of it follows what the real default village and buildings.csv show):
 *   - starts from the default village, so every other key stays exactly as the client expects
 *   - export "lvl" is 1-based, in-game "lvl" is 0-based  (Town Hall 2 -> lvl 1)
 *   - buildings that already exist in the default village keep their position and extra fields
 *   - missing ones are added: next free id (max + 1), and the first free spot nearest the village centre,
 *     using the real sizes from buildings.csv and obstacles.csv (x,y is the TOP-LEFT tile; checked: the default village has 0 overlaps)
 *   - extra fields (attack_mode..., res_time, units...) are copied from a building of the same type if one exists.
 *     For a type that has none (e.g. Hero Hall) only data/id/lvl/x/y are written. If the client needs more, it crashes:
 *     paste the real entry from a working layout and it can be added as a template.
 *   - builder-base lists and obstacles are NOT changed; differences are only reported.
 */
const fs = require('fs')
const path = require('path')
const HomeData = require('../Protocol/HomeData')
const Buildings = require('../Protocol/BuildingData')
const VillageCheck = require('../Protocol/VillageCheck')
const { Grid, overlaps } = require('../Protocol/Placement')

const [inFile, outFile = path.join(__dirname, '..', 'Data', 'Home', 'village_from_export.json')] = process.argv.slice(2)
if (!inFile) { console.log('usage: node Tools/ImportExport.js export.json [out.json]'); process.exit(1) }
const exp = JSON.parse(fs.readFileSync(inFile, 'utf8'))
const v = HomeData.DEFAULT_VILLAGE()
const notes = []
const BASE = { min: 8, max: 40, cx: 24, cy: 24 } // build area used for NEW buildings, away from the map edge

const size = (d) => { const i = Buildings.info(d); return { w: (i && i.w) || 4, h: (i && i.h) || 4 } }

// 1) what the export wants (main village only)
const wanted = []
for (const e of exp.buildings || []) {
  const info = Buildings.info(e.data)
  if (!info) { notes.push(`ERROR building ${e.data} is not in buildings.csv: skipped (it would crash the client)`); continue }
  if (info.builderBase) { notes.push(`skipped ${info.name} (${e.data}): builder-base building listed in the main list`); continue }
  for (let i = 0; i < (e.cnt || 1); i++) wanted.push({ data: e.data, lvl: Math.max(0, (e.lvl || 1) - 1) })
}

// 2) occupancy of existing buildings and obstacles, with the real sizes from the CSVs
const grid = new Grid(v)
const place = (w, h) => grid.find(w, h, { margin: 1, min: BASE.min, max: BASE.max, near: [BASE.cx, BASE.cy] })

// 3) apply
let nextId = Math.max(...v.buildings.map(b => b.id)) + 1
const used = new Set(); const added = []
for (const w of wanted) {
  const name = Buildings.info(w.data).name
  const existing = v.buildings.find(b => b.data === w.data && !used.has(b))
  if (existing) { used.add(existing); existing.lvl = w.lvl; continue }
  const s = size(w.data); const pos = place(s.w, s.h)
  if (!pos) { notes.push(`ERROR no free spot for ${name} (${s.w}x${s.h}): not added`); continue }
  const template = v.buildings.find(b => b.data === w.data)
  const extra = template ? JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(template).filter(([k]) => !['data', 'id', 'lvl', 'x', 'y'].includes(k))))) : {}
  if (!template) notes.push(`note: no template for ${name} (${w.data}); written with only data/id/lvl/x/y`)
  const entry = { data: w.data, id: nextId++, lvl: w.lvl, x: pos.x, y: pos.y, ...extra }
  v.buildings.push(entry); used.add(entry); added.push(`${name} ${s.w}x${s.h} lvl ${w.lvl} (shows as ${w.lvl + 1}) at ${pos.x},${pos.y} id ${entry.id}`)
}

// 4) report differences we deliberately do not touch
const count = (list) => (list || []).reduce((m, e) => m.set(e.data, (m.get(e.data) || 0) + (e.cnt || 1)), new Map())
for (const [exportKey, villageKey] of [['obstacles', 'obstacles'], ['buildings2', 'buildings2'], ['obstacles2', 'obstacles2']]) {
  const a = count(exp[exportKey]); const b = count(v[villageKey])
  const diff = [...new Set([...a.keys(), ...b.keys()])].filter(k => (a.get(k) || 0) !== (b.get(k) || 0))
  notes.push(diff.length ? `${villageKey}: ${diff.length} type(s) differ from the export and were left as in the default village` : `${villageKey}: same as the export`)
}
if ((exp.heroes || []).length || (exp.skins || []).length) notes.push(`export also lists heroes (${(exp.heroes || []).length}) and skins (${(exp.skins || []).length}); those are not in this JSON and were not converted`)

// 5) final checks
const { errors, warnings } = VillageCheck.check(v)
const overlapList = overlaps(v); overlapList.forEach(o => notes.push('ERROR overlap: ' + o))

fs.writeFileSync(outFile, JSON.stringify(v, null, 2))
console.log(`written ${outFile}`)
console.log(`${v.buildings.length} buildings now; ${added.length} added:`); added.forEach(a => console.log('  + ' + a))
notes.forEach(n => console.log(n)); errors.forEach(e => console.log('ERROR ' + e)); warnings.forEach(w => console.log('warn ' + w))
console.log(`${errors.length + notes.filter(n => n.startsWith('ERROR')).length ? 'PROBLEMS FOUND, do not import yet' : 'checks passed (structure, ids, sizes, no overlaps)'}`)
