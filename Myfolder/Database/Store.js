/**
 * Store.js - the save engine, ported from the working v9 project (Core/Players.cs).
 *
 * v9 works like this, and v18 now works the same way:
 *   1. ONE in-memory object per online player (v9: Players.Levels). Every connection of the same account
 *      shares that object, so two sockets can never overwrite each other with an old copy.
 *   2. The object is written back to MySQL
 *        - right after something changed        (v9: after commands)  -> saveNow(player)
 *        - every 40 seconds for what is dirty    (v9: Timers.Save)     -> autosave
 *        - when the last connection of the player closes (v9: Players.Remove)  -> release(client)
 *        - when the server stops                 (v9: EventsHandler)   -> shutdown()
 *   3. One UPDATE writes everything together (v9: Avatar + Village + Trophies in one SaveChanges).
 *
 * Nothing in here knows about packets. Database/index.js hands in the pool and the row->player converter.
 */
let getPool = () => null
let toPlayer = null
let opts = { autosaveSeconds: 40, debounceMs: 2000 }
let autosaveTimer = null

const cache = new Map() // playerId -> entry
const stats = { saves: 0, failures: 0, lastSaveAt: null, lastError: null }

const log = (text) => console.log('[DB] >> ' + text)

function init ({ pool, convert, autosaveSeconds, debounceMs }) {
  if (pool) getPool = pool
  if (convert) toPlayer = convert
  if (autosaveSeconds !== undefined) opts.autosaveSeconds = Number(autosaveSeconds)
  if (debounceMs !== undefined) opts.debounceMs = Number(debounceMs)
  if (autosaveTimer) clearInterval(autosaveTimer)
  if (opts.autosaveSeconds > 0) {
    // v9 (Timers.Save): every round writes EVERY online player, changed or not, and says so in the console
    autosaveTimer = setInterval(() => {
      saveAll().then(list => {
        if (!list.length) return
        const ok = list.filter(x => !x.error)
        log(`autosave: ${ok.length}/${list.length} online player(s) written to MySQL` + (ok.length ? ' (' + ok.map(x => `${x.name}${x.villageWritten ? '' : ', village NOT written'}`).join('; ') + ')' : ''))
      }).catch(e => log('autosave failed: ' + e.message))
    }, opts.autosaveSeconds * 1000)
    autosaveTimer.unref()
  }
}

const trackable = (player) => !!player && !player.guest && player.id !== undefined && !!getPool()

/** The cache entry of a real (non-guest) player. Created on demand, so saving never depends on who called attach() first. */
function ensure (player) {
  if (!trackable(player)) return null
  let entry = cache.get(player.id)
  if (!entry) {
    entry = { player, clients: new Set(), dirty: false, debounce: null, chain: Promise.resolve(), last: null }
    cache.set(player.id, entry)
  }
  return entry
}

/** The cached player object for an id, or undefined. */
const peek = (id) => { const e = cache.get(Number(id)); return e ? e.player : undefined }

/**
 * Register a connection for a player. Returns the ONE shared object for that account:
 * the already cached one if the account is online, otherwise the object that was passed in.
 */
function attach (player, client) {
  if (!trackable(player)) return player
  const entry = ensure(player)
  if (client) { entry.clients.add(client); client.player = entry.player }
  return entry.player
}

/** Mark as changed; written after a short pause (many small changes become one write). */
function touch (player) {
  const entry = ensure(player)
  if (!entry) return
  entry.dirty = true
  if (entry.debounce) return
  entry.debounce = setTimeout(() => { entry.debounce = null; flushEntry(entry).catch(() => {}) }, opts.debounceMs)
  entry.debounce.unref()
}

/** Mark as changed and write it right now. Throws if MySQL refuses (the entry stays dirty and is retried by autosave). */
async function saveNow (player) {
  const entry = ensure(player)
  if (!entry) throw new Error(!player ? 'no player' : player.guest ? 'this is the guest player (database off or login failed): nothing can be saved' : 'no database connection')
  entry.dirty = true
  await flushEntry(entry)
}

// Writes of one player are queued, so two writes never run at the same time and the newest state always wins.
function flushEntry (entry) {
  const run = entry.chain.then(() => write(entry))
  entry.chain = run.catch(() => {})
  return run
}

