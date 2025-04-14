import {getFromApprovementThreadState} from './common_functions/approvement_thread_related.js'

import {getUtcTimestamp} from '../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../klyntar_core.js'

import {WORKING_THREADS} from './globals.js'


// global.CORE_MAJOR_VERSION shows the major version of your node(core)
// If major version for network-level was changed but you still has an old version - it should be stopped and update software
export let isMyCoreVersionOld = () => WORKING_THREADS.APPROVEMENT_THREAD.CORE_MAJOR_VERSION > global.CORE_MAJOR_VERSION


export let epochStillFresh = thread => thread.EPOCH.startTimestamp + thread.NETWORK_PARAMETERS.EPOCH_TIME > getUtcTimestamp()


export let getCurrentLeaderURL = async () => {

    let currentApprovementThread = WORKING_THREADS.APPROVEMENT_THREAD

    let epochHandler = currentApprovementThread.EPOCH
    
    let currentLeaderPubkey = epochHandler.leadersSequence[currentApprovementThread.CURRENT_LEADER_INDEX]

    if(currentLeaderPubkey){

        if(currentLeaderPubkey === CONFIGURATION.NODE_LEVEL.PUBLIC_KEY) return {isMeLeader:true}

        else {
    
            // Get the url of current leader
    
            let poolStorage = await getFromApprovementThreadState(currentLeaderPubkey+'(POOL)_STORAGE_POOL').catch(()=>null)
    
            if(poolStorage) return {isMeLeader:false,url:poolStorage.poolURL}
            
        }    

    }
    
}