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
  `Server.TurnReply` in config.json: `"all"` (default, original behaviour: EnemyHomeData after every turn), `"commands"`, `"none"`.
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
