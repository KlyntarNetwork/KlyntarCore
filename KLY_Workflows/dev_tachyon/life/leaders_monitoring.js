import {getFromApprovementThreadState} from '../common_functions/approvement_thread_related.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {blake3Hash, getUtcTimestamp} from '../../../KLY_Utils/utils.js'

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
    
    let epochIndex = epochHandler.id

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

        
    let pubKeyOfCurrentLeader = currentEpochMetadata.CURRENT_LEADER_PUBKEY

    let indexOfCurrentLeader = epochHandler.leadersSequence.indexOf(pubKeyOfCurrentLeader)

    // In case more pools in sequence exists - we can move to it. Otherwise - no sense to change pool as leader because no more candidates

    let itsNotFinishOfSequence = epochHandler.leadersSequence[indexOfCurrentLeader+1]

    if(itsNotFinishOfSequence && timeIsOutForCurrentLeader(epochHandler,indexOfCurrentLeader,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.LEADERSHIP_TIMEFRAME)){

        // Now, update the LEADERS_HANDLER

        let nextLeaderPubkey = epochHandler.leadersSequence[indexOfCurrentLeader+1]

        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('CURRENT_LEADER:'+epochIndex,nextLeaderPubkey).then(()=>{

            currentEpochMetadata.CURRENT_LEADER_PUBKEY = nextLeaderPubkey

        }).catch(()=>null)

    }


    // Start again

    setImmediate(leadersSequenceMonitoring)
    
}