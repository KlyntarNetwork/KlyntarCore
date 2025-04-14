import {getCurrentEpochQuorum, getQuorumMajority, setLeadersSequence} from './common_functions/quorum_related.js'

import {customLog, pathResolve, logColors, blake3Hash, gracefulStop} from '../../KLY_Utils/utils.js'

import {BLOCKCHAIN_DATABASES, WORKING_THREADS} from './globals.js'

import {BLOCKCHAIN_GENESIS} from '../../klyntar_core.js'

import {isMyCoreVersionOld} from './utils.js'

import fs from 'fs'








let setGenesisToState=async()=>{


    let approvementThreadAtomicBatch = BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.batch(),
    
        epochTimestamp = BLOCKCHAIN_GENESIS.FIRST_EPOCH_START_TIMESTAMP,

        poolsRegistryForEpochHandler = [],

        shardsRegistry = []



    shardsRegistry.push(BLOCKCHAIN_GENESIS.SHARD)

    //__________________________________ Load info about pools __________________________________


    for(let [poolPubKey,poolContractStorage] of Object.entries(BLOCKCHAIN_GENESIS.POOLS)){

        // Add the activation status to the validator

        poolContractStorage.activated = true
        
        // Store all info about pool

        approvementThreadAtomicBatch.put(poolPubKey+'(POOL)_STORAGE_POOL',poolContractStorage)

        // Register new pool

        poolsRegistryForEpochHandler.push(poolPubKey)


    }  

    /*
    
        Set the initial workflow version from genesis

        We keep the official semver notation x.y.z(major.minor.patch)

        You can't continue to work if QUORUM and major part of POOLS decided to vote for major update.
    
        However, if workflow_version has differences in minor or patch values - you can continue to work

    */

    WORKING_THREADS.APPROVEMENT_THREAD.CORE_MAJOR_VERSION = BLOCKCHAIN_GENESIS.CORE_MAJOR_VERSION

    // Also, set the NETWORK_PARAMETERS that will be changed during the threads' work

    WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS = {...BLOCKCHAIN_GENESIS.NETWORK_PARAMETERS}


    await approvementThreadAtomicBatch.write()


    let initEpochHash = blake3Hash('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'+BLOCKCHAIN_GENESIS.NETWORK_ID)
    

    WORKING_THREADS.APPROVEMENT_THREAD.EPOCH = {

        id:0,

        hash: initEpochHash,

        poolsRegistry:JSON.parse(JSON.stringify(poolsRegistryForEpochHandler)),

        shardsRegistry,

        startTimestamp:epochTimestamp,

        quorum:[], // [pool0,pool1,...,poolN]

        leadersSequence:[], // [pool0,pool1,...,poolN]
    
        currentLeaderIndex:0
        
    }

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    atEpochHandler.quorum = await getCurrentEpochQuorum(atEpochHandler.poolsRegistry,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS,initEpochHash)


    // Finally, assign sequence of leaders for current epoch in APPROVEMENT_THREAD

    await setLeadersSequence(atEpochHandler,initEpochHash)

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


    if(WORKING_THREADS.APPROVEMENT_THREAD.CORE_MAJOR_VERSION === -1){

        await setGenesisToState()

        await BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.put('AT',WORKING_THREADS.APPROVEMENT_THREAD)

    }


    //_______________________________Check the version of core and if need - update________________________________


    if(isMyCoreVersionOld()){

        customLog(`New version detected on APPROVEMENT_THREAD. Please, upgrade your node software`,logColors.YELLOW)

        console.log('\n')
        console.log(fs.readFileSync(pathResolve('images/events/update.txt')).toString())
    

        // Stop the node to update the software
        gracefulStop()

    }


    let epochFullID = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.hash+"#"+WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.id


    if(WORKING_THREADS.GENERATION_THREAD.epochFullId === epochFullID && !WORKING_THREADS.GENERATION_THREAD.quorum){

        WORKING_THREADS.GENERATION_THREAD.quorum = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum

        WORKING_THREADS.GENERATION_THREAD.majority = getQuorumMajority(WORKING_THREADS.APPROVEMENT_THREAD.EPOCH)

    }

}