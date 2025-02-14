import { fileURLToPath } from 'node:url'

import level from 'level'

import path from 'path'

import fs from 'fs'




const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const pruningConfigsPath = path.join(__dirname, 'configs.json')


const {pathToChaindata} = JSON.parse(fs.readFileSync(pruningConfigsPath, 'utf8'))