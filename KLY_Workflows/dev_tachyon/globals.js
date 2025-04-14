import {pathResolve,blake3Hash} from '../../KLY_Utils/utils.js'

import {BLOCKCHAIN_GENESIS} from '../../klyntar_core.js'

import {getCurrentLeaderURL} from './utils.js'

import level from 'level'

import fs from 'fs'


let versionFilePath = pathResolve('KLY_Workflows/dev_tachyon/version.txt')


let resolveDatabase = name => level(process.env.CHAINDATA_PATH+`/${name}`,{valueEncoding:'json'})


global.CORE_MAJOR_VERSION = +(fs.readFileSync(versionFilePath).toString()) // major version of core. In case network decides to add modification, fork is created & software should be updated


export let GLOBAL_CACHES = {

    VOTING_REQUESTS: new Map(),

    MEMPOOL:[], // to hold onchain transactions here(contract calls,txs,delegations and so on)

    APPROVEMENT_THREAD_CACHE:new Map(), // ... the same, but used by APPROVEMENT_THREAD

    FINALIZATION_PROOFS:new Map(), // blockID => Map(quorumMemberPubKey=>SIG(prevBlockHash+blockID+blockHash+AT.EPOCH.HASH+"#"+AT.EPOCH.id)). Proofs that validator voted for block epochID:blockCreatorX:blockIndexY with hash H

    TEMP_CACHE:new Map()  // simple key=>value mapping to be used as temporary cache for epoch

}

global.MEMPOOL = GLOBAL_CACHES.MEMPOOL


export let WORKING_THREADS = {

    GENERATION_THREAD: {
            
        epochFullId:`${blake3Hash('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'+BLOCKCHAIN_GENESIS.NETWORK_ID)}#-1`,

        epochIndex:0,
        
        prevHash:`0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, // "null" hash
        
        nextIndex:0 // so the first block will be with index 0
    
    },

    APPROVEMENT_THREAD:{

        CORE_MAJOR_VERSION:-1,

        NETWORK_PARAMETERS:{},

        EPOCH:{},

        CURRENT_LEADER_INDEX:0

    }

}


// Global object which holds LevelDB instances for databases for blocks, state, metadata, KLY_EVM, etc.

export let BLOCKCHAIN_DATABASES = {

    BLOCKS: resolveDatabase('BLOCKS'), // blockID => block

    EPOCH_DATA: resolveDatabase('EPOCH_DATA'), // contains epoch data that shouldn't be deleted each new epoch (e.g. AEFPs, AFPs, etc.) 

    APPROVEMENT_THREAD_METADATA: resolveDatabase('APPROVEMENT_THREAD_METADATA'), // metadata for APPROVEMENT_THREAD

    FINALIZATION_VOTING_STATS: resolveDatabase('FINALIZATION_VOTING_STATS') // database which stores the voting data

}

global.getCurrentLeaderURL = getCurrentLeaderURL // required by KLY-EVM JSON-RPC API, so make it available via global