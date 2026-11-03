/**
 * DataFiles.js - finds the readable data files of Data/Home.
 *
 * The events file has had several names in this project (events.json -> calendar.json -> oldevents.json).
 * Instead of crashing at start-up when one name is missing, the first existing file of this list is used:
 *   events.json  (explicit choice, always wins)   calendar.json  (the real 18.0.x event calendar)   oldevents.json (old capture)
 * Delete / rename files to choose; the server prints which one it loaded.
 */
const fs = require('fs')
const path = require('path')

const HOME_DIR = path.join(__dirname, '..', 'Data', 'Home')
const EVENT_FILES = ['events.json', 'calendar.json', 'oldevents.json']

/** Absolute path of the events file that exists (first match of EVENT_FILES). Throws a readable error when none exists. */
function eventsFile () {
  for (const name of EVENT_FILES) { const f = path.join(HOME_DIR, name); if (fs.existsSync(f)) return f }
  throw new Error(`no events file in Data/Home (looked for ${EVENT_FILES.join(', ')})`)
}

/** Parsed events JSON ({ events: [...] }). */
const readEvents = () => JSON.parse(fs.readFileSync(eventsFile(), 'utf8'))

module.exports = { HOME_DIR, EVENT_FILES, eventsFile, readEvents }
