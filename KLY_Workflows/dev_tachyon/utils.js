import {getFromApprovementThreadState} from './common_functions/approvement_thread_related.js'

import { EPOCH_METADATA_MAPPING, WORKING_THREADS, NODE_METADATA } from './globals.js'

import {getUtcTimestamp} from '../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../klyntar_core.js'




export let getRandomFromArray = arr => {

    let randomIndex = Math.floor(Math.random() * arr.length)
  
    return arr[randomIndex]

}


export let getAllKnownPeers=()=>[...CONFIGURATION.NODE_LEVEL.BOOTSTRAP_NODES,...NODE_METADATA.PEERS]


// NODE_METADATA.CORE_MAJOR_VERSION shows the major version of your node(core)
// We use this function on VERIFICATION_THREAD and APPROVEMENT_THREAD to make sure your node can continue to work
// If major version for network-level was changed but you still has an old version - it should be stopped and update software
export let isMyCoreVersionOld = threadID => WORKING_THREADS[threadID].CORE_MAJOR_VERSION > NODE_METADATA.CORE_MAJOR_VERSION


export let epochStillFresh = thread => thread.EPOCH.startTimestamp + thread.NETWORK_PARAMETERS.EPOCH_TIME > getUtcTimestamp()


export let getCurrentLeaderURL = async () => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return

    let canGenerateBlocksNow = currentEpochMetadata.CURRENT_LEADER_INFO.pubKey === CONFIGURATION.NODE_LEVEL.PUBLIC_KEY

    if(canGenerateBlocksNow) return {isMeLeader:true}

    else {

        // Get the url of current leader

        let poolStorage = await getFromApprovementThreadState(currentEpochMetadata.CURRENT_LEADER_INFO.pubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        if(poolStorage) return {isMeLeader:false,url:poolStorage.poolURL}
        
    }
    
}


// Required by KLY-EVM JSON-RPC API, so make it available via global

global.getCurrentLeaderURL = getCurrentLeaderURL