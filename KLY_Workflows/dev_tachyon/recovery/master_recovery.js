// import { customLog, logColors } from '../../../KLY_Utils/utils.js'

import WS from 'websocket'

import http from 'http'




let WebSocketServer = WS.server

let server = http.createServer({},(_,response)=>{

    response.writeHead(404)

    response.end()

})

let netPort = 8999
let netInterface = '::'



server.listen(netPort,netInterface,()=>

    console.log(`[*] Websocket server was activated on ${netInterface}:${netPort}`)
    
)


let klyntarWebsocketServer = new WebSocketServer({
    
    httpServer: server,

    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false,

    maxReceivedMessageSize: 1024*1024*50 // 50 Mb

})



klyntarWebsocketServer.on('request',request=>{

    let connection = request.accept('echo-protocol', request.origin)

    connection.on('message',message=>{

        if (message.type === 'utf8') {

            let data = JSON.parse(message.utf8Data)

            if(data.route==='get_finalization_proof'){

                //

            }

            else connection.close(1337,'No available route')

        } else connection.close(7331,'Wrong message type')
    
    })
    
    connection.on('close',()=>{})

    connection.on('error',()=>{})

})