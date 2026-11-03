const PiranhaMessage = require('../../PiranhaMessage')
const BattleSession = require('../../BattleSession')

/**
 * 21940 = the attack screen: the village you attack + the enemy player + YOU (your army).
 * The enemy is another player of the MySQL table `players` (v9 behaviour), see Protocol/BattleSession.js and Protocol/BattleData.js.
 * opts.search = true: choose a new opponent now (a turn that carried a command); false: keep the current one (heartbeat).
 */
class EnemyHomeDataMessage extends PiranhaMessage {
  constructor (client, opts = {}) {
    super()
    this.id = 21940
    this.client = client
    this.version = 1
    this.search = opts.search === true
  }

  async send () {
    this.payload = await BattleSession.payload(this.client, this.search)
    if (!this.payload) return // nobody to attack and Battle.FallbackBot is off
    return super.send()
  }

  async encode () {
    this.writeHex(this.payload.toString('hex'))
  }
}

module.exports = EnemyHomeDataMessage
