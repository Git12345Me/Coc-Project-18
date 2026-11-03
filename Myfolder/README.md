# 25Clash
Private server emulator for Clash of Clans 18.0.5 (2025) written on Node.js

## Requirements
* [Node.js](https://nodejs.org)

## Setup
1. Download the repository by zip or type this into the Terminal: `git clone https://github.com/Greedycell/25Clash.git`
2. Go into Command Prompt or Terminal and type `npm install` to build the server.
3. Go into Command Prompt or Terminal and type `node .` to start the server.
4. Now it is finished and you can download my [client](https://mega.nz/folder/02khwBKC#Ev4uzCotilUjdOXAiHaYuw).

## Why does the game have like half the features not working?
This repository is only for testing purposes or you can take the packet structures and make a whole new server, you need to implement all the packets and logic yourself.


![screen](/Screens/game.png)


## Credits
Core created by [tailsjs](https://github.com/tailsjs/nodebrawl-core)   


## Changes in this fork (MySQL / readable data)
1. `npm install`  (now installs `mysql2`; the junk `fs`/`net` npm packages were removed)
2. XAMPP: start **MySQL**. Set `"Database": { "Enabled": true, ... }` in `config.json`. Tables are created on start from `Database/schema.sql`.
3. `node .` to run, `npm test` to prove the readable builders still produce the original bytes.
4. Rename a player: phpMyAdmin -> `bcm.players.name`. Edit the village: `bcm.players.village` (plain JSON).
5. Unknown client packets are written to `Captures/<id>.hex`. Use them to find the alliance / save message IDs.

Readable data lives in `Data/Home/` (village, events, globals JSON). Original hex files are kept in `Tools/original/`.

## Skins (storage ready, not yet sent to the game)
* MySQL tables `skin_catalog` (names from your skins.csv) and `player_skins` (owned / equipped).
* `node Tools/SkinIds.js king` finds ids. `node Tools/SkinAdmin.js give 1805569 52000102 equip` stores one.
* Skin id = 52000000 + index among the NAMED rows of skins.csv (blank-name rows are extra levels and get no id). Only such ids are accepted. `Data/village_export_example.json` is a reference export (different format from the in-game village JSON).
* The field in the home-data packet is still to be located, so the game shows no change yet.

## Village editing safety
* Edit `players.village` (or a file) freely. Before sending, the server checks it (`Protocol/VillageCheck.js`).
  A broken village is NOT sent: the last village that stayed connected 20 s (`players.village_ok`) is used, your edit stays in MySQL.
* `node Tools/VillageAdmin.js check-file my_village.json` checks a file with no database. Also: `export`, `import`, `check`, `restore`, `reset`.
* The check only finds structural mistakes (bad JSON, duplicate ids, missing x/y). It cannot know the client's CSV rules, so a well-formed village can still crash the client; then run `restore`.
* Every packet is logged to `Captures/all.log` (`CaptureAllPackets` in config.json).

## Layout export -> in-game village
* `node Tools/ImportExport.js Data/village_export_th7_herohall.json` writes `Data/Home/village_from_export.json` (TH level 7 + Hero Hall).
* Then `node Tools/VillageAdmin.js import 1805569 Data/Home/village_from_export.json` stores it in MySQL (checks it first).
* Building ids and sizes come from `Data/buildings.csv`: id = 1000000 + index among NAMED rows (rows with a blank name are extra levels).
* Hero Hall has no template, so it is written with only data/id/lvl/x/y. If the client still crashes on login, run `node Tools/VillageAdmin.js restore 1805569`.

## Clashmas trees and other obstacles
* `node Tools/AddObstacles.js list-clashmas` lists the trees in your `obstacles.csv` (2012 to 2025, 14 trees; the CSV has no 2026 tree).
* `node Tools/AddObstacles.js clashmas` -> `Data/Home/village_with_trees.json` (default village + trees).
* Layout + trees together: see the comment at the top of `Tools/AddObstacles.js`; the result is `Data/Home/village_final.json`.
* The village check now also rejects data ids that are not in `buildings.csv` / `obstacles.csv` and warns about overlaps (real sizes).

## Server commands (type them in the server window)
`help`, `players`, `name [id] <name>`, `skin find|list|give|remove|equip`, `trees [clashmas]`, `village check|restore|reset`.
They change the MySQL save; the game shows the change the next time it logs in. Needs `"Database.Enabled": true`.
`Commands/index.js` exposes `run(line)`, so the same commands can later be called from clan chat (`/command`).

## Trophies and leagues
* Two systems are in your CSVs: `leagues.csv` (OLD: 23 leagues from trophy ranges, e.g. Silver 1 = 1200-1399) and `league_tiers.csv` (NEW 2025: 35 tiers, 3 divisions each, promotion by percentage in weekly groups).
  `league_tier_migrations.csv` gives the start tier per Town Hall for the old trophy count.
* MySQL columns `players.trophies` and `players.league_tier` (added automatically to an existing table).
* Commands: `trophies 1234`, `league show`, `league tier 6`, `league old`, `league tiers`. Stored only; not yet sent to the game.

## Finding fields (trophies etc.)
`node Tools/FindNumber.js PlayerProfile 4321` shows where a number sits in a packet (VInt, int32 BE/LE). Open a profile or enemy village in the game, read the numbers it shows, and search them. Self-test: `node Tools/FindNumber.js OwnHomeData 1805569` finds the account id at offset 16.

## Config
`Config.js` fills in missing settings from defaults, so an old `config.json` can never switch new features off. The server prints its build and whether the packet log is ON when it starts.

## Recording what the game sends (do this to find the save packets)
1. Start the server. Check the line `Build ... packet log (Captures/all.log): ON`.
2. Log in with the game. In the SERVER window type `mark moved one building` and press Enter, THEN move one building in the game.
3. Type `mark upgraded the cannon`, then upgrade it. One action per mark.
4. Send `Captures/all.log`. Every packet (known and unknown) is in it, in order, with your marks between.

## Reading a capture
`node Tools/AnalyzeLog.js` summarizes `Captures/all.log`: decodes the ClientHello, shows per-id sizes, and lists what arrived after each `mark`.

## Client patch: send every message as plain bytes
`node Tools/PatchLibg.js libg.so` checks the file, `node Tools/PatchLibg.js libg.so libg_patched.so` writes a patched copy (4 bytes: B.NE -> NOP in the send function). Keep the original as a backup.
By hand: search `88 EE 84 52 1F 00 08 6B 01 01 00 54 77 02 00 34 E8 03 17 2A C0 1E 00 91` (must match once), change `01 01 00 54` into `1F 20 03 D5`.

## What the client sends (decoded so far, 18.0.5 with the send patch)
* `10100` ClientHello: protocol 1, version 18.0.5, 40-char content hash, device/store ints.
* `14309` end of turn: `int tick | int checksum | int commandCount | commands`. Count 0 = heartbeat every ~5 s. Each command = `int id` + VInt fields.
  The server now prints turns with commands (`[turn] ...`); `node Tools/DecodeTurns.js` decodes a whole `Captures/all.log`.
  `Server.TurnReply` in config.json: `"search"` (default: attack screen only when Attack is pressed = command 8000), `"all"` (old: after every turn, breaks battles), `"commands"`, `"none"`.
* `19044` create clan: `string name | string description | 34 bytes (8 ints + 2 bytes)`. Printed as `[clan] create request ...`. No reply yet.
* Command ids seen: 5559 (after "moved one building"), 6338 + 5040 (a pair, on the Town Hall and on the Cannon), 6631 (tick only), 5200, 6595, 6340.
  The meaning of the ids and fields is NOT confirmed. Record more with `mark`.

## Saving a moved building (opt-in, needs the database on)
* In the server window type `apply on`. Move a building in the game, close the game, open it again: the building should be where you put it.
* `apply off` switches it off; `apply status` shows the state. For good, set `"ApplyCommands": true` under `Server` in config.json.
* Only moving a building is applied (command 5559). The field order is inferred from one capture (x=21,y=32 fits, x=32,y=21 would overlap the Troop Housing); a move is only saved if it stays on the map and overlaps nothing.
* If a move ends up in the wrong place: `village restore` in the server window brings back the last village that worked.
* Typing a label for the packet log: `mark upgraded the cannon` (the word `mark` first). `marked ...`, `note ...` and `/mark ...` also work.

## What the labeled captures proved (command ids in 14309)
| id | meaning | fields | status |
|---|---|---|---|
| 5559 | move building | `[tick, y, buildingId, 0, x]` | confirmed (3 captures), saved with `apply on` |
| 5048 | place building | `VInt tick, VInt y, VInt 0, VInt x, int32 building data id` | decoded (Hero Hall, Spell Forge); saved only for types that have a template in the village |
| 6338 | start upgrade | `[tick, 0, 0, buildingId]` | confirmed; stored as finished with `apply upgrades on` (the village JSON has no "upgrading" state) |
| 5040 | speed up / finish now (probably) | `[buildingId, 0 x6, tick]` | ignored |
Switches in the server window: `apply on|off`, `apply upgrades on|off`, `apply unsafe on|off`. Resources and gems are not part of the village JSON and are not saved.

## Old server data (player.sql, C# server 9.256.12)
`Data/old_server_fields.md` lists the player fields that server stored (score = trophies, league_type, xp_level, donations, resources ...), names only.
Confirmed with it: `league_type` is the index in leagues.csv (4922 trophies -> 21 = Hero1). The old village format differs from 18.0.5 (extra fields), data ids are the same.
Clan create: int 1 = badge, int 2 = type (1 open, 2 invite only), confirmed by changing exactly those two settings.

## Clan notes
`Data/clan_notes.md`: v14 C# to Node mapping, the v14 clan messages and entries, and what was tested against the real 18.0.5 packet 25413 (the start fits, the rest does not).

## The player block (trophies, level ...) and the probe command
`Data/avatar_block_notes.md`: the avatar block is identical in the login packet and the profile packet. In the server window:
`probe table` (numbers you can try), `probe 20 777` (change one number at the next login), `probe clear`. Nothing is saved; same packet length.

## Player values and clan in the login packet (new)
The login packet now carries the values stored in MySQL: level, exp, gems, trophies (`players.trophies`), duel trophies, attacks/defenses won (JSON in `players.avatar`),
the Town Hall byte and the clan (tables `alliances` / `alliance_members`). Server window: `avatar show|set|clear`, `trophies <n>`, `clan create <name>`, `clan leave`, `clan list`.
Layout checked on real avatars, see `Data/avatar_block_notes.md`. The league flag and skins are not written yet. A player without stored values gets the original capture, byte for byte.

## Max levels
`node Tools/MaxLevels.js` writes `Data/Home/village_th18_levels.json`: Town Hall 18 and every building already in the village at its top level for that Town Hall (rule from buildings.csv).
It does not add buildings: the counts per Town Hall are in `townhall_levels.csv`, which is not in the project yet.

## Clan capital (not working) and the login log
* Pressing the Clan Capital sends commands inside end-of-turn messages (8030 and 6744 in your capture), no new message id. The server has no capital data to answer with, so the screen keeps spinning.
  Nothing in the v14 project covers the capital (it did not exist then). To find the request: `mark pressed clan capital` in the server window, press it, send `Captures/all.log`.
* `reply none` in the server window stops the automatic EnemyHomeData after every end-of-turn message; use it to test whether those replies change the spinner (the Attack button stops working while it is on). `reply all` restores the original behaviour.
* At login the server prints `[login] sent to "<name>": trophies ..., clan ...` so you can see what was written into the login packet.

## Forced tutorials (capital, pop-ups): missions
Command 8030 is mission progress (ids 21000000 + n). The game reports finished tutorial steps, the server never remembered them, so they restart at every login.
Server window: `apply on` (remembers reported missions in MySQL), `missions show`, `missions all` (EXPERIMENT: marks every mission done in the login packet), `missions normal`.
See `Data/avatar_block_notes.md`.


## MySQL save (v9-style, build 2026-10-29)

The save system now works like the working v9 project (`Core/Players.cs`), written for Node in `Database/Store.js`:

* **One shared player object per online account.** Several connections of the same account (Hello + Login, reconnects) can no longer overwrite each other with an old copy.
* **Written to MySQL:** right after a saved game action (move / place / mission), every 40 s for anything changed (`Database.AutosaveSeconds`), when the last connection of a player closes, and when the server stops (Ctrl+C, closing the window, `stop`).
* **One UPDATE** writes village + avatar values + trophies + league tier + name together.
* **If MySQL goes down** nothing is lost: changes stay in memory and are written as soon as it is back.
* **Server commands** you edit the save with (`trophies`, `avatar set`, `village reset` ...) are no longer overwritten by an online player's older values.
* New commands: `save` (write now + status), `stop` (save + exit), `top [n]` (trophy ranking).
* `config.json` now ships with `Database.Enabled: true` and `Server.ApplyCommands: true` (before, nothing was ever written).
* Test without MySQL: `npm run test:save`.


## Notification badges and clan decode (build 2026-10-29, part 2)

* `badges show` / `badges clear` (server window): the Shop's "new item" counters are stored in the village JSON (`newShopBuildings/Traps/Decos`). `badges clear` sets them to 0 in MySQL so you can test whether the Shop badge comes from there. Undo: `village restore`.
  The game also sends "seen" commands (opening the Shop, news ...) inside end-of-turn messages; the server does not understand their ids yet, so it never clears anything by itself. To decode them: `mark opened the shop`, open and close the Shop, then look at Captures/all.log.
* `node Tools/DecodeClan.js` decodes the real 18.0.5 clan packet in the project. Findings and open questions: `Data/clan_packet_25413.md`.


## Town Hall boost popup (build 2026-10-29, part 3)

The popup "new Town Hall reached" (screen dimmed, Town Hall lit) came at every login. Working theory (not proven): the village JSON field `next_th_boost_level` was 2 in every village, so "Town Hall level >= next_th_boost_level" was always true. `Server.TownHallBoostOnce` (default true) counts the popup as shown once the player stayed online 20 s and stores `next_th_boost_level = Town Hall level + 1` in MySQL, so it appears once per new Town Hall level.
Test commands: `townhall show`, `townhall seen`, `townhall replay`. Code: `Protocol/TownHallBoost.js`.


## Avatar data: resources + a map of what lives where (build 2026-10-29, part 4)

* `resources show|set|clear` (server window): gold, elixir, builder gold/elixir (and dark elixir as a new entry) are stored in `players.avatar.resources` and written into the login packet. The lists are variable length, so `Protocol/AvatarBlock.js` rebuilds the block (checked: the captured block parses and rebuilds byte for byte).
* `vjson show|set`: view/edit any EXISTING key of the village JSON (Gold Pass = `battlepass`, magic items = `consumable`, army = `active_army_loadout` ...). Same type only, checked, undo with `village restore`.
* `Data/where_is_what_18_0_5.md`: what lives in the avatar block and what in the village JSON, what is saved, what is sent, what is still unknown.


## Save fix (build 2026-10-29, part 5): why "save" and autosave looked dead

* The save engine is now started when the database module loads (before MySQL start-up), so a failing optional start-up step (trophy index, skin list) can no longer leave it switched off. If a step that saving really needs fails, the server now runs WITHOUT MySQL instead of half working.
* A real player is saved even if nothing attached him to the cache first (before: "not tracked" error).
* Autosave (every `Database.AutosaveSeconds`, 40) and the `save` command now write EVERY online player, like v9, and print a line each time: `[DB] >> autosave: 1/1 online player(s) written to MySQL (name)`. Before, only players marked "changed" were written and nothing was printed when there were none.
* `save` reads the row back from MySQL and prints `same as memory: YES/NO`, the Town Hall level and `next_th_boost_level`. With nobody online it says so.
* A session that runs on the "backup"/"default" village does not write the village (so a broken stored village is not overwritten). This is now announced at login and in `save` instead of being silent.
* Town Hall popup: counted as shown after `Server.TownHallBoostSeconds` (10) online. The console prints `popup is pending ...` at login and `... counted as shown and SAVED` after.
* Test: `npm run test:save` (44 checks; the stand-in database now rejects columns that are not in `schema.sql`).


## Saving needs no typing any more (build 2026-10-29, part 6)

* `Server.ApplyCommands` and `Server.InstantUpgrades` now default to **true** (in `Config.js` and `config.json`). Before, a config.json without those keys (the original has none) started with both OFF, so every restart you had to type `apply on` and `apply upgrades on`, and without them the server never learned about a move or an upgrade (autosave and `save` can only write what the server knows).
* The start-up line `game actions are saved to MySQL: moves/placing ON, upgrades stored as finished ON` shows the state. `apply upgrade on` (singular) is accepted too.
* How an upgrade is saved: the game sends command 6338 `[tick, 0, 0, buildingId]` inside the end-of-turn message (14309). The server checks the building exists and is below its maximum level (`buildings.csv`), applies it to a COPY of the village, runs `VillageCheck`, and only then replaces the live village and writes it to MySQL. The village JSON has no field for "upgrade in progress", so the upgrade is stored as finished: at the next login the building is one level higher with no timer, in the same JSON format the game always loads. Resources are not deducted and a cancelled upgrade is not noticed.
* A result that fails the check is no longer kept in memory (before, the autosave could have written it).

## Attack screen = another player (v9 behaviour), your own army
* The village you attack is a row of the MySQL table `players` (never yourself, never your last 20 opponents), like v9 `Search_Opponent`. `Data/EnemyHome/*` and `Protocol/EnemyHomeData.js` are gone; nothing reads them any more.
* Opponents: real players in the table, or `bot add <name> [village file]` (e.g. `bot add Dummy Data/Home/village.json`). With nobody else in MySQL the built-in practice base (your `Data/Home/village.json`) is used (`Battle.FallbackBot`).
* Your troops/spells are no longer the fixed "20 barbarians": `army set barbarian 100`, `army spell lightning 4`, `army show`. Without an own army `Battle.DefaultArmy` (config.json) is used. The same list goes into the login packet and the attack packet.
* `Battle` settings in config.json: `HoldSeconds`, `TrophyRange`, `RecentEnemies`, `FallbackBot`, `DefaultArmy`.
* `npm test` checks all of this with a stand-in MySQL (no game, no database needed).
* Events: `Data/Home/events.json`, else `calendar.json`, else `oldevents.json` is loaded (`Protocol/DataFiles.js`).

### Army levels and size (no fixed list any more)
* Without an own army the attack army is built from your village: army camp space + Spell Forge capacity at their real levels (`Protocol/Army.js`, `Data/buildings.csv`). A TH18 village with 4 camps gets 340 troop space filled with P.E.K.K.A, Dragons, Giants, Wizards, Healers.
* Levels: `Battle.TroopLevel` / `Battle.SpellLevel` in config.json (default 9 / 6), or per unit: `army level dragon 11`, `army level all 10`, `army level king 60`. They are written into the unit/spell/hero level lists of the login and attack packets.
* Raise levels step by step: a level the client does not have for that troop can break the attack screen (`army clear` undoes it).

### End of an attack (from the capture of 2026-10-30)
Attack pressed = command 8000, troops = 7408, END OF BATTLE = 7662 (tick only), then message 10936 (go home). The game sends no loot/stars/destruction, so the server books a result itself when you come home (`Protocol/BattleResult.js`, like v9's Go_Home):
`Battle.Result` ("win" default | "lose" | "random") and `Battle.LootPercent` (default 30) in config.json. Booked and saved to MySQL: your resources (gold / elixir / dark elixir), trophies, attacks won; the enemy's resources, trophies, defenses won (not for `bot add` opponents). The amounts are NOT the ones the game showed during the fight.
