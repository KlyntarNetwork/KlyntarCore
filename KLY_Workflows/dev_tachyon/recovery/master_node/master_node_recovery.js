import {server as WebSocketServer} from 'websocket'

import { fileURLToPath } from 'node:url'

import level from 'level'

import http from 'http'

import path from 'path'

import fs from 'fs'




const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const recoveryConfigsPath = path.join(__dirname, 'configs.json')




const {wsNetPort,wsNetInterface,stateDbPath,blocksDbPath} = JSON.parse(fs.readFileSync(recoveryConfigsPath, 'utf8'))


let blocksDB = level(blocksDbPath,{valueEncoding:'json'})

let stateDB = level(stateDbPath,{valueEncoding:'json'})

let localVerificationThread = await stateDB.get('VT')

let epochData = localVerificationThread.EPOCH


console.log(`[*] Local verification thread stats is (index => hash): ${localVerificationThread.LAST_HEIGHT}:${localVerificationThread.LAST_BLOCKHASH}`)
console.log(`[*] Epoch data on verification thread stats is (index => hash): ${epochData.id}:${epochData.hash}`)


let server = http.createServer({},(_,response)=>{

    response.writeHead(404)

    response.end()

})


server.listen(wsNetPort,wsNetInterface,()=>

    console.log(`[*] Websocket server was activated on ${wsNetInterface}:${wsNetPort}`)
    
)


let klyntarWebsocketServer = new WebSocketServer({
    
    httpServer: server,

    autoAcceptConnections: false,

    maxReceivedMessageSize: 1024*1024*50

})



klyntarWebsocketServer.on('request',request=>{

    let connection = request.accept('echo-protocol', request.origin)

    connection.on('message',async message=>{

        if (message.type === 'utf8') {

            let {from, to, route} = JSON.parse(message.utf8Data)

            if(route === 'blocks'){

                let promises = []

                for(let index = from ; index < to ; index++){
    
                    let blockPromise = stateDB.get('SID:'+index).then(blockID => blocksDB.get(blockID)).catch(()=>false)
        
                    promises.push(blockPromise)
    
                }
    
                let blocks = await Promise.all(promises).then(array=>array.filter(Boolean))
    
                connection.sendUTF(JSON.stringify(blocks))
    
            } else if (route === 'epoch_to_epoch_data'){

                let promises = []

                for(let index = from ; index < to ; index++){

                    let epochIndexFrom = index

                    let epochIndexNext = index + 1
    
                    let epochToEpochDataPromise = stateDB.get(`EPOCH_TO_EPOCH_DATA:${epochIndexFrom}:${epochIndexNext}`).catch(()=>false)
                    
                    promises.push(epochToEpochDataPromise)
    
                }
    
                let epochToEpochDatas = await Promise.all(promises).then(array=>array.filter(Boolean))
    
                connection.sendUTF(JSON.stringify(epochToEpochDatas))

            } else connection.close(7331,'No appropraite route')

        } else connection.close(7331,'Wrong message type')
    
    })
    
    connection.on('close',()=>{})

    connection.on('error',()=>{})

})