import {getFromApprovementThreadState, useTemporaryDb} from '../common_functions/approvement_thread_related.js'

import {blake3Hash, getUtcTimestamp} from '../../../KLY_Utils/utils.js'

import {EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {epochStillFresh} from '../utils.js'







let timeIsOutForCurrentShardLeader=(epochHandler,indexOfCurrentLeaderInSequence,leaderShipTimeframe)=>{

    // Function to check if time frame for current shard leader is done and we have to move to next pool in sequence of validators for this shard in this epoch

    return getUtcTimestamp() >= epochHandler.startTimestamp+(indexOfCurrentLeaderInSequence+1)*leaderShipTimeframe

}




export let setLeadersSequenceForShards = async (epochHandler,epochSeed) => {


    epochHandler.leadersSequence = {} // shardID => [pool0,pool1,...poolN] 


    let hashOfMetadataFromOldEpoch = blake3Hash(JSON.stringify(epochHandler.poolsRegistry)+epochSeed)


    // Change order of validators pseudo-randomly

    let validatorsExtendedData = new Map()
    
    let totalStakeSum = 0

    for (let validatorPubKey of epochHandler.poolsRegistry) {

        let validatorData = await getFromApprovementThreadState(validatorPubKey+'(POOL)_STORAGE_POOL')

        let requiredData = {

            validatorPubKey, 
        
            totalStake: validatorData.totalStakedKly + validatorData.totalStakedUno 
        
        }

        totalStakeSum += requiredData.totalStake

        validatorsExtendedData.set(validatorPubKey, requiredData)
    
    }


    let assignToShardWithIndex = 0

    for (let i = 0; i < epochHandler.poolsRegistry.length; i++) {

        let cumulativeSum = 0
        
        let hashInput = `${hashOfMetadataFromOldEpoch}_${i}`
        
        let deterministicRandomValue = parseInt(blake3Hash(hashInput), 16) % totalStakeSum

        for (let [validatorPubKey, validator] of validatorsExtendedData) {

            cumulativeSum += validator.totalStake

            if (deterministicRandomValue <= cumulativeSum) {

                let shardID = epochHandler.shardsRegistry[assignToShardWithIndex]

                if(!epochHandler.leadersSequence[shardID]) epochHandler.leadersSequence[shardID] = []
        
                epochHandler.leadersSequence[shardID].push(validatorPubKey)
        
                if(!epochHandler.shardsRegistry[assignToShardWithIndex+1]) assignToShardWithIndex = 0 // next validator will be assigned again to the first shard
        
                else assignToShardWithIndex++ // to assign next validator to the next shard

                totalStakeSum -= validator.totalStake

                validatorsExtendedData.delete(validatorPubKey)
                
                break
            
            }
        
        }
    
    }
            
}



// Iterate over shards and change the leader if it's appropriate timeframe
export let shardsLeadersMonitoring=async()=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){

        setTimeout(shardsLeadersMonitoring,3000)

        return

    }


    if(!epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)){

        setTimeout(shardsLeadersMonitoring,3000)

        return

    }

    //____________________ Now iterate over shards to check if time is out for current shards leaders and we have to move to next ones ____________________

    for(let shardID of Object.keys(epochHandler.leadersSequence)){

        // Get the current handler and check the timeframe

        if(!currentEpochMetadata.SHARDS_LEADERS_HANDLERS.has(shardID)){

            currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(shardID,{currentLeader:0})

            currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(epochHandler.leadersSequence[shardID][0],shardID)

        }

        let leaderSequenceHandler = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(shardID)
        
        let indexOfCurrentLeaderInSequence = leaderSequenceHandler.currentLeader
        
        let pubKeyOfCurrentShardLeader = epochHandler.leadersSequence[shardID][indexOfCurrentLeaderInSequence]


        // In case more pools in sequence exists - we can move to it. Otherwise - no sense to change pool as leader because no more candidates

        let itsNotFinishOfSequence = epochHandler.leadersSequence[shardID][indexOfCurrentLeaderInSequence+1]

        if(itsNotFinishOfSequence && timeIsOutForCurrentShardLeader(epochHandler,indexOfCurrentLeaderInSequence,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.LEADERSHIP_TIMEFRAME)){

            // Inform websocket server that we shouldn't generate proofs for this leader anymore
            currentEpochMetadata.SYNCHRONIZER.set('STOP_PROOFS_GENERATION:'+pubKeyOfCurrentShardLeader,true)

            // But anyway - in async env wait until server callback us here that proofs creation is stopped
            if(!currentEpochMetadata.SYNCHRONIZER.has('GENERATE_FINALIZATION_PROOFS:'+pubKeyOfCurrentShardLeader)){

                // Now, update the LEADERS_HANDLER

                let newLeadersHandler = {
                    
                    currentLeader: leaderSequenceHandler.currentLeader+1
                
                }

                await useTemporaryDb('put',currentEpochMetadata.DATABASE,'LEADERS_HANDLER:'+shardID,newLeadersHandler).then(()=>{

                    // Set new pool(shard leader) and delete the old one

                    // Delete the pointer to shard for old leader

                    currentEpochMetadata.SHARDS_LEADERS_HANDLERS.delete(pubKeyOfCurrentShardLeader)

                    // Set new value of handler
                    currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(shardID,newLeadersHandler)

                    // Add the pointer: NewShardLeaderPubKey => ShardID 
                    currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(epochHandler.leadersSequence[shardID][newLeadersHandler.currentLeader],shardID)

                    currentEpochMetadata.SYNCHRONIZER.delete('STOP_PROOFS_GENERATION:'+pubKeyOfCurrentShardLeader)

                }).catch(()=>false)

            }

        }

    }

    // Start again
    setImmediate(shardsLeadersMonitoring)
    
}