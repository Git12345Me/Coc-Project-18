const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 17120 = client message, group 74, body = TWO bit-packed bools (byte 03 = both true). IDA: type sub_C92EAC, encode sub_C92E18
 * (writes the bool at +137 first, then +136), decode sub_C92E5C. Sent when the clan capital is opened, so it is most likely
 * "go to own alliance district" (its failure answer is 22678 GoOwnAllianceDistrictFailed, its success answer 27003
 * VisitedAllianceDistrictData with the capital layout JSON - see Data/Capital/). The reply is not written yet: it is only logged.
 */
class UnknownClient17120Message extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 17120
    this.version = 0
  }

  async decode () {
    const b = this.buffer && this.buffer.length ? this.buffer[0] : 0
    this.flags = { first: (b & 1) === 1, second: (b & 2) === 2 }
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[capital] open request (17120): bool1=${this.flags.first} bool2=${this.flags.second} - no reply yet (needs 27003, layout of Data/Capital)`)
  }
}

module.exports = UnknownClient17120Message
