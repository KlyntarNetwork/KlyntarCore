import {getFromApprovementThreadState} from './approvement_thread_related.js'

import {blake3Hash} from '../../../KLY_Utils/utils.js'

import {WORKING_THREADS} from '../globals.js'




export let getQuorumMajority = epochHandler => {

    let quorumSize = epochHandler.quorum.length

    let majority = Math.floor(quorumSize*(2/3))+1


    // Check if majority is not bigger than number of pools. It's possible when there is a small number of pools

    return majority > quorumSize ? quorumSize : majority

}




export let getQuorumUrlsAndPubkeys = async (withPubkey,epochHandler) => {

    let toReturn = []

    epochHandler ||= WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    for(let pubKey of epochHandler.quorum){

        let poolStorage = await getFromApprovementThreadState(pubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        if(poolStorage){

            toReturn.push(withPubkey ? {url:poolStorage.poolURL,pubKey} : poolStorage.poolURL)
        
        }

    }

    return toReturn

}




export let getPseudoRandomSubsetFromQuorumByTicketId=(ticketID,epochHandler)=>{

    // If QUORUM_SIZE > 21 - do challenge, otherwise - return the whole quorum
    
    if(epochHandler.quorum.length > 21){

        // Based on ticket_id + epochHandler.hash as a seed value - generate 21 values in range [0;quorum.size]

        // Then, return the resulting array of 21 validators by indexes in <quorum> array

        let subsetToReturn = []

        for(let i=0 ; i < 21 ; i++) {

            let seed = blake3Hash(`${epochHandler.hash}:${ticketID}:${i}`)

            // Hex => Number
            let hashAsNumber = parseInt(seed, 16);
    
            // Normalize to [0, 1]
            let normalizedValue = hashAsNumber / (parseInt('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16) + 1);
    
            let min = 0, max = epochHandler.quorum.length-1
    
            // Normalize to [min, max]
            let scaledValue = min + Math.floor(normalizedValue * (max - min + 1))
                
            subsetToReturn.push(epochHandler.quorum[scaledValue])

        }

        return subsetToReturn


    } else return epochHandler.quorum


}



// We get the quorum based on pools' metadata(pass via parameter)

export let getCurrentEpochQuorum = async (poolsRegistry, networkParams, newEpochSeed) => {

    if (poolsRegistry.length <= networkParams.QUORUM_SIZE) {
        
        return poolsRegistry
    
    }

    let validatorsExtendedData = new Map()
    
    let totalStakeSum = 0

    for (let validatorPubKey of poolsRegistry) {

        let validatorData = await getFromApprovementThreadState(validatorPubKey+'(POOL)_STORAGE_POOL')

        let requiredData = {

            validatorPubKey, 
        
            totalStake: validatorData.totalStakedKly + validatorData.totalStakedUno 
        
        }

        totalStakeSum += requiredData.totalStake

        validatorsExtendedData.set(validatorPubKey, requiredData)
    
    }

    let weightedSelection = []

    for (let i = 0; i < networkParams.QUORUM_SIZE; i++) {

        let cumulativeSum = 0
        
        let hashInput = `${newEpochSeed}_${i}`
        
        let deterministicRandomValue = parseInt(blake3Hash(hashInput), 16) % totalStakeSum

        for (let [validatorPubKey, validator] of validatorsExtendedData) {

            cumulativeSum += validator.totalStake

            if (deterministicRandomValue <= cumulativeSum) {

                weightedSelection.push(validator.validatorPubKey)

                totalStakeSum -= validator.totalStake

                validatorsExtendedData.delete(validatorPubKey)
                
                break
            
            }
        
        }
    
    }

    return weightedSelection

}