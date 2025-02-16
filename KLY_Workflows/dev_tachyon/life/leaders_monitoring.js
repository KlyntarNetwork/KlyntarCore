import {getFromApprovementThreadState, useTemporaryDb} from '../common_functions/approvement_thread_related.js'

import {blake3Hash, getUtcTimestamp} from '../../../KLY_Utils/utils.js'

import {EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {epochStillFresh} from '../utils.js'







let timeIsOutForCurrentLeader=(epochHandler,indexOfCurrentLeaderInSequence,leaderShipTimeframe)=>{

    // Function to check if time frame for current leader is done and we have to move to next pool in sequence

    return getUtcTimestamp() >= epochHandler.startTimestamp+(indexOfCurrentLeaderInSequence+1)*leaderShipTimeframe

}




export let setLeadersSequence = async (epochHandler,epochSeed) => {


    epochHandler.leadersSequence = [] // [pool0,pool1,...poolN] 


    let hashOfMetadataFromOldEpoch = blake3Hash(JSON.stringify(epochHandler.poolsRegistry)+epochSeed)


    // Change order of validators pseudo-randomly

    let validatorsExtendedData = new Map()
    
    let totalStakeSum = BigInt(0)

    for (let validatorPubKey of epochHandler.poolsRegistry) {

        let validatorData = await getFromApprovementThreadState(validatorPubKey+'(POOL)_STORAGE_POOL')

        let requiredData = {

            validatorPubKey, 
        
            totalStake: BigInt(validatorData.totalStakedKly) + BigInt(validatorData.totalStakedUno) 
        
        }

        totalStakeSum += requiredData.totalStake

        validatorsExtendedData.set(validatorPubKey, requiredData)
    
    }
    

    for (let i = 0; i < epochHandler.poolsRegistry.length; i++) {

        let cumulativeSum = BigInt(0)
        
        let hashInput = `${hashOfMetadataFromOldEpoch}_${i}`
        
        let deterministicRandomValue = BigInt(parseInt(blake3Hash(hashInput), 16)) % totalStakeSum

        for (let [validatorPubKey, validator] of validatorsExtendedData) {

            cumulativeSum += validator.totalStake

            if (deterministicRandomValue <= cumulativeSum) {

                if(!epochHandler.leadersSequence) epochHandler.leadersSequence = []
        
                epochHandler.leadersSequence.push(validatorPubKey)

                totalStakeSum -= validator.totalStake

                validatorsExtendedData.delete(validatorPubKey)
                
                break
            
            }
        
        }
    
    }
            
}




export let leadersSequenceMonitoring=async()=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){

        setTimeout(leadersSequenceMonitoring,3000)

        return

    }


    if(!epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)){

        setTimeout(leadersSequenceMonitoring,3000)

        return

    }


    let infoAboutCurrentLeader = currentEpochMetadata.CURRENT_LEADER_INFO
        
    let indexOfCurrentLeader = infoAboutCurrentLeader.index
        
    let pubKeyOfCurrentLeader = infoAboutCurrentLeader.pubKey


    // In case more pools in sequence exists - we can move to it. Otherwise - no sense to change pool as leader because no more candidates

    let itsNotFinishOfSequence = epochHandler.leadersSequence[indexOfCurrentLeader+1]

    if(itsNotFinishOfSequence && timeIsOutForCurrentLeader(epochHandler,indexOfCurrentLeader,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.LEADERSHIP_TIMEFRAME)){

        // Inform websocket server that we shouldn't generate proofs for this leader anymore
        currentEpochMetadata.SYNCHRONIZER.set('STOP_PROOFS_GENERATION:'+pubKeyOfCurrentLeader,true)

        // But anyway - in async env wait until server callback us here that proofs creation is stopped
        if(!currentEpochMetadata.SYNCHRONIZER.has('GENERATE_FINALIZATION_PROOFS:'+pubKeyOfCurrentLeader)){

            // Now, update the LEADERS_HANDLER

            let newInfoAboutCurrentLeader = {
                    
                index: indexOfCurrentLeader+1,

                pubKey: epochHandler.leadersSequence[indexOfCurrentLeader+1]
                
            }

            await useTemporaryDb('put',currentEpochMetadata.DATABASE,'CURRENT_LEADER_INFO',newInfoAboutCurrentLeader).then(()=>{

                // Set new leader and delete the old one

                currentEpochMetadata.CURRENT_LEADER_INFO = newInfoAboutCurrentLeader
                
                currentEpochMetadata.SYNCHRONIZER.delete('STOP_PROOFS_GENERATION:'+pubKeyOfCurrentLeader)

            }).catch(()=>false)

        }

    }


    // Start again
    setImmediate(leadersSequenceMonitoring)
    
}