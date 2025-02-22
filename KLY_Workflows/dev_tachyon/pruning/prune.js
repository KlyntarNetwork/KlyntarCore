import {fileURLToPath} from 'node:url'

import level from 'level'

import path from 'path'

import fs from 'fs'




let __filename = fileURLToPath(import.meta.url)

let __dirname = path.dirname(__filename)

let pruningConfigsPath = path.join(__dirname, 'configs.json')

let {pathToChaindata} = JSON.parse(fs.readFileSync(pruningConfigsPath, 'utf8'))


// Get access to our main database and to EVM state db

let stateDB = level(pathToChaindata+'/STATE',{valueEncoding:'json'})

// Extract the VT to get the EVM state root and info about latest epoch

let localVerificationThread = await stateDB.get('VT')

let epochData = localVerificationThread.EPOCH


console.log(`[*] Local verification thread stats is (index => hash): ${localVerificationThread.LAST_HEIGHT}:${localVerificationThread.LAST_BLOCKHASH}`)

console.log(`[*] Epoch data on verification thread stats is (index => hash): ${epochData.id}:${epochData.hash}`)

console.log(`\n[*] ====================== Start iteration over EVM accounts to prune ======================`)


let userAccounts = new Set()

let contractAccounts = new Set()


stateDB.createReadStream().on('data',data=>{

    if(data.key.startswith('EVM_ACCOUNT:')) userAccounts.add(data.key.split(':')[1])

    else if(data.key.startsWith('EVM_CONTRACT_DATA:')) contractAccounts.add(data.key.split(':')[1])

})