/**
 * Config.js - loads config.json and fills in anything that is missing with defaults.
 * An old config.json (from an earlier version of this package) therefore never silently turns new features off.
 */
const defaults = {
  Server: { Port: 9339, Debug: false, StreamerMode: true, CaptureUnknownPackets: true, CaptureAllPackets: true, Console: true, LogTurns: true, TurnReply: 'all', ApplyCommands: false, InstantUpgrades: false, PlaceWithoutTemplate: false },
  Database: { Enabled: false, SinglePlayerMode: true, Host: '127.0.0.1', Port: 3306, User: 'root', Password: '', Name: 'bcm' }
}
const user = require('./config.json')
const merged = {}
for (const k of new Set([...Object.keys(defaults), ...Object.keys(user)])) {
  merged[k] = (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k])) ? { ...defaults[k], ...(user[k] || {}) } : (user[k] !== undefined ? user[k] : defaults[k])
}
module.exports = merged
module.exports.BUILD = '2026-10-20 trophies+commands'
