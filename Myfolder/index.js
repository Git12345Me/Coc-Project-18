console.clear()

const fs = require('fs')
const path = require('path')
const figlet = require('figlet')
const net = require('net')
const MessageFactory = require('./Protocol/MessageFactory')
const Database = require('./Database')
const Commands = require('./Commands')
const Capture = require('./Capture')
const readline = require('readline')
const server = new net.Server()
const Messages = new MessageFactory()
const config = require('./Config')
const PORT = config.Server.Port
const CAPTURE_DIR = path.join(__dirname, 'Captures')

// Unknown client packets are saved here so you can see which message IDs the client really sends
// (alliance create/join/chat, EndClientTurn = village saves, ...). One file per message id.
function capture (message) {
  if (!config.Server.CaptureUnknownPackets) return
  fs.mkdirSync(CAPTURE_DIR, { recursive: true })
  fs.appendFileSync(path.join(CAPTURE_DIR, `${message.id}.hex`), `${new Date().toISOString()} v${message.version} len=${message.len} ${message.payload.toString('hex')}\n`)
}

// Log EVERY incoming packet (also the ones the server already handles) in time order.
// The clan messages may use an id the server already knows, which per-id capture files do not show.
function captureAll (message, known) {
  if (config.Server.CaptureAllPackets) Capture.packet(message, known)
}

async function dispatch (client, message) {
  captureAll(message, !!Messages.handle(message.id))
  if (Messages.handle(message.id)) {
    try {
      const packet = new (Messages.handle(message.id))(message.payload, client)
      if (config.Server.Debug) client.log(`Gotcha ${message.id} (${packet.constructor.name}) packet! `)
      await packet.decode()
      await packet.process()
    } catch (e) {
      console.log(e)
    }
  } else {
    client.log(`Gotcha undefined ${message.id} packet! (${message.len} bytes)`)
    capture(message)
  }
}

server.on('connection', (client) => {
  client.setNoDelay(true)
  client.log = function (text) {
    if (config.Server.Debug && !config.Server.StreamerMode) {
      return console.log(`[${this.remoteAddress.split(':').slice(-1)}] >> ${text}`)
    }
    return console.log(`[*] >> ${text}`)
  }

  client.log('A wild connection appeared!')

  // TCP is a byte stream: one 'data' event can hold half a packet or several packets.
  // Header = id(2) + length(3) + version(2). Collect bytes, cut out complete packets, handle them in order.
  let pending = Buffer.alloc(0)
  let queue = Promise.resolve()

  client.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= 7) {
      const len = pending.readUIntBE(2, 3)
      if (pending.length < 7 + len) break
      const message = {
        id: pending.readUInt16BE(0),
        len,
        version: pending.readUInt16BE(5),
        payload: pending.subarray(7, 7 + len)
      }
      pending = pending.subarray(7 + len)
      queue = queue.then(() => dispatch(client, message))
    }
  })

  client.on('end', () => client.log('Client disconnected.'))

  client.on('error', (error) => {
    try {
      client.log('A wild error!')
      console.log(error)
      client.destroy()
    } catch (e) { }
  })
})

console.log(figlet.textSync('25Clash', { font: 'Slant' }))

Database.init()
  .catch((e) => console.log('[DB] >> could not start MySQL, continuing without it:', e.message))
  .finally(() => {
    server.once('listening', () => console.log(`[SERVER] >> Server started on ${PORT} port!`))
    server.listen(PORT)
    console.log(`[SERVER] >> Build ${config.BUILD} | packet log (Captures/all.log): ${config.Server.CaptureAllPackets ? 'ON' : 'OFF'} | server commands: ${config.Server.Console !== false ? 'ON' : 'OFF'}`)
    if (config.Server.Console !== false) {
      console.log('[SERVER] >> Type "help" here for server commands.')
      readline.createInterface({ input: process.stdin }).on('line', async (line) => (await Commands.run(line)).forEach(l => console.log(l)))
    }
  })

process.on('uncaughtException', e => console.log(e))
process.on('unhandledRejection', e => console.log(e))
