import {getFromApprovementThreadState} from './common_functions/approvement_thread_related.js'

import {getCurrentEpochQuorum, getQuorumMajority} from './common_functions/quorum_related.js'

import {customLog, pathResolve, logColors, blake3Hash} from '../../KLY_Utils/utils.js'

import {BLOCKCHAIN_GENESIS, CONFIGURATION, FASTIFY_SERVER} from '../../klyn74r.js'

import {setLeadersSequenceForShards} from './life/shards_leaders_monitoring.js'

import {KLY_EVM} from '../../KLY_VirtualMachines/kly_evm/vm.js'

import {isMyCoreVersionOld} from './utils.js'

import level from 'level'

import Web3 from 'web3'

import fs from 'fs'

import os from 'os'


// !!!!!!!! FOR TEST ONLY !!!!!!!!

const platform = os.platform();

let versionFilePath



if (platform === 'win32' || platform === 'darwin') {
    
    versionFilePath = pathResolve('../../../../../../../KLY_Workflows/dev_tachyon/version.txt')

} else versionFilePath = '/home/vladartem/KlyntarCore/KLY_Workflows/dev_tachyon/version.txt'






let resolveDatabase = name => level(process.env.CHAINDATA_PATH+`/${name}`,{valueEncoding:'json'})




// First of all - define the NODE_METADATA globally available object

export let NODE_METADATA = {

    CORE_MAJOR_VERSION:+(fs.readFileSync(versionFilePath).toString()), // major version of core. In case network decides to add modification, fork is created & software should be updated
    
    MEMPOOL:[], // to hold onchain transactions here(contract calls,txs,delegations and so on)

    PEERS:[] // peers to exchange data with. Just strings with addresses    

}


global.MEMPOOL = NODE_METADATA.MEMPOOL




export let EPOCH_METADATA_MAPPING = new Map() // cache to hold metadata for specific epoch by it's ID. Mapping(EpochID=>Mapping)




export let GLOBAL_CACHES = {

    STATE_CACHE:new Map(), // cache to hold accounts of EOAs/contracts. Mapping(ID => ACCOUNT_STATE). Used by VERIFICATION_THREAD

    APPROVEMENT_THREAD_CACHE:new Map(), // ... the same, but used by APPROVEMENT_THREAD

    STUFF_CACHE:new Map(), // cache for different stuff during node work


}




