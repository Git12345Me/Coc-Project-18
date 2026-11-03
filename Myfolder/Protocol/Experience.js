/**
 * Experience.js - XP and level of the player (stored in MySQL players.avatar: expLevel, expPoints).
 * v9 rule (ConstructionItem.cs): finishing an upgrade / construction gives  floor(sqrt(build time in seconds))  XP.
 * Level table: Data/experience_levels.csv (copied from v9, levels 1..500: XP needed to leave level N). A level above the table never levels up.
 * The 18.0.5 client has no "add XP" command; XP is the server's job, like in the original game.
 */
const fs = require('fs')
const path = require('path')
const Csv = require('./Csv')

const buildings = Csv.parse(fs.readFileSync(path.join(__dirname, '..', 'Data', 'buildings.csv'), 'utf8'))
const col = Object.fromEntries(buildings[0].map((n, i) => [n, i]))
const rowsOf = [] // [entry index] -> [level rows]
for (const r of buildings.slice(2)) {
  if (!r.length || (r.length === 1 && !r[0])) continue
  if (r[col.Name]) rowsOf.push([r]); else if (rowsOf.length) rowsOf[rowsOf.length - 1].push(r)
}
const need = new Map() // level -> XP needed to reach the next one
for (const r of Csv.parse(fs.readFileSync(path.join(__dirname, '..', 'Data', 'experience_levels.csv'), 'utf8')).slice(2)) if (r.length >= 2 && r[0] !== '') need.set(Number(r[0]), Number(r[1]))

/** Build time in seconds of level `lvl0` (0-based = the level that is being built) of building data id `data`; 0 when unknown. */
function buildSeconds (data, lvl0) {
  const rows = rowsOf[Number(data) - 1000000]; const r = rows && rows[lvl0]
  if (!r) return 0
  const n = (k) => Number(r[col[k]]) || 0
  return n('BuildTimeD') * 86400 + n('BuildTimeH') * 3600 + n('BuildTimeM') * 60 + n('BuildTimeS')
}

/** XP for finishing something that took `seconds` (v9: (int)Math.Pow(seconds, 0.5)). */
const xpFor = (seconds) => Math.floor(Math.sqrt(Math.max(0, seconds)))

/** Adds XP to an avatar object (expLevel is 1-based as shown in game, expPoints = XP inside the level). Returns a NEW avatar object and how many levels were gained. */
function addXp (avatar, xp) {
  const av = Object.assign({}, avatar)
  let level = Number.isInteger(av.expLevel) && av.expLevel >= 1 ? av.expLevel : 1
  let points = (Number.isInteger(av.expPoints) && av.expPoints >= 0 ? av.expPoints : 0) + Math.max(0, Math.floor(xp))
  let gained = 0
  while (need.has(level) && points >= need.get(level)) { points -= need.get(level); level++; gained++ }
  av.expLevel = level; av.expPoints = points
  return { avatar: av, gained }
}

module.exports = { buildSeconds, xpFor, addXp, need }
