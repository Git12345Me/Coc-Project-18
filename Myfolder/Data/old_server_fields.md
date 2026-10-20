# Player fields of the OLD C# server (version 9.256.12)

Source: your `player.sql` (one row). Only field NAMES and types are kept here; no tokens, passwords, addresses or names.
These are the fields that server stored in the `Avatar` JSON, next to a separate `Trophies` column and the `Village` JSON.
Use them as the target list for the 18.0.5 player block. The byte layout of 18.0.5 is different and is NOT known yet.

| field | type | note |
|---|---|---|
| avatar_id_high | int |  |
| avatar_id_low | int |  |
| alliance_id_high | int |  |
| alliance_id_low | int |  |
| name | str |  |
| region | str |  |
| alliance_name | str |  |
| xp_level | int | experience level |
| xp | int |  |
| wins | int |  |
| loses | int |  |
| games | int |  |
| win_streak | int |  |
| donations | int |  |
| received | int |  |
| shield | int |  |
| guard | int |  |
| score | int | trophies (old system); also stored in the Trophies column |
| duel_score | int | unknown |
| legend_troph | int | legend league trophies |
| league_type | int | index of the league in leagues.csv (21 = Hero1 for 4922 trophies) |
| war_state | bool |  |
| name_state | int |  |
| rank | int |  |
| town_hall_level | int | Town Hall level |
| th_v2_lvl | int | second Town Hall level (builder base?) |
| castle_lvl | int |  |
| castle_total | int |  |
| castle_used | int |  |
| castle_total_sp | int |  |
| castle_used_sp | int |  |
| castle_resource | list of {id/cnt ...} entries |  |
| bookmarks | list of {id/cnt ...} entries |  |
| tutorials | list of {id/cnt ...} entries |  |
| last_search_enemy_id | list of {id/cnt ...} entries |  |
| account_locked | bool |  |
| badge_id | int | clan badge |
| wall_group_id | int |  |
| alliance_role | int | role in the clan |
| alliance_level | int |  |
| units | list of {id/cnt ...} entries | list of {id: 4000xxx, cnt} |
| units2 | list of {id/cnt ...} entries |  |
| spells | list of {id/cnt ...} entries |  |
| alliance_units | list of {id/cnt ...} entries |  |
| alliance_spells | list of {id/cnt ...} entries |  |
| unit_upgrades | list of {id/cnt ...} entries |  |
| spell_upgrades | list of {id/cnt ...} entries |  |
| hero_upgrade | list of {id/cnt ...} entries |  |
| hero_states | list of {id/cnt ...} entries | list of {id: 28000000, cnt} |
| hero_health | list of {id/cnt ...} entries |  |
| hero_modes | list of {id/cnt ...} entries |  |
| resources | list of {id/cnt ...} entries | list of {id: 30000xx, cnt} |
| resources_cap | list of {id/cnt ...} entries |  |
| npcs | list of {id/cnt ...} entries |  |
| variable | list of {id/cnt ...} entries |  |
| debug_mode | list of {id/cnt ...} entries |  |
| login_count | int |  |
| last_tick | str |  |
| last_save | str |  |
| creation_date | str |  |
| ban_date | str |  |
| facebook | object |  |
| google | object |  |
| gamecenter | object |  |
| inbox | object |  |
| achievements | list of {id/cnt ...} entries |  |
| play_time | str |  |

## Old village JSON
Top-level keys: exp_ver, android_client, active_layout, act_l2, war_layout, layout_state, layout_state2, layout_cooldown, buildings, obstacles, traps, decos, vobjs, units, spells, buildings2, obstacles2, traps2, decos2, vobjs2, offer, troop_req_msg, last_league_rank, last_alliance_level, last_league_shuffle, last_season_seen, last_news_seen, war_tutorials_seen, war_base, arr_war_base, account_flags, bool_layout_edit_shown_erase

Differences to the 18.0.5 village JSON: the old buildings carry a `bv` field and `production`; the 18.0.5 default village has neither,
but has many `attack_mode_*` fields. Building DATA IDS are the same in both versions (Troop Housing 1000000, Town Hall 1000001 ...),
so positions and levels carry over, the extra fields do not. The old village has no Spell Forge and no Hero Hall.