export let WORKING_THREADS = {

    VERIFICATION_THREAD: {

        VERIFICATION_STATS_PER_POOL:{}, // PUBKEY => {index:int,hash:''}


        KLY_EVM_STATE_ROOT:'', // General KLY-EVM state root

        KLY_EVM_METADATA:{}, // shardID => {nextBlockIndex,parentHash,timestamp}


        TEMP_INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS_ON_SHARDS:{},

        SID_TRACKER:{}, // shardID => index


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
            }

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
            }

        },

        MONTHLY_ALLOCATION_FOR_REWARDS:0, // need this var for block reward

        ALLOCATIONS_PER_EPOCH:{}, // epochIndex => {entity:alreadyAllocated}

        EPOCH:{} // epoch handler

    },

    GENERATION_THREAD: {
            
        epochFullId:`${blake3Hash('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'+BLOCKCHAIN_GENESIS.NETWORK_ID)}#-1`,

        epochIndex:0,
        
        prevHash:`0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, // "null" hash
        
        nextIndex:0 // so the first block will be with index 0
    
    },

    APPROVEMENT_THREAD:{}

}




// Global object which holds LevelDB instances for databases for blocks, state, metadata, KLY_EVM, etc.

export let BLOCKCHAIN_DATABASES = {

    BLOCKS: resolveDatabase('BLOCKS'), // blockID => block
    
    STATE: resolveDatabase('STATE'), // contains state of accounts, contracts, services, metadata and so on. The main database like NTDS.dit

    EPOCH_DATA: resolveDatabase('EPOCH_DATA'), // contains epoch data that shouldn't be deleted each new epoch (e.g. AEFPs, AFPs, etc.) 

    APPROVEMENT_THREAD_METADATA: resolveDatabase('APPROVEMENT_THREAD_METADATA'), // metadata for APPROVEMENT_THREAD

    EXPLORER_DATA: resolveDatabase('EXPLORER_DATA') // just a database for misc useful data for explorers & API. Just to store useful artifacts separately from state

}

// Required by KLY-EVM JSON-RPC API, so make it available via global

global.STATE = BLOCKCHAIN_DATABASES.STATE

global.VERIFICATION_THREAD = WORKING_THREADS.VERIFICATION_THREAD

global.BLOCKCHAIN_GENESIS = BLOCKCHAIN_GENESIS

global.CREATED_EVM_ACCOUNTS = new Set()



export let getCurrentShardLeaderURL = async shardID => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return

    let canGenerateBlocksNow = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)

    if(canGenerateBlocksNow) return {isMeShardLeader:true}

    else {

        let indexOfCurrentLeaderForShard = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(shardID) // {currentLeader:<id>}

        let currentLeaderPubkey = epochHandler.leadersSequence[shardID][indexOfCurrentLeaderForShard.currentLeader]

        // Get the url of current shard leader on some shard

        let poolStorage = await getFromApprovementThreadState(currentLeaderPubkey+'(POOL)_STORAGE_POOL').catch(()=>null)


        if(poolStorage) return {isMeShardLeader:false,url:poolStorage.poolURL}
        
    }
    
}


// Required by KLY-EVM JSON-RPC API, so make it available via global

global.getCurrentShardLeaderURL = getCurrentShardLeaderURL


//___________________________________________________________ 0. Set the handlers for system signals(e.g. Ctrl+C to stop blockchain) ___________________________________________________________



// Need it with 'export' keyword because used in other files - for example to gracefully stop the node when it's version is outdated

export let GRACEFUL_STOP = async() => {

    console.log('\n')

    customLog('\x1b[31;1mKLYNTAR\x1b[36;1m stop has been initiated.Keep waiting...',logColors.CYAN)
    
    customLog(fs.readFileSync(pathResolve('images/events/termination.txt')).toString(),logColors.YELLOW)

    console.log('\n')

    customLog('Closing server connections...',logColors.CYAN)

    await FASTIFY_SERVER.close()

    customLog('Node was gracefully stopped',logColors.CYAN)
        
    process.exit(0)

}

process.on('SIGTERM',GRACEFUL_STOP)
process.on('SIGINT',GRACEFUL_STOP)
process.on('SIGHUP',GRACEFUL_STOP)












let restoreMetadataCaches=async()=>{

    // Function to restore metadata since the last turn off

    let poolsRegistry = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.poolsRegistry

    let epochFullID = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.hash+"#"+WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)
    


    for(let poolPubKey of poolsRegistry){

        let {index,hash,afp} = await currentEpochMetadata.DATABASE.get(poolPubKey).catch(()=>null) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}
        
        currentEpochMetadata.FINALIZATION_STATS.set(poolPubKey,{index,hash,afp})

    }

    for(let shardID of WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.shardsRegistry){

        let leadersHandler = await currentEpochMetadata.DATABASE.get('LEADERS_HANDLER:'+shardID).catch(()=>({currentLeader:0}))

        currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(shardID,leadersHandler)

        // Using pointer - find the current leader

        let currentLeaderPubKey = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.leadersSequence[shardID][leadersHandler.currentLeader]

        currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(currentLeaderPubKey,shardID)
        
    }

    // Finally, once we've started the "next epoch" process - restore it

    let itsTimeForTheNextEpoch = await currentEpochMetadata.DATABASE.get('TIME_TO_NEW_EPOCH').catch(()=>false)

    if(itsTimeForTheNextEpoch) {

        currentEpochMetadata.SYNCHRONIZER.set('TIME_TO_NEW_EPOCH',true)

        currentEpochMetadata.SYNCHRONIZER.set('READY_FOR_NEW_EPOCH',true)

    }

}








let setGenesisToState=async()=>{


    let verificationThreadAtomicBatch = BLOCKCHAIN_DATABASES.STATE.batch(),

        approvementThreadAtomicBatch = BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.batch(),
    
        epochTimestamp = BLOCKCHAIN_GENESIS.FIRST_EPOCH_START_TIMESTAMP,

        poolsRegistryForEpochHandler = [],

        shardsRegistry = []




    WORKING_THREADS.VERIFICATION_THREAD.SID_TRACKER[BLOCKCHAIN_GENESIS.SHARD] = 0

    shardsRegistry.push(BLOCKCHAIN_GENESIS.SHARD)

    //__________________________________ Load info about pools __________________________________


    for(let [poolPubKey,poolContractStorage] of Object.entries(BLOCKCHAIN_GENESIS.POOLS)){

        let bindToShard = BLOCKCHAIN_GENESIS.SHARD

        // Create the value in VT

        WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[poolPubKey] = {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'}


        // Create the appropriate storage for pre-set pools. We'll create the simplest variant - but pools will have ability to change it via txs during the chain work
        
        let contractMetadataTemplate = {

            type:'contract',
            lang:'system/staking/sub',
            balance:0,
            gas:0,
            storages:['POOL'],
            storageAbstractionLastPayment:0

        }

        // Add the activation status to the validator

        poolContractStorage.activated = true
        
        // Store all info about pool(account data + storage) to state

        verificationThreadAtomicBatch.put(bindToShard+':'+poolPubKey+'(POOL)',contractMetadataTemplate)
    
        verificationThreadAtomicBatch.put(bindToShard+':'+poolPubKey+'(POOL)_STORAGE_POOL',poolContractStorage)

        // Do the same for approvement thread

        approvementThreadAtomicBatch.put(poolPubKey+'(POOL)_STORAGE_POOL',poolContractStorage)

        // Register new pool

        poolsRegistryForEpochHandler.push(poolPubKey)

    }

    
    //________________________ Fill the state of KLY-EVM ________________________

    if(BLOCKCHAIN_GENESIS.EVM){

        let evmKeys = Object.keys(BLOCKCHAIN_GENESIS.EVM)

        for(let evmKey of evmKeys) {

            let {isContract,balance,nonce,code,storage,gas} = BLOCKCHAIN_GENESIS.EVM[evmKey]

            //Put KLY-EVM to KLY-EVM state db which will be used by Trie

            if(isContract){

                await KLY_EVM.putContract(evmKey,balance,nonce,code,storage)

                WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalSmartContractsNumber.evm++

                WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newSmartContractsNumber.evm++

            }else{
            
                await KLY_EVM.putAccount(evmKey,balance,nonce)

                WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalUserAccountsNumber.evm++

                WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newUserAccountsNumber.evm++

            }


            let lowerCaseAddressWith0xPrefix = evmKey.toLowerCase()

            // Add assignment to shard

            verificationThreadAtomicBatch.put('EVM_ACCOUNT:'+lowerCaseAddressWith0xPrefix,{shard:BLOCKCHAIN_GENESIS.SHARD,gas})

            if(isContract) verificationThreadAtomicBatch.put('EVM_CONTRACT_DATA:'+evmKey,{storageAbstractionLastPayment:0})

        }

    }

    WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_METADATA[BLOCKCHAIN_GENESIS.SHARD] = {

        nextBlockIndex:Web3.utils.toHex(BigInt(0).toString()),

        parentHash:'0000000000000000000000000000000000000000000000000000000000000000',

        timestamp:Math.floor(epochTimestamp/1000)

    }


    //_______________________ Now add the data to state _______________________

    for(let [accountID, accountData] of Object.entries(BLOCKCHAIN_GENESIS.STATE)){

        let shardID = BLOCKCHAIN_GENESIS.SHARD

        if(accountData.type === 'contract'){

            let {lang,balance,gas,storages,bytecode,storageAbstractionLastPayment} = accountData

            let contractMeta = {

                type:'contract',
                lang,
                balance,
                gas,
                storages,
                storageAbstractionLastPayment
            
            } 

            // Write metadata first
            
            verificationThreadAtomicBatch.put(shardID+':'+accountID,contractMeta)

            verificationThreadAtomicBatch.put(shardID+':'+accountID+'_BYTECODE',bytecode)

            WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalSmartContractsNumber.native++

            WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newSmartContractsNumber.native++

            // Finally - write genesis storage of contract

            for(let storageID of storages){

                verificationThreadAtomicBatch.put(shardID+':'+accountID+'_STORAGE_'+storageID,accountData[storageID])

            }


        } else {

            // Else - it's default EOA account

            verificationThreadAtomicBatch.put(shardID+':'+accountID,accountData)

            WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalUserAccountsNumber.native++

            WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newUserAccountsNumber.native++

        }

    
    }


    // Initiate TGE to set the initial block reward + distribute coins among entities

    if(BLOCKCHAIN_GENESIS.UNLOCKS){

        WORKING_THREADS.VERIFICATION_THREAD.ALLOCATIONS_PER_EPOCH["0"] = {}

        for(let [recipient,unlocksTable] of Object.entries(BLOCKCHAIN_GENESIS.UNLOCKS)){

            if(unlocksTable["0"]){


                if(recipient === 'mining') {

                    WORKING_THREADS.VERIFICATION_THREAD.ALLOCATIONS_PER_EPOCH["0"]["mining"] = 0

                    WORKING_THREADS.VERIFICATION_THREAD.MONTHLY_ALLOCATION_FOR_REWARDS = unlocksTable["0"]

                }

                if(recipient.startsWith('0x') && recipient.length === 42){

                    if(BLOCKCHAIN_GENESIS.EVM[recipient]){

                        let unlockAmount = unlocksTable["0"]
    
                        let amountInWei = Math.round(unlockAmount * (10 ** 18))
        
                        WORKING_THREADS.VERIFICATION_THREAD.ALLOCATIONS_PER_EPOCH["0"][recipient] = unlockAmount
    
                        let recipientAccount = await KLY_EVM.getAccount(recipient)
        
                        recipientAccount.balance += BigInt(amountInWei)
        
                        await KLY_EVM.updateAccount(recipient,recipientAccount)

                    } else throw new Error("You need to add the allocations recipient to BLOCKCHAIN_GENESIS.EVM")
    
                }    

            }

        }

    }
  

    /*
    
        Set the initial workflow version from genesis

        We keep the official semver notation x.y.z(major.minor.patch)

        You can't continue to work if QUORUM and major part of POOLS decided to vote for major update.
    
        However, if workflow_version has differences in minor or patch values - you can continue to work


        KLYNTAR threads holds only MAJOR version(VERIFICATION_THREAD and APPROVEMENT_THREAD) because only this matter

    */

    WORKING_THREADS.VERIFICATION_THREAD.CORE_MAJOR_VERSION = BLOCKCHAIN_GENESIS.CORE_MAJOR_VERSION

    WORKING_THREADS.APPROVEMENT_THREAD.CORE_MAJOR_VERSION = BLOCKCHAIN_GENESIS.CORE_MAJOR_VERSION

    // Also, set the NETWORK_PARAMETERS that will be changed during the threads' work

    WORKING_THREADS.VERIFICATION_THREAD.NETWORK_PARAMETERS = {...BLOCKCHAIN_GENESIS.NETWORK_PARAMETERS}

    WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS = {...BLOCKCHAIN_GENESIS.NETWORK_PARAMETERS}



    
    await verificationThreadAtomicBatch.write()

    await approvementThreadAtomicBatch.write()



    WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_STATE_ROOT = await KLY_EVM.getStateRoot()


    let initEpochHash = blake3Hash('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'+BLOCKCHAIN_GENESIS.NETWORK_ID)


    WORKING_THREADS.VERIFICATION_THREAD.EPOCH = {

        id:0,

        hash: initEpochHash,

        poolsRegistry:JSON.parse(JSON.stringify(poolsRegistryForEpochHandler)),

        shardsRegistry,
        
        startTimestamp:epochTimestamp,

        quorum:[], // [pool0,pool1,...,poolN]

        leadersSequence:{} // shardID => [pool0,pool1,...,poolN]
    
    }
    

    WORKING_THREADS.APPROVEMENT_THREAD.EPOCH = {

        id:0,

        hash: initEpochHash,

        poolsRegistry:JSON.parse(JSON.stringify(poolsRegistryForEpochHandler)),

        shardsRegistry,

        startTimestamp:epochTimestamp,

        quorum:[], // [pool0,pool1,...,poolN]

        leadersSequence:{} // shardID => [pool0,pool1,...,poolN]
    
    }


    let vtEpochHandler = WORKING_THREADS.VERIFICATION_THREAD.EPOCH

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH


    vtEpochHandler.quorum = await getCurrentEpochQuorum(vtEpochHandler.poolsRegistry,WORKING_THREADS.VERIFICATION_THREAD.NETWORK_PARAMETERS,initEpochHash)

    atEpochHandler.quorum = await getCurrentEpochQuorum(atEpochHandler.poolsRegistry,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS,initEpochHash)


    // WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.LEADERSHIP_TIMEFRAME = Math.floor(WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.EPOCH_TIME/atEpochHandler.quorum.length)



    // Finally, assign validators to shards for current epoch in APPROVEMENT_THREAD and VERIFICAION_THREAD

    await setLeadersSequenceForShards(atEpochHandler,initEpochHash)

    vtEpochHandler.leadersSequence = JSON.parse(JSON.stringify(atEpochHandler.leadersSequence))

}












//___________________________________________________________ 2. Function to load the data from genesis to state ___________________________________________________________




export let prepareBlockchain=async()=>{


    // Create the directory for chaindata in case it's doesn't exist yet

    !fs.existsSync(process.env.CHAINDATA_PATH) && fs.mkdirSync(process.env.CHAINDATA_PATH)



    
    //_____________________ Now, we need to load the metadata of GENERATION, APPROVEMENT and VERIFICATION threads _____________________

    // Load generation thread metadata
    let storedGenerationThreadFromDB = await BLOCKCHAIN_DATABASES.BLOCKS.get('GT').catch(()=>null)

    if(storedGenerationThreadFromDB){

        WORKING_THREADS.GENERATION_THREAD = storedGenerationThreadFromDB

    }

    // Load approvement thread metadata
    let storedApprovementThreadFromDB = await BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.get('AT').catch(()=>null)

    if(storedApprovementThreadFromDB){

        WORKING_THREADS.APPROVEMENT_THREAD = storedApprovementThreadFromDB

    }

    // And finally - verification thread metadata
    let storedVerificaionThreadFromDB = await BLOCKCHAIN_DATABASES.STATE.get('VT').catch(()=>null)

    if(storedVerificaionThreadFromDB){

        WORKING_THREADS.VERIFICATION_THREAD = storedVerificaionThreadFromDB

    }
    
    




    if(WORKING_THREADS.VERIFICATION_THREAD.CORE_MAJOR_VERSION === undefined){

        await setGenesisToState()

        //______________________________________Commit the state of VT and AT___________________________________________

        await BLOCKCHAIN_DATABASES.STATE.put('VT',WORKING_THREADS.VERIFICATION_THREAD)

        await BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.put('AT',WORKING_THREADS.APPROVEMENT_THREAD)

    }

    // Need it for KLY-EVM JSON-RPC compatibility

    global.KLY_EVM_METADATA = WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_METADATA


    //________________________________________Set the state of KLY-EVM______________________________________________


    await KLY_EVM.setStateRoot(WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_STATE_ROOT)


    //_______________________________Check the version of AT and VT and if need - update________________________________
    



    if(isMyCoreVersionOld('APPROVEMENT_THREAD')){

        customLog(`New version detected on APPROVEMENT_THREAD. Please, upgrade your node software`,logColors.YELLOW)

        console.log('\n')
        console.log(fs.readFileSync(pathResolve('images/events/update.txt')).toString())
    

        // Stop the node to update the software
        GRACEFUL_STOP()

    }


    if(isMyCoreVersionOld('VERIFICATION_THREAD')){

        customLog(`New version detected on VERIFICATION_THREAD. Please, upgrade your node software`,logColors.YELLOW)

        console.log('\n')
        console.log(fs.readFileSync(pathResolve('images/events/update.txt')).toString())
    

        // Stop the node to update the software
        GRACEFUL_STOP()

    }


    let epochFullID = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.hash+"#"+WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.id


    if(WORKING_THREADS.GENERATION_THREAD.epochFullId === epochFullID && !WORKING_THREADS.GENERATION_THREAD.quorum){

        WORKING_THREADS.GENERATION_THREAD.quorum = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum

        WORKING_THREADS.GENERATION_THREAD.majority = getQuorumMajority(WORKING_THREADS.APPROVEMENT_THREAD.EPOCH)

    }

    //_________________________________Add the temporary data of current AT__________________________________________
    
    let temporaryDatabaseForApprovementThread = level(process.env.CHAINDATA_PATH+`/${epochFullID}`,{valueEncoding:'json'})
    
    EPOCH_METADATA_MAPPING.set(epochFullID,{

        FINALIZATION_PROOFS:new Map(), // blockID => Map(quorumMemberPubKey=>SIG(prevBlockHash+blockID+blockHash+AT.EPOCH.HASH+"#"+AT.EPOCH.id)). Proofs that validator voted for block epochID:blockCreatorX:blockIndexY with hash H

        TEMP_CACHE:new Map(),  // simple key=>value mapping to be used as temporary cache for epoch
    
        FINALIZATION_STATS:new Map(), // mapping( validatorID => {index,hash,afp} ). Used to know inde/hash of last approved block by validator.
        
        SYNCHRONIZER:new Map(), // used as mutex to prevent async changes of object | multiple operations with several await's | etc.

        SHARDS_LEADERS_HANDLERS:new Map(), // shardID => {currentLeader:<number>} | Pool => shardID


        //____________________Mapping which contains temporary databases for____________________

        DATABASE:temporaryDatabaseForApprovementThread // DB with temporary data that we need during epoch    

    })


    // Fill the FINALIZATION_STATS with the latest, locally stored data

    await restoreMetadataCaches()

}