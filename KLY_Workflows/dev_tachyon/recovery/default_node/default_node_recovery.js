import { fileURLToPath } from 'node:url'

import WS from 'websocket'

import level from 'level'

import path from 'path'

import fs from 'fs'




const WebSocketClient = WS.client

const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const recoveryConfigsPath = path.join(__dirname, 'configs.json')




const {checkpointSID, checkpointHash, wsSourceUrl, stateDbPath, blocksDbPath} = JSON.parse(fs.readFileSync(recoveryConfigsPath, 'utf8'))

let blocksToRecoveryDB = level(blocksDbPath+'_RECOVERY',{valueEncoding:'json'})

let stateDB = level(stateDbPath,{valueEncoding:'json'})



let localVerificationThread = await stateDB.get('VT')

let lastBlockHeight = localVerificationThread.SID_TRACKER

console.log(`[*] Local height of verification thread: ${lastBlockHeight}`)

console.log(`[*] Going to load until (index => hash): ${checkpointSID} => ${checkpointHash}`)


let client = new WebSocketClient({

    maxReceivedMessageSize: 1024 * 1024 * 500

})


let currentHeight = 0


client.on('connect', (connection) => {

    const requestNextBatch = async () => {

        const from = currentHeight;
        const to = currentHeight + 100;
    
        connection.sendUTF(JSON.stringify({ from, to }))
    
    }
  
    console.log('Connected to server');


    connection.on('message', async (message) => {
        if (message.type === 'utf8') {
          const blocks = JSON.parse(message.utf8Data);
          
          for (const block of blocks) {
              
              console.log(`Received block: `,block)
              
              currentHeight++;
          
          }
          
          requestNextBatch(); 
        
      }
      
    });

    requestNextBatch()

})


client.on('connectFailed', (error) => {
  
    console.log('Connection failed: ' + error.toString())

})


client.connect(wsSourceUrl, 'echo-protocol')