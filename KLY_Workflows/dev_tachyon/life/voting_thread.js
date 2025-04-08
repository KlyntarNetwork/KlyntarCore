import { BLOCKCHAIN_DATABASES, GLOBAL_CACHES, WORKING_THREADS } from "../globals.js"

import { CONFIGURATION } from "../../../klyntar_core.js"

import { epochStillFresh } from "../utils.js"




export let startVotingThread = async() => {

    await votingThreadIteration()

    setTimeout(startVotingThread,500)

}


let votingThreadIteration = async() => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochIndex = epochHandler.id
    

    // Check if we have the request for epoch finish - if so, send response and skip the following loop

    let timeForNewEpoch = !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)

    let epochFinishRequest = timeForNewEpoch && await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('EPOCH_FINISH_REQUEST:'+epochIndex).catch(()=>false)

    if(epochFinishRequest){

        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('EPOCH_FINISH_RESPONSE:'+epochIndex,true).catch(()=>{})

        GLOBAL_CACHES.VOTING_REQUESTS.clear()

    } else if(GLOBAL_CACHES.VOTING_REQUESTS.size !== 0) {

        GLOBAL_CACHES.VOTING_REQUESTS.set('LOCK',true) // prevent adding keys during iteration

        for (const [blockID, votingRequest] of GLOBAL_CACHES.VOTING_REQUESTS) {

            // Make sure that the local value of height in BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS is <= than the index you're going to vote for

            let {epochIndex, blockCreator, finalizationProof, futureVotingDataToStore, connection, votedForHash} = votingRequest
    
            let localVotingStats = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':'+blockCreator).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))

            let sameSegment = localVotingStats.index < futureVotingDataToStore.index || localVotingStats.index === futureVotingDataToStore.index && localVotingStats.hash === futureVotingDataToStore.hash

            if(sameSegment){

                await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put(epochIndex+':'+blockCreator,futureVotingDataToStore).then(()=>{

                    // Finally send response

                    connection.sendUTF(JSON.stringify({voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,finalizationProof,votedForHash}))

                }).catch(()=>{})

            }

            GLOBAL_CACHES.VOTING_REQUESTS.delete(blockID)
        
        }

    }

    GLOBAL_CACHES.VOTING_REQUESTS.delete('LOCK') // release lock

}