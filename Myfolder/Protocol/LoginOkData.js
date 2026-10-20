/**
 * LoginOkData.js
 * Same idea for LoginOk (23654): account ids and token become parameters,
 * everything else stays the original bytes.
 *
 * Original layout: int32 high | int32 low | int32 high | int32 low | string token | rest
 */
const ORIGINAL = '00000000001b8d0100000000001b8d010000002866386e6e6973766537626662756861646d7a367166337a7862746132646b75316464386e69763238ffffffffffffffff000000120000000000000008000000027332000000020000003800000000000000013fffffffff0000000d3137373230303335303637363300000000ffffffff000000024155ffffffff00000001ffffffffffffffffffffffff000000010000002668747470733a2f2f63646e2e636c6173686f666d616769632e6e65742f6173736574732f7332000000010000002568747470733a2f2f6576656e742d6173736574732e636c6173686f66636c616e732e636f6d000000ec14010000789c158ecb6e83301444bfa811cfb62c239c2053ae911bb0b1375579051b50894ae598afafbc9cd168ce196cee0dcd59952aff603e55459a4f6dd6b98ceb032292e25fbcee9b4cf12b5ee50c88cd82135df0eb4202b1137455f2e6c5a4aa6d515d22a12fb144e280000ca83c390d3637df9caa5261e306806a9fe8d9814cef4e15a19c2d007317b19b83f553cb6b27b00bde6fc2ba8efdf5ca09f8930c165d3460b1324a3693c1fae7498ece42d58580eede484fc0b6271eecf09652c3f068ca41f8e33d3348c7fb4b983cd65acedacf32dd7e350f9a44671aa6c50cef78f5f9a7499a7f35245d1e01000000001c68747470733a2f2f7777772e636c6173686f666d616769632e696f2fffffffff0000ffffffff'

const orig = Buffer.from(ORIGINAL, 'hex')
const tokenLen = orig.readUInt32BE(16)
const DEFAULT_TOKEN = orig.subarray(20, 20 + tokenLen).toString('utf8')
const DEFAULT_HIGH = orig.readInt32BE(0)
const DEFAULT_LOW = orig.readInt32BE(4)
const REST = orig.subarray(20 + tokenLen)

function build ({ high = DEFAULT_HIGH, low = DEFAULT_LOW, token = DEFAULT_TOKEN } = {}) {
  const t = Buffer.from(token, 'utf8')
  const head = Buffer.alloc(16)
  head.writeInt32BE(high, 0); head.writeInt32BE(low, 4)
  head.writeInt32BE(high, 8); head.writeInt32BE(low, 12)
  const len = Buffer.alloc(4); len.writeUInt32BE(t.length, 0)
  return Buffer.concat([head, len, t, REST])
}

module.exports = { build, DEFAULT_TOKEN, DEFAULT_HIGH, DEFAULT_LOW, ORIGINAL }
