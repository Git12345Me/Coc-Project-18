/**
 * Skin admin for the MySQL save.  Needs "Database.Enabled": true and MySQL running.
 *   node Tools/SkinAdmin.js list  <playerId>
 *   node Tools/SkinAdmin.js give  <playerId> <skinId> [equip]
 *   node Tools/SkinAdmin.js remove <playerId> <skinId>
 *   node Tools/SkinAdmin.js equip <playerId> <skinId>
 * Look ids up with:  node Tools/SkinIds.js king
 * Default player id (single-player mode) = 1805569
 */
const Database = require('../Database')
const Skins = require('../Protocol/Skins')
;(async () => {
  const [cmd, pid, sid, flag] = process.argv.slice(2)
  if (!cmd || !pid) return console.log('usage: node Tools/SkinAdmin.js list|give|remove|equip <playerId> [skinId] [equip]')
  await Database.init()
  if (!Database.pool) throw new Error('Database is disabled: set "Enabled": true in config.json')
  if (cmd === 'give') await Database.giveSkin(pid, Number(sid), flag === 'equip')
  else if (cmd === 'remove') await Database.removeSkin(pid, Number(sid))
  else if (cmd === 'equip') await Database.equipSkin(pid, Number(sid))
  else if (cmd !== 'list') throw new Error('unknown command ' + cmd)
  const list = await Database.listSkins(pid)
  console.log(list.length ? list.map(s => `${s.id} ${s.name} (${s.hero})${s.equipped ? ' [equipped]' : ''}`).join('\n') : 'no skins stored')
  if (sid && Skins.isValid(sid)) console.log('note: stored in MySQL only; not yet written into the game packet.')
  process.exit(0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
