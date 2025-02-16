import { fileURLToPath } from 'node:url'

import WS from 'websocket'

import level from 'level'

import path from 'path'

import fs from 'fs'




const WebSocketClient = WS.client

const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const recoveryConfigsPath = path.join(__dirname, 'configs.json')




const {loadUpToHeight, loadUpToHash, loadUpToEpochIndex, wsSourceUrl, stateDbPath, blocksDbPath} = JSON.parse(fs.readFileSync(recoveryConfigsPath, 'utf8'))


let stateDB = level(stateDbPath,{valueEncoding:'json'})

let blocksToRecoveryDB = level(blocksDbPath+'_RECOVERY',{valueEncoding:'json'})

let stateRecoveryDB = level(stateDbPath+'_RECOVERY',{valueEncoding:'json'})



let localVerificationThread = await stateDB.get('VT')


/*

We need to load extra data from external source of recovery

[1] Blocks untill the height of point of recovery
[2] Epoch-to-epoch data

*/

let loadedUpToHeightBlocks = await blocksToRecoveryDB.get('LAST_LOADED_BLOCK').catch(()=>localVerificationThread.LAST_HEIGHT)

let loadedUpToEpochIndex = await stateRecoveryDB.get('LAST_EPOCH_INDEX').catch(()=>localVerificationThread.EPOCH.id)




console.log(`[*] Local verified height (up to height): ${localVerificationThread.LAST_HEIGHT}`)
console.log(`[*] Locally loaded blocks (up to height): ${loadedUpToHeightBlocks}`)

console.log(`[*] Going to load blocks until (index => hash): ${loadUpToHeight} => ${loadUpToHash}`)
console.log(`[*] Going to load epoch-to-epoch data until epoch index: ${loadUpToEpochIndex}`)



let client = new WebSocketClient({ maxReceivedMessageSize: 1024 * 1024 * 500 })



client.on('connect', (connection) => {

    const requestNextBatchOfBlocks = async () => {

        const from = loadedUpToHeightBlocks

        const to = loadedUpToHeightBlocks + 100
    
        connection.sendUTF(JSON.stringify({ from, to, route: 'blocks' }))
    
    }

    const requestNextBatchOfEpochToEpochData = async () => {

        const from = loadedUpToEpochIndex

        const to = loadedUpToEpochIndex + 100
    
        connection.sendUTF(JSON.stringify({ from, to, route: 'epoch_to_epoch_data' }))
    
    }
  
    console.log('[*] Connected to server')

    connection.on('message', async (message) => {
        
        if (message.type === 'utf8') {

            let parsedData = JSON.parse(message.utf8Data)

            if(parsedData.route === 'blocks'){

                const blocks = parsedData.blocks
          
                for (const block of blocks) {
                    
                    console.log(`Received block: `,block)
                    
                    loadedUpToHeightBlocks++;
                
                }
                
                requestNextBatchOfBlocks();       

            } else if(parsedData.route === 'epoch_to_epoch_data'){

                const epochToEpochDatas = parsedData.epochToEpochDatas
          
                for (const epochData of epochToEpochDatas) {
                    
                    console.log(`Received epoch data: `,epochData)
                    
                    loadedUpToEpochIndex++
                
                }
                
                requestNextBatchOfEpochToEpochData();

            }
                
        }
      
    });

    requestNextBatchOfBlocks()

    requestNextBatchOfEpochToEpochData()

})


client.on('connectFailed', (error) => {
  
    console.log('Connection failed: ' + error.toString())

})


client.connect(wsSourceUrl, 'echo-protocol')