/**
 * TownHallBoost.js - the "you reached a new Town Hall" popup (screen dimmed, Town Hall lit up).
 *
 * The village JSON has the field next_th_boost_level. It is 2 in EVERY village file of this project, even the ones
 * with Town Hall 7 and 18, and nothing ever changed it, so (working theory) the game shows the popup at every
 * login because "Town Hall level >= next_th_boost_level". The real server must raise the field after the popup
 * was shown, so it appears once per new Town Hall level.
 *
 * Working theory, NOT proven: test with the server commands  townhall show | seen | replay.
 */
const TOWN_HALL = 1000001 // building data id of the Town Hall (same id HomeData.js uses)

/** Town Hall level as the player sees it (the JSON stores it 0-based), or null when the village has no Town Hall. */
function level (village) {
  const th = ((village && village.buildings) || []).find(b => b.data === TOWN_HALL)
  return th && Number.isInteger(th.lvl) ? th.lvl + 1 : null
}

/** Would the game show the popup at the next login? */
function pending (village) {
  const l = level(village)
  return l !== null && Number(village.next_th_boost_level) <= l
}

/** The popup was shown: the next one waits for the next Town Hall level. Returns true when the village changed. */
function markSeen (village) {
  const l = level(village)
  if (l === null || village.next_th_boost_level === l + 1) return false
  village.next_th_boost_level = l + 1
  return true
}

/** Make the popup show once more at the next login (for testing). */
function replay (village) {
  const l = level(village)
  if (l === null) return false
  village.next_th_boost_level = l
  return true
}

module.exports = { TOWN_HALL, level, pending, markSeen, replay }
