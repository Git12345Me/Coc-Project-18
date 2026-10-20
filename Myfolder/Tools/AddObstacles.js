/**
 * AddObstacles.js - puts obstacles (for example the Clashmas trees) into a village JSON.
 *
 *   node Tools/AddObstacles.js clashmas [in.json] [out.json]
 *   node Tools/AddObstacles.js 8000021,8000028 [in.json] [out.json]      (explicit data ids from obstacles.csv)
 *   node Tools/AddObstacles.js list-clashmas                                (print the trees found in your obstacles.csv)
 *
 * in.json  defaults to Data/Home/village.json (the default village). To combine with the layout converter:
 *   node Tools/ImportExport.js export.json Data/Home/village_from_export.json
 *   node Tools/AddObstacles.js clashmas Data/Home/village_from_export.json Data/Home/village_final.json
 *   node Tools/VillageAdmin.js import <playerId> Data/Home/village_final.json
 *
 * New obstacles get the next free id (503xxxxxx) and a free 2x2 spot in a tidy block, with the real sizes from
 * obstacles.csv. Only ids that exist in obstacles.csv are accepted: an unknown id can crash or kick the client.
 */
const fs = require('fs')
const path = require('path')
const Obstacles = require('../Protocol/ObstacleData')
const VillageCheck = require('../Protocol/VillageCheck')
const { addObstacles, trees, yearOf } = require('../Protocol/VillageEdit')

const [what, inFile = path.join(__dirname, '..', 'Data', 'Home', 'village.json'), outFile = path.join(__dirname, '..', 'Data', 'Home', 'village_with_trees.json')] = process.argv.slice(2)

if (!what) { console.log('usage: see the comment at the top of Tools/AddObstacles.js'); process.exit(1) }
if (what === 'list-clashmas') { trees().forEach(t => console.log(`${t.id}  ${yearOf(t)}  ${t.name}  ${t.w}x${t.h}`)); process.exit(0) }

const ids = what === 'clashmas' ? trees().map(t => t.id) : what.split(',').map(Number)
const v = JSON.parse(fs.readFileSync(inFile, 'utf8'))
let result
try { result = addObstacles(v, ids) } catch (e) { console.log('ERROR ' + e.message); process.exit(1) }
const { errors, warnings } = VillageCheck.check(v)
fs.writeFileSync(outFile, JSON.stringify(v, null, 2))
console.log(`written ${outFile}`)
console.log(`${result.added.length} added:`); result.added.forEach(a => console.log(`  + ${a.name}${a.year ? ' [' + a.year + ']' : ''} at ${a.x},${a.y} id ${a.id}`))
result.skipped.forEach(s => console.log('  skipped: ' + s))
errors.forEach(e => console.log('ERROR ' + e)); warnings.forEach(w => console.log('warn ' + w))
console.log(errors.length ? 'PROBLEMS FOUND, do not import yet' : `checks passed (${v.obstacles.length} obstacles, ids and sizes from your CSVs, no overlaps)`)
console.log('note: the Clashmas tree for 2026 does not exist in this client\'s obstacles.csv (it ends at 2025), so it cannot be added.')
