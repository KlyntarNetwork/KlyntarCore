import {server as WebSocketServer} from 'websocket'

import { fileURLToPath } from 'node:url'

import level from 'level'

import http from 'http'

import path from 'path'

import fs from 'fs'




const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const recoveryConfigsPath = path.join(__dirname, 'configs.json')




// const {wsNetPort,wsNetInterface,stateDbPath,blocksDbPath} = JSON.parse(fs.readFileSync(recoveryConfigsPath, 'utf8'))