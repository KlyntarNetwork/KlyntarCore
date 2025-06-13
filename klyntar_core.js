#!/usr/bin/env node

/**
 * 
 * 
 * 
 * 
 * 
 *                                                               ██╗  ██╗██╗  ██╗   ██╗███╗   ██╗████████╗ █████╗ ██████╗ 
 *                                                               ██║ ██╔╝██║  ╚██╗ ██╔╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗
 *                                                               █████╔╝ ██║   ╚████╔╝ ██╔██╗ ██║   ██║   ███████║██████╔╝
 *                                                               ██╔═██╗ ██║    ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██║██╔══██╗
 *                                                               ██║  ██╗███████╗██║   ██║ ╚████║   ██║   ██║  ██║██║  ██║
 *                                                               ╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
 * 
 * 
 * 
 *                                                               Developed on Earth,Milky Way(Sagittarius A*) by humanity
 * 
 * 
 *                                                                          Date: ~66.5 ml after Chicxulub
 * 
 * 
 *                                                                          Dev:Vlad Chernenko(@MausClaus)
 * 
 * 
 *                                                       ⟒10⏚19⎎12⟒33⏃☊0⟒⟒⏚401⎅671⏚⏃23⟒38899⎎⎅387847183☊⎅6⏚8308⏃☊72⎅511⏃⏚
 * 
 * 
 * 
 * 
 * 
 * 
 */


import {logColors, customLog, pathResolve} from './KLY_Utils/utils.js'

import {isAbsolute, extname} from 'path'

import fastifyCors from '@fastify/cors'

import fastify from 'fastify'

import fs from 'fs'

import os from 'os'




/*
_______________OBLIGATORY PATH RESOLUTION_______________

✔️Sets the absolute path over relative one

🔗Used to allow us to link and start deamon from everywhere

😈Also,to prevent different attacks e.g. search order hijacking,modules substitution,NPM hijacking etc.
prevent privilleges escalation via path misconfiguration or lack of access control.

*/
global.__dirname = await import('path').then(async mod=>
  
    mod.dirname(
      
      (await import('url')).fileURLToPath(import.meta.url)
      
    )

)



// Add toJSON for BigInt
BigInt.prototype.toJSON = function () {
    
    return this.toString()

}


//______INITIALLY,LET'S COPE WITH ENV VARIABLES_________

// Set size of libuv threads pool
process.env.UV_THREADPOOL_SIZE = process.env.KLYNTAR_THREADPOOL_SIZE || process.env.NUMBER_OF_PROCESSORS


//____________________DEFINE PATHS_______________________

// Create the directory for chaindata
!fs.existsSync(process.env.CHAINDATA_PATH) && fs.mkdirSync(process.env.CHAINDATA_PATH);

// CHAINDATA_PATH must be an absolute path
let pathToChainDataIsAbsolute = process.env.CHAINDATA_PATH && isAbsolute(process.env.CHAINDATA_PATH)

// ... and finish with NO slashes
let finishWithNoSlashes = !( process.env.CHAINDATA_PATH.endsWith('/') || process.env.CHAINDATA_PATH.endsWith('\\') )


if(!(pathToChainDataIsAbsolute && finishWithNoSlashes)){

    console.log(`\u001b[38;5;202m[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})\x1b[36;1m Path to CHAINDATA_PATH must be absolute and without '/' or '\\' on the end\x1b[0m`)

    process.exit(102)

}


//____________________LOAD CONFIGS FROM FILES_______________________

export const CONFIGURATION = {};


// Load all the configs
['configs.json','kly_wvm.json','kly_evm.json'].forEach(file => {

    if (extname(file) === '.json') {
    
        const configData = fs.readFileSync(process.env.CHAINDATA_PATH + `/${file}`);
    
        Object.assign(CONFIGURATION, JSON.parse(configData));
    
    }

});




//____________________LOAD GENESIS FROM FILE_______________________

export const BLOCKCHAIN_GENESIS = JSON.parse(fs.readFileSync(process.env.CHAINDATA_PATH+`/genesis.json`))


//Read banner
console.log('\u001b[37m'+fs.readFileSync(pathResolve('images/testmode_banner.txt')).toString()

    //...and add extra colors & changes)
    .replace('Made on Earth for Universe','\u001b[38;5;87mMade on Earth for Universe\u001b[37m')
    .replace('REMEMBER:To infinity and beyond!','\u001b[38;5;87mREMEMBER:To infinity and beyond!\u001b[37m')
     
    .replaceAll('≈','\x1b[31m≈\u001b[37m')

    .replaceAll('█','\u001b[38;5;202m█\u001b[37m')

    .replaceAll('═','\u001b[38;5;87m═\u001b[37m')
    .replaceAll('╝','\u001b[38;5;87m╝\u001b[37m')
    .replaceAll('╚','\u001b[38;5;87m╚\u001b[37m')

    .replaceAll('#','\u001b[38;5;202m#\u001b[37m')+'\x1b[0m\n')


customLog(`System info \x1b[31m${['node:'+process.version,`info:${process.platform+os.arch()} # ${os.version()} # threads_num:${process.env.UV_THREADPOOL_SIZE}/${os.cpus().length}`,`runned as:${os.userInfo().username}`].join('\x1b[36m / \x1b[31m')}`,logColors.CYAN)

console.log('\n\n\n')

customLog(fs.readFileSync(pathResolve('images/events/serverConfigs.txt')).toString().replaceAll('@','\x1b[31m@\x1b[32m').replaceAll('Check the configs carefully','\u001b[38;5;50mCheck the configs carefully\x1b[32m'),logColors.GREEN)

customLog(`\u001b[38;5;202mTLS\u001b[38;5;168m is \u001b[38;5;50m${CONFIGURATION.NODE_LEVEL.TLS.ENABLED?'enabled':'disabled'}`,logColors.CON)

customLog(`Server is working on \u001b[38;5;50m[${CONFIGURATION.NODE_LEVEL.INTERFACE}]:${CONFIGURATION.NODE_LEVEL.PORT}`,logColors.CON)

customLog(CONFIGURATION.NODE_LEVEL.PLUGINS.length!==0 ? `Runned plugins(${CONFIGURATION.NODE_LEVEL.PLUGINS.length}) are \u001b[38;5;50m${CONFIGURATION.NODE_LEVEL.PLUGINS.join(' \u001b[38;5;202m<>\u001b[38;5;50m ')}`:'No plugins will be runned. Find the best plugins for you here \u001b[38;5;50mhttps://github.com/KlyntarNetwork/Plugins',logColors.CON)

customLog(fs.readFileSync(pathResolve('images/events/start.txt')).toString(),logColors.GREEN)




//_________________________________________________RUN SERVER________________________________________________


// Export it to use in KLY_Workflows(there we'll add routes+handlers)

export const FASTIFY_SERVER = fastify(CONFIGURATION.NODE_LEVEL.FASTIFY_OPTIONS);




FASTIFY_SERVER.register(fastifyCors,CONFIGURATION.NODE_LEVEL.FASTIFY_OPTIONS);




(async()=>{


    // 0. Import the entrypoint to run the blockchain logic

    let {runBlockchain} = await import(`./KLY_Workflows/${BLOCKCHAIN_GENESIS.NETWORK_WORKFLOW}/entrypoint.js`)

    await runBlockchain()


    // 1. Load plugins in case they need access to process (memory)

    for(let scriptPath of CONFIGURATION.NODE_LEVEL.PLUGINS){

        import(`./KLY_Plugins/${scriptPath}`).catch(
            
            e => customLog(`Some error has been occured in process of plugin \u001b[38;5;50m${scriptPath}\x1b[31;1m load\n${e}\n`,logColors.RED)
            
        )
    
    }

    
    // 2. Import routes
    
    await import(`./KLY_Workflows/${BLOCKCHAIN_GENESIS.NETWORK_WORKFLOW}/routes.js`)
    
    
    
    FASTIFY_SERVER.listen({port:CONFIGURATION.NODE_LEVEL.PORT,host:CONFIGURATION.NODE_LEVEL.INTERFACE},err=>{
    
        if(!err) customLog(`Node started on \x1b[36;1m[${CONFIGURATION.NODE_LEVEL.INTERFACE}]:${CONFIGURATION.NODE_LEVEL.PORT}`,logColors.GREEN)
    
        else customLog('Oops,some problems with server module',logColors.RED)
    
    })


})()