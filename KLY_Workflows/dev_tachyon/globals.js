import {pathResolve,blake3Hash} from '../../KLY_Utils/utils.js'

import {BLOCKCHAIN_GENESIS} from '../../klyntar_core.js'

import {getCurrentLeaderURL} from './utils.js'

import level from 'level'

import os from 'os'

import fs from 'fs'




// !!!!!!!! FOR TEST ONLY !!!!!!!!

const platform = os.platform();

let versionFilePath


let resolveDatabase = name => level(process.env.CHAINDATA_PATH+`/${name}`,{valueEncoding:'json'})


if (platform === 'win32' || platform === 'darwin') {
    
    versionFilePath = pathResolve('KLY_Workflows/dev_tachyon/version.txt')

} else versionFilePath = '/home/vladartem/KlyntarCore/KLY_Workflows/dev_tachyon/version.txt'




global.CORE_MAJOR_VERSION = +(fs.readFileSync(versionFilePath).toString()) // major version of core. In case network decides to add modification, fork is created & software should be updated




export let GLOBAL_CACHES = {

    VOTING_REQUESTS: new Map(),

    FINALIZATION_PROOFS:new Map(), // blockID => Map(quorumMemberPubKey=>SIG(prevBlockHash+blockID+blockHash+AT.EPOCH.HASH+"#"+AT.EPOCH.id)). Proofs that validator voted for block epochID:blockCreatorX:blockIndexY with hash H

    TEMP_CACHE:new Map(),  // simple key => value mapping to be used as temporary cache for epoch

    MEMPOOL:[], // to hold onchain transactions here(contract calls,txs,delegations and so on)

    STATE_CACHE:new Map(), // cache to hold accounts of EOAs/contracts. Mapping(ID => ACCOUNT_STATE). Used by VERIFICATION_THREAD

    APPROVEMENT_THREAD_CACHE:new Map(), // ... the same, but used by APPROVEMENT_THREAD

    STUFF_CACHE:new Map(), // cache for different stuff during node work

    STATE_CHANGES_CACHE: { put: {}, delete: {}, update: {} } // ... contains changes of state between blocks to provide state rollback functionality

}

global.MEMPOOL = GLOBAL_CACHES.MEMPOOL


export let WORKING_THREADS = {

    VERIFICATION_THREAD: {

        CORE_MAJOR_VERSION:-1,

        LAST_HEIGHT:-1,
        
        LAST_BLOCKHASH:'',

        VERIFICATION_STATS_PER_POOL:{}, // PUBKEY => {index:int,hash:''}

        KLY_EVM_METADATA:{}, // {root,nextBlockIndex,parentHash,timestamp}

        TOTAL_STATS:{

            totalBlocksNumber:0,
            
            totalTxsNumber:0,

            successfulTxsNumber:0,

            totalUserAccountsNumber:{
                native:0,
                evm:0
            },

            totalSmartContractsNumber:{
                native:0,
                evm:0
            },

            rwxContracts:{
                total:0,
                closed:0
            },

            totalKlyStaked:0,
            totalUnoStaked:0,

            coinsAllocated:0

        },

        STATS_PER_EPOCH:{

            totalBlocksNumber:0,
            
            totalTxsNumber:0,

            successfulTxsNumber:0,

            newUserAccountsNumber:{
                native:0,
                evm:0
            },

            newSmartContractsNumber:{
                native:0,
                evm:0
            },

            rwxContracts:{
                total:0,
                closed:0
            },

            totalKlyStaked:0,
            totalUnoStaked:0,

            coinsAllocations:{ blockRewards:0 } // {entity:alreadyAllocated}

        },

        MONTHLY_ALLOCATION_FOR_REWARDS:0, // need this var for block reward

        NETWORK_PARAMETERS:{},

        EPOCH:{} // epoch handler

    },

    GENERATION_THREAD: {
            
        epochFullId:`${blake3Hash('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'+BLOCKCHAIN_GENESIS.NETWORK_ID)}#-1`,

        epochIndex:0,
        
        prevHash:`0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, // "null" hash
        
        nextIndex:0 // so the first block will be with index 0
    
    },

    APPROVEMENT_THREAD:{

        CORE_MAJOR_VERSION:-1,

        NETWORK_PARAMETERS:{},

        EPOCH:{}
    
    }

}


// Global object which holds LevelDB instances for databases for blocks, state, metadata, KLY_EVM, etc.

export let BLOCKCHAIN_DATABASES = {

    BLOCKS: resolveDatabase('BLOCKS'), // blockID => block
    
    STATE: resolveDatabase('STATE'), // contains state of accounts, contracts, services, metadata, info about state changes from block N to block N+1 and so on

    EPOCH_DATA: resolveDatabase('EPOCH_DATA'), // contains epoch data that shouldn't be deleted each new epoch (e.g. AEFPs, AFPs, etc.) 

    APPROVEMENT_THREAD_METADATA: resolveDatabase('APPROVEMENT_THREAD_METADATA'), // metadata for APPROVEMENT_THREAD

    EXPLORER_DATA: resolveDatabase('EXPLORER_DATA'), // just a database for misc useful data for explorers & API. Just to store useful artifacts separately from state

    FINALIZATION_VOTING_STATS: resolveDatabase('FINALIZATION_VOTING_STATS') // database which stores the voting data

}



global.STATE = BLOCKCHAIN_DATABASES.STATE // required by KLY-EVM JSON-RPC API, so make it available via global

global.CREATED_EVM_ACCOUNTS = new Set()

global.getCurrentLeaderURL = getCurrentLeaderURL // required by KLY-EVM JSON-RPC API, so make it available via global