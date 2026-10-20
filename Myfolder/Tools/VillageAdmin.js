/**
 * Village admin. Edit the village in a FILE, check it, then load it into MySQL.
 *
 *   node Tools/VillageAdmin.js check-file  my_village.json         (no database needed)
 *   node Tools/VillageAdmin.js export  <playerId> my_village.json  (MySQL -> readable file)
 *   node Tools/VillageAdmin.js import  <playerId> my_village.json  (file -> MySQL, refused if it has errors)
 *   node Tools/VillageAdmin.js check   <playerId>                   (check what is stored now)
 *   node Tools/VillageAdmin.js restore <playerId>                   (go back to the last village that worked)
 *   node Tools/VillageAdmin.js reset   <playerId>                   (original default village)
 * Default player id (single-player mode) = 1805569
 */
const fs = require('fs')
const Database = require('../Database')
const HomeData = require('../Protocol/HomeData')
const VillageCheck = require('../Protocol/VillageCheck')

function report (v) {
  const { errors, warnings } = VillageCheck.check(v)
  errors.slice(0, 25).forEach(e => console.log('ERROR  ' + e))
  if (errors.length > 25) console.log(`... and ${errors.length - 25} more errors`)
  warnings.slice(0, 25).forEach(w => console.log('warn   ' + w))
  const n = (k) => (v && Array.isArray(v[k]) ? v[k].length : 0)
  console.log(`${n('buildings')} buildings, ${n('obstacles')} obstacles, ${n('traps')} traps, ${n('decos')} decos -> ${errors.length} error(s), ${warnings.length} warning(s)`)
  return errors.length === 0
}

;(async () => {
  const [cmd, a, b] = process.argv.slice(2)
  if (cmd === 'check-file' && a) {
    let v; try { v = JSON.parse(fs.readFileSync(a, 'utf8')) } catch (e) { console.log('ERROR  invalid JSON: ' + e.message); process.exit(1) }
    process.exit(report(v) ? 0 : 1)
  }
  if (!['export', 'import', 'check', 'restore', 'reset'].includes(cmd) || !a) {
    console.log('usage: see the comment at the top of Tools/VillageAdmin.js'); process.exit(1)
  }
  await Database.init()
  const pool = Database.pool
  if (!pool) throw new Error('Database is disabled: set "Enabled": true in config.json')
  const [rows] = await pool.execute('SELECT village, village_ok FROM players WHERE id = ?', [a])
  if (!rows.length) throw new Error(`player ${a} does not exist (log in once first)`)
  const row = rows[0]
  if (cmd === 'check') { let v; try { v = JSON.parse(row.village) } catch (e) { console.log('ERROR  invalid JSON: ' + e.message); process.exit(1) } process.exit(report(v) ? 0 : 1) }
  if (cmd === 'export') { fs.writeFileSync(b, JSON.stringify(JSON.parse(row.village), null, 2)); console.log('written ' + b) }
  if (cmd === 'import') {
    const v = JSON.parse(fs.readFileSync(b, 'utf8'))
    if (!report(v)) throw new Error('not imported: fix the errors above first')
    await pool.execute('UPDATE players SET village = ? WHERE id = ?', [JSON.stringify(v), a]); console.log('imported. Log in again to see it.')
  }
  if (cmd === 'restore') {
    if (!row.village_ok) throw new Error('no backup yet: a village is saved as "good" after the client stayed connected for 20 s')
    await pool.execute('UPDATE players SET village = ? WHERE id = ?', [row.village_ok, a]); console.log('restored the last good village')
  }
  if (cmd === 'reset') { await pool.execute('UPDATE players SET village = ? WHERE id = ?', [JSON.stringify(HomeData.DEFAULT_VILLAGE()), a]); console.log('village reset to the default') }
  process.exit(0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
