import {client as WebSocketClient} from 'websocket'

import { fileURLToPath } from 'node:url'

import level from 'level'

import path from 'path'

import fs from 'fs'



const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const recoveryConfigsPath = path.join(__dirname, 'configs.json')


// Structure is 

const {checkpointSID, checkpointHash, wsSourceUrl, stateDbPath, blocksDbPath} = JSON.parse(fs.readFileSync(recoveryConfigsPath, 'utf8'))

let blocksDB = level(blocksDbPath,{valueEncoding:'json'})

let stateDB = level(stateDbPath,{valueEncoding:'json'})



// console.log(await stateDB.get('VT'))


// let endpointURL = recoveryConfigs.sourceUrl

// let client = new WebSocketClient({

//     maxReceivedMessageSize: 1024 * 1024 * 500

// })

// client.connect(endpointURL,'echo-protocol')