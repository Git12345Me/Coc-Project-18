/**
 * Leagues.js - league facts from the client's CSV files.
 *
 * Two systems are in your CSVs:
 *   leagues.csv      OLD system: 23 leagues chosen by TROPHY RANGES (PlacementLimitLow..High). Unranked 0-399 ... Legendary 5000+.
 *   league_tiers.csv NEW 2025 system: 35 tiers (Unranked, Skeleton 3..1, Barbarian ... Super Dragon 1, Legendary), 3 divisions each.
 *                    Promotion/demotion is by percentage inside weekly groups, not by fixed trophy ranges.
 *   league_tier_migrations.csv  per Town Hall: the highest MinTrophies the player reached -> the tier they start in.
 * Checked against a real old-server record: 4922 trophies had league_type 21, and index 21 in leagues.csv is Hero1 (4700-4999).
 * As with all Supercell CSVs, rows with an empty Name are extra levels of the row above (here: per Town Hall), so an
 * index is counted over NAMED rows only.
 */
const fs = require('fs')
const path = require('path')
const Csv = require('./Csv')
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'Data', f), 'utf8')

const old = Csv.entries(read('leagues.csv'))
const oldLeagues = old.entries.map((e, i) => ({ idx: i, name: e.row[old.col.Name], low: Number(e.row[old.col.PlacementLimitLow]), high: Number(e.row[old.col.PlacementLimitHigh]), promote: Number(e.row[old.col.PromoteLimit]), demote: Number(e.row[old.col.DemoteLimit]) }))

const nt = Csv.entries(read('league_tiers.csv'))
const tiers = nt.entries.map((e, i) => ({ idx: i, name: e.row[nt.col.Name], division: Number(e.row[nt.col.Division]), trophyFloor: Number(e.row[nt.col.TrophyFloor]) || 0, topClanScore: Number(e.row[nt.col.TopClanScore]) || 0 }))

const mig = Csv.parse(read('league_tier_migrations.csv')).slice(2).filter(r => r.length >= 4 && r[0] !== '')
  .map(r => ({ townHall: Number(r[1]), minTrophies: Number(r[2]), tier: Number(r[3]) }))

/** OLD system: the league for a trophy count. */
function oldLeague (trophies) {
  const t = Math.max(0, Math.floor(trophies))
  return oldLeagues.find(l => t >= l.low && t <= l.high) || oldLeagues[oldLeagues.length - 1]
}

/** NEW system: starting tier for a Town Hall level and trophy count (null when the table does not cover it). */
function migrate (townHall, trophies) {
  const rows = mig.filter(m => m.townHall === townHall && trophies >= m.minTrophies).sort((a, b) => b.minTrophies - a.minTrophies)
  return rows.length ? tiers[rows[0].tier] : null
}

module.exports = { oldLeagues, tiers, migrations: mig, oldLeague, migrate, tier: (i) => tiers[i] || null }