async function write (entry) {
  if (!entry.dirty) return false
  const pool = getPool()
  if (!pool) throw new Error('no database connection')
  const p = entry.player
  if (entry.debounce) { clearTimeout(entry.debounce); entry.debounce = null }
  entry.dirty = false // a change that happens while we write sets it again, so it is never lost
  try {
    const avatar = JSON.stringify(p.avatar || {})
    const common = [avatar, Number(p.trophies) || 0, Number(p.leagueTier) || 0, String(p.name || '').slice(0, 32)]
    // A session that runs on the "backup"/"default" village must NOT overwrite the stored (hand-edited) village.
    const withVillage = p.villageSource === 'current' || p.villageSource === undefined
    if (withVillage) {
      const village = JSON.stringify(p.village)
      await pool.execute('UPDATE players SET village = ?, avatar = ?, trophies = ?, league_tier = ?, name = ? WHERE id = ?', [village, ...common, p.id])
      entry.last = { villageWritten: true, bytes: village.length, source: p.villageSource || 'current' }
    } else {
      await pool.execute('UPDATE players SET avatar = ?, trophies = ?, league_tier = ?, name = ? WHERE id = ?', [...common, p.id])
      entry.last = { villageWritten: false, bytes: 0, source: p.villageSource }
      log(`player ${p.id}: the VILLAGE was NOT written because this session runs on the "${p.villageSource}" village, not the stored one (see: village check, village restore)`)
    }
    stats.saves++; stats.lastSaveAt = new Date(); stats.lastError = null
    return true
  } catch (e) {
    entry.dirty = true
    stats.failures++; stats.lastError = e.message
    log(`could not save player ${p.id}: ${e.message} (kept in memory, will retry)`)
    throw e
  }
}

/** Write one player now if it has unsaved changes (used before an admin edit). */
async function flushById (id) {
  const entry = cache.get(Number(id))
  if (entry) await flushEntry(entry)
}

/** Every 40 s: write all players that have unsaved changes. Returns how many were written. */
async function autosave () {
  let n = 0
  for (const entry of [...cache.values()]) {
    if (!entry.dirty) continue
    try { if (await flushEntry(entry)) n++ } catch (e) { continue /* already logged, retried next round */ }
    // a player who disconnected while MySQL was down is kept only until this first successful write
    if (entry.clients.size === 0 && !entry.dirty && cache.get(entry.player.id) === entry) cache.delete(entry.player.id)
  }
  if (n) log(`autosave: ${n} player(s) written to MySQL`)
  return n
}

/**
 * Write EVERY online player now, changed or not (what v9 does every 40 s). Returns one line per player:
 * { id, name, villageWritten, bytes, source } or { id, name, error }.
 */
async function saveAll () {
  const details = []
  for (const entry of [...cache.values()]) {
    const p = entry.player
    entry.dirty = true
    try { await flushEntry(entry); details.push({ id: p.id, name: p.name, ...entry.last }) } catch (e) { details.push({ id: p.id, name: p.name, error: e.message }) }
    if (entry.clients.size === 0 && !entry.dirty && cache.get(p.id) === entry) cache.delete(p.id) // saved on demand for a player nobody is connected as
  }
  return details
}

/** A connection closed. When it was the last one of that player: write and drop from memory (v9: Players.Remove). */
async function release (client) {
  const p = client && client.player
  const entry = p && cache.get(p.id)
  if (!entry || !entry.clients.has(client)) return
  entry.clients.delete(client)
  if (entry.clients.size) return // the account is still online on another connection
  try { await flushEntry(entry) } catch (e) { /* logged; stays in memory below only if dirty */ }
  if (entry.clients.size === 0 && !entry.dirty) { // nobody came back while we were writing
    if (entry.debounce) clearTimeout(entry.debounce)
    cache.delete(p.id)
  } else if (entry.clients.size === 0) {
    log(`player ${p.id} stays in memory: the last save failed (autosave keeps retrying)`)
  }
}

/** After an admin edit wrote straight into MySQL: take the stored values into the online object. */
async function reload (id) {
  const entry = cache.get(Number(id))
  if (!entry) return
  const pool = getPool()
  const [rows] = await pool.execute('SELECT * FROM players WHERE id = ?', [Number(id)])
  if (!rows.length) return
  const fresh = toPlayer(rows[0])
  for (const k of ['token', 'name', 'village', 'villageSource', 'trophies', 'leagueTier', 'avatar']) entry.player[k] = fresh[k]
  entry.dirty = false
}

/** Save everything and stop the timers. Called on Ctrl+C / window close / "stop". */
async function shutdown () {
  if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null }
  let n = 0; let failed = 0
  for (const entry of [...cache.values()]) {
    entry.dirty = true // on shutdown write every online player, changed or not
    try { await flushEntry(entry); n++ } catch (e) { failed++ }
  }
  log(`shutdown: ${n} player(s) saved${failed ? `, ${failed} FAILED` : ''}`)
  return { saved: n, failed }
}

function status () {
  const all = [...cache.values()]
  return { ready: !!getPool(), online: all.length, dirty: all.filter(e => e.dirty).length, ...stats, autosaveSeconds: opts.autosaveSeconds }
}

module.exports = { init, attach, peek, touch, saveNow, flushById, autosave, saveAll, release, reload, shutdown, status, _cache: cache }
