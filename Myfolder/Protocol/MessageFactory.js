const fs = require('fs')
const path = require('path')

class MessageFactory {
  constructor () {
    this.packets = {}
    const dir = path.join(__dirname, 'Messages', 'Client') // independent of the working directory
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
      try {
        const Packet = require(path.join(dir, file))
        this.packets[new Packet().id] = Packet // loaded synchronously: no race with the first connection
      } catch (err) {
        console.log(`[SERVER] >> A wild error while initializing "${file}" packet!`)
        console.log(err)
      }
    }
  }

  handle (id) { return this.packets[id] }

  getPackets () { return Object.keys(this.packets) }
}

module.exports = MessageFactory
