-- Import in phpMyAdmin (XAMPP) or let the server create it: it runs this file on start.
CREATE DATABASE IF NOT EXISTS bcm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bcm;

CREATE TABLE IF NOT EXISTS players (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,   -- becomes the LowID
  token       CHAR(40)    NOT NULL,
  name        VARCHAR(32) NOT NULL DEFAULT 'Astral',        -- edit freely, packet length is rebuilt
  village     LONGTEXT    NOT NULL,                         -- readable village JSON (edit this)
  village_ok  LONGTEXT    NULL,                             -- last village that did NOT crash the client (automatic)
  trophies    INT         NOT NULL DEFAULT 0,               -- old system: the league follows from trophy ranges (leagues.csv)
  league_tier INT         NOT NULL DEFAULT 0,               -- new 2025 system: index in league_tiers.csv (0 = Unranked)
  created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliances (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(32) NOT NULL,
  description VARCHAR(256) NOT NULL DEFAULT '',
  badge       INT NOT NULL DEFAULT 0,
  leader_id   BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_members (
  alliance_id BIGINT UNSIGNED NOT NULL,
  player_id   BIGINT UNSIGNED NOT NULL,
  role        TINYINT NOT NULL DEFAULT 1,                   -- 1 member, 2 leader, 3 elder, 4 co-leader
  PRIMARY KEY (alliance_id, player_id),
  UNIQUE KEY one_alliance_per_player (player_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_chat (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  alliance_id BIGINT UNSIGNED NOT NULL,
  player_id   BIGINT UNSIGNED NOT NULL,
  message     VARCHAR(256) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY by_alliance (alliance_id, id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- SKINS. Ids follow the client's skins.csv:  id = 52000000 + row number (see Tools/SkinIds.js)
-- skin_catalog is filled by the server on start, so you can read names in phpMyAdmin.
-- player_skins is the place for owned/equipped skins. It is NOT sent to the game yet:
-- the field inside the home-data packet is still being located.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skin_catalog (
  id          INT UNSIGNED PRIMARY KEY,
  name        VARCHAR(64)  NOT NULL,
  hero        VARCHAR(64)  NOT NULL,
  tid         VARCHAR(96)  NOT NULL DEFAULT '',
  is_default  TINYINT(1)   NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_skins (
  player_id   BIGINT UNSIGNED NOT NULL,
  skin_id     INT UNSIGNED    NOT NULL,
  equipped    TINYINT(1)      NOT NULL DEFAULT 0,           -- one equipped skin per hero
  unlocked_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, skin_id),
  KEY by_skin (skin_id)
) ENGINE=InnoDB;
