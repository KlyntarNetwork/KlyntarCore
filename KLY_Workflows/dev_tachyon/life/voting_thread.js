import { BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, GLOBAL_CACHES, WORKING_THREADS } from "../globals.js"

import { getUtcTimestamp } from "../../../KLY_Utils/utils.js"

import { CONFIGURATION } from "../../../klyntar_core.js"

import { epochStillFresh } from "../utils.js"



let timeIsOutForCurrentLeader=(epochHandler,indexOfCurrentLeaderInSequence,leaderShipTimeframe)=>{

    // Function to check if time frame for current leader is done and we have to move to next pool in sequence

    return getUtcTimestamp() >= epochHandler.startTimestamp+(indexOfCurrentLeaderInSequence+1)*leaderShipTimeframe

}



export let startVotingThread = async() => {

    await votingThreadIteration()

    setTimeout(startVotingThread,500)

}


let votingThreadIteration = async() => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochIndexLocal = epochHandler.id
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id
    
    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)
    
    if(currentEpochMetadata){

        // Check if we have the request for epoch finish - if so, send response and skip the following loop

        let timeForNewEpoch = !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)

        let indexOfCurrentLeader = currentEpochMetadata.CURRENT_LEADER_INDEX

        // In case more pools in sequence exists - we can move to it. Otherwise - no sense to change pool as leader because no more candidates
    
        let acceptVotingRequestsFrom = epochHandler.leadersSequence[indexOfCurrentLeader]

        let nextLeaderPubkey = epochHandler.leadersSequence[indexOfCurrentLeader+1]

        let epochFinishRequest = timeForNewEpoch && await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('EPOCH_FINISH_REQUEST:'+epochIndexLocal).catch(()=>false)


        // Check if we should rotate the leader
    
        if(nextLeaderPubkey && timeIsOutForCurrentLeader(epochHandler,indexOfCurrentLeader,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.LEADERSHIP_TIMEFRAME)){
    
            // Now, update the LEADERS_HANDLER
    
            await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('CURRENT_LEADER:'+epochIndexLocal,indexOfCurrentLeader + 1).then(()=>{

                currentEpochMetadata.CURRENT_LEADER_INDEX = indexOfCurrentLeader + 1

                acceptVotingRequestsFrom = nextLeaderPubkey
    
            }).catch(()=>null)
    
        }

        if(epochFinishRequest){

            await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('EPOCH_FINISH_RESPONSE:'+epochIndexLocal,true).catch(()=>{})

            GLOBAL_CACHES.VOTING_REQUESTS.clear()

        } else if(GLOBAL_CACHES.VOTING_REQUESTS.size !== 0) {

            GLOBAL_CACHES.VOTING_REQUESTS.set('LOCK',true) // prevent adding keys during iteration

            for (const [blockID, votingRequest] of GLOBAL_CACHES.VOTING_REQUESTS) {

                // Make sure that the local value of height in BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS is <= than the index you're going to vote for

                let {epochIndex, blockCreator, finalizationProof, futureVotingDataToStore, connection, votedForHash} = votingRequest

                if(epochIndex === epochIndexLocal && blockCreator === acceptVotingRequestsFrom){

                    let localVotingStats = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':'+blockCreator).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))

                    let sameSegment = localVotingStats.index < futureVotingDataToStore.index || futureVotingDataToStore.index === -1 || localVotingStats.index === futureVotingDataToStore.index && localVotingStats.hash === futureVotingDataToStore.hash

                    if(sameSegment){
        
                        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put(epochIndex+':'+blockCreator,futureVotingDataToStore).then(()=>{
        
                            // Finally send response
        
                            connection.sendUTF(JSON.stringify({voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,finalizationProof,votedForHash}))
        
                        }).catch(()=>{})
        
                    }    

                }
        
                GLOBAL_CACHES.VOTING_REQUESTS.delete(blockID)
            
            }

        }

        GLOBAL_CACHES.VOTING_REQUESTS.delete('LOCK') // release lock

    }

}