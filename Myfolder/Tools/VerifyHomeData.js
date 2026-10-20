/**
 * Self-test: the readable builders must reproduce the ORIGINAL bytes exactly
 * when given the default values. Run before and after every change:  node Tools/VerifyHomeData.js
 */
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const HomeData = require('../Protocol/HomeData')
const LoginOk = require('../Protocol/LoginOkData')

const originalHome = Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'Data', 'Home', 'original.hex'), 'utf8').trim(), 'hex')
assert(HomeData.build().equals(originalHome), 'OwnHomeData differs from original')
console.log('OK  OwnHomeData default build is byte-identical to the original (' + originalHome.length + ' bytes)')

assert(LoginOk.build().equals(Buffer.from(LoginOk.ORIGINAL, 'hex')), 'LoginOk differs from original')
console.log('OK  LoginOk default build is byte-identical to the original')

// name change must only change the name bytes and nothing else
const renamed = HomeData.build({ name: 'Beta Clash Magic' })
const delta = Buffer.byteLength('Beta Clash Magic') - Buffer.byteLength(HomeData.DEFAULT_NAME)
assert.strictEqual(renamed.length, originalHome.length + delta)
console.log('OK  renamed packet length changes by exactly', delta, 'byte(s)')
console.log('All checks passed.')
