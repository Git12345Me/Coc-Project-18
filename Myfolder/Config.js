/**
 * Config.js - loads config.json and fills in anything that is missing with defaults.
 * An old config.json (from an earlier version of this package) therefore never silently turns new features off.
 */
const defaults = {
  Server: { Port: 9339, Debug: false, StreamerMode: true, CaptureUnknownPackets: true, CaptureAllPackets: true, Console: true, LogTurns: true, TurnReply: 'search', ApplyCommands: true, InstantUpgrades: true, PlaceWithoutTemplate: false, AllMissionsDone: true, MissionsSeenAreDone: true, TownHallBoostOnce: true, TownHallBoostSeconds: 10 },
  Content: { Enabled: true, StartServer: true, Port: 8081, PublicUrl: 'http://127.0.0.1:8080', EventUrlPath: '/event', ContentUrlPath: '/content', ForceUpdate: true, Dir: 'Data/Content' },
  // Attack screen (see Protocol/BattleSession.js). The opponent is another player of the MySQL table `players`, like v9 (Search_Opponent).
  //   HoldSeconds   how long the chosen opponent stays while the client only sends empty heartbeat turns
  //   TrophyRange   0 = any player; n = prefer opponents within +-n trophies of you (falls back to anybody when none is in range)
  //   RecentEnemies how many last opponents are skipped (v9: Last_Attack_Enemy_ID, 20)
  //   FallbackBot   true = with nobody else in MySQL the built-in practice base is sent; false = nothing is sent
  //   DefaultArmy   "auto" = built from YOUR village (army camps + spell forge capacity, Protocol/Army.js); an object { units, spells, levels } = your own fixed army; null = the captured 20 barbarians
  //   Result        what the server books for a fought attack: "win" | "lose" | "random" (the game does not send its result; v9 also decided itself)
  //   ConsumeArmy   true = the troops / spells you placed are removed from your stored army after the attack (needs training or the army command to refill); false = free army
  //   LootPercent   share (0-100) of the offered gold / elixir / dark elixir you get on a win
  //   ChargeSearch  true = take the search fee (command 8000: resource + cost) from your stored resources, like the game does on the client
  //   TroopLevel / SpellLevel  level (1-based) written for every troop / spell. A level above what the client has for that troop is a risk: raise it step by step (lab level of the real game:
  //                 TH18 troops go up to about 11-12, Healer 9, spells 5-7), or set single levels with the command  army level <name> <n>
  Battle: { HoldSeconds: 60, TrophyRange: 0, RecentEnemies: 20, FallbackBot: true, DefaultArmy: 'auto', Result: 'win', LootPercent: 30, ConsumeArmy: false, ChargeSearch: true, TroopLevel: 9, SpellLevel: 6 },
  Database: { Enabled: false, SinglePlayerMode: true, Host: '127.0.0.1', Port: 3306, User: 'root', Password: '', Name: 'bcm', AutosaveSeconds: 40, SaveDebounceMs: 2000 }
}
const user = require('./config.json')
const merged = {}
for (const k of new Set([...Object.keys(defaults), ...Object.keys(user)])) {
  merged[k] = (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k])) ? { ...defaults[k], ...(user[k] || {}) } : (user[k] !== undefined ? user[k] : defaults[k])
}
module.exports = merged
module.exports.BUILD = '2026-10-30 mysql-opponents+army'
