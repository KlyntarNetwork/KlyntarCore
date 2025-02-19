import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS, NODE_METADATA} from '../globals.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {signEd25519, verifyEd25519Sync} from '../../../KLY_Utils/utils.js'

import {blockLog} from '../common_functions/logging.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

import {getAllKnownPeers} from '../utils.js'

import Block from '../structures/block.js'

import fetch from 'node-fetch'




export let blocksGenerationProcess=async()=>{

    await generateBlocksPortion()

    setTimeout(blocksGenerationProcess,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.BLOCK_TIME)    
 
}


let getTransactionsFromMempool = () => NODE_METADATA.MEMPOOL.splice(0,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK)



/*

Function to find the AGGREGATED_EPOCH_FINALIZATION_PROOFS

Ask the network in special order:

    1) Special configured URL (it might be plugin's API)
    2) Quorum members
    3) Other known peers

*/
let getAggregatedEpochFinalizationProofForPreviousEpoch = async epochHandler => {


    let allKnownNodes = [CONFIGURATION.NODE_LEVEL.GET_PREVIOUS_EPOCH_AGGREGATED_FINALIZATION_PROOF_URL,...await getQuorumUrlsAndPubkeys(),...getAllKnownPeers()]

    let previousEpochIndex = epochHandler.id-1

    let legacyEpochHandler = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HANDLER:${previousEpochIndex}`).catch(()=>null)

    let legacyEpochFullID = legacyEpochHandler.hash+"#"+legacyEpochHandler.id

    let legacyMajority = await getQuorumMajority(legacyEpochHandler)

    let legacyQuorum = legacyEpochHandler.quorum

    // First of all - try to find it locally

    let aefpProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${previousEpochIndex}`).catch(()=>null)

    if(aefpProof) return aefpProof

    else {

        for(let nodeEndpoint of allKnownNodes){

            const controller = new AbortController()

            setTimeout(() => controller.abort(), 2000)

            let finalURL = `${nodeEndpoint}/aggregated_epoch_finalization_proof/${previousEpochIndex}`
    
            let itsProbablyAggregatedEpochFinalizationProof = await fetch(finalURL,{signal:controller.signal}).then(r=>r.json()).catch(()=>false)
    
            let aefpProof = await verifyAggregatedEpochFinalizationProof(
                
                itsProbablyAggregatedEpochFinalizationProof,
    
                legacyQuorum,
    
                legacyMajority,        
    
                legacyEpochFullID
            
            )
    
            if(aefpProof) return aefpProof
    
        }    

    }
    
}





let getAggregatedLeaderRotationProof = (epochHandler,pubKeyOfOneOfPreviousLeader,hisIndexInLeadersSequence) => {

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return


    // Try to return immediately
    
    let aggregatedLeaderRotationMetadata = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`)

    let quorumMajority = getQuorumMajority(epochHandler)

    if(aggregatedLeaderRotationMetadata && Object.keys(aggregatedLeaderRotationMetadata.proofs).length >= quorumMajority){

        let {afpForFirstBlock,skipIndex,skipHash,proofs} = aggregatedLeaderRotationMetadata

        let dataToReturn = {

            firstBlockHash: afpForFirstBlock.blockHash,

            skipIndex, skipHash, proofs

        }

        return dataToReturn

    }


    // Prepare the template that we're going to send to quorum to get the ALRP

    // Create the cache to store LRPs for appropriate previous leader

    if(!currentEpochMetadata.TEMP_CACHE.has(`LRPS:${pubKeyOfOneOfPreviousLeader}`)){

        let templateToStore = {

            afpForFirstBlock:{blockHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'},

            skipIndex:-1,

            skipHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

            skipAfp:{},

            proofs:{} // quorumMemberPubkey => SIG(`LEADER_ROTATION_PROOF:${pubKeyOfOneOfPreviousLeader}:${afpForFirstBlock.blockHash}:${skipIndex}:${skipHash}:${epochFullID}`)

        }

        currentEpochMetadata.TEMP_CACHE.set(`LRPS:${pubKeyOfOneOfPreviousLeader}`,templateToStore)
    
    }

    let futureAlrpMetadata = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`)

    let messageToSend = JSON.stringify({

        route:'get_leader_rotation_proof',

        afpForFirstBlock: futureAlrpMetadata.afpForFirstBlock,

        poolPubKey:pubKeyOfOneOfPreviousLeader,

        hisIndexInLeadersSequence,
        
        skipData:{

            index: futureAlrpMetadata.skipIndex,

            hash: futureAlrpMetadata.skipHash,

            afp: futureAlrpMetadata.skipAfp

        }
    
    })


    for(let pubKeyOfQuorumMember of epochHandler.quorum){
    
        // No sense to get finalization proof again if we already have

        if(futureAlrpMetadata.proofs[pubKeyOfQuorumMember]) continue

        let connection = currentEpochMetadata.TEMP_CACHE.get('WS:'+pubKeyOfQuorumMember)

        if(connection) connection.sendUTF(messageToSend)

    }

}



let getBatchOfApprovedDelayedTxsByQuorum = async indexOfLeader => {

    // Get the batch of delayed operations from storage

    let epochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id

    if(indexOfLeader !== 0) return {epochIndex,delayedTransactions:[],proofs:{}}

    
    let delayedTransactions = await BLOCKCHAIN_DATABASES.STATE.get(`DELAYED_TRANSACTIONS:${epochIndex}`).catch(()=>null)

    if(Array.isArray(delayedTransactions)){

        // Ask quorum majority to sign this batch

        let majority = getQuorumMajority(WORKING_THREADS.APPROVEMENT_THREAD.EPOCH)

        let quorumMembers = await getQuorumUrlsAndPubkeys(true,WORKING_THREADS.APPROVEMENT_THREAD.EPOCH)

        let optionsToSend = {
            
            method:'POST',
            
            body:JSON.stringify({epochIndex, delayedTransactions})
        
        }

        let agreements = new Map() // validator => signa

        let dataThatShouldBeSigned = `SIG_DELAYED_OPERATIONS:${epochIndex}:${JSON.stringify(delayedTransactions)}`

        // Descriptor is {url,pubKey}

        let promises = []

        for(let descriptor of quorumMembers){
            
            const controller = new AbortController()

            setTimeout(() => controller.abort(), 2000)

            optionsToSend.signal = controller.signal

            promises.push(fetch(descriptor.url+'/sign_delayed_ops_batch',optionsToSend).then(r=>r.json()).then(async possibleAgreement => {

                /*
                
                    possibleAgreements structure is:

                    {
                        sig: SIG(dataThatShouldBeSigned)
                    }
                    
                
                */

                if(possibleAgreement && typeof possibleAgreement === 'object'){
                    
                    if(possibleAgreement){

                        if(verifyEd25519Sync(dataThatShouldBeSigned,possibleAgreement.sig,descriptor.pubKey)){

                            agreements.set(descriptor.pubKey,possibleAgreement.sig)

                        }

                    }

                }
                
            }).catch(()=>{}))
            
        }

        await Promise.all(promises)

        if(agreements.size >= majority){

            let dataToReturn = {

                epochIndex,

                delayedTransactions,

                proofs: Object.fromEntries(dataToReturn)
                
            }

            return dataToReturn
            
        } else return {epochIndex,delayedTransactions:[],proofs:{}}

    } else return {epochIndex,delayedTransactions:[],proofs:{}}

}



let generateBlocksPortion = async() => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let epochIndex = epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return


    //_________________ No sense to generate blocks more in case we haven't approved the previous ones _________________

    let proofsGrabber = currentEpochMetadata.TEMP_CACHE.get('PROOFS_GRABBER')

    if(proofsGrabber && WORKING_THREADS.GENERATION_THREAD.epochFullId === epochFullID && WORKING_THREADS.GENERATION_THREAD.nextIndex > proofsGrabber.acceptedIndex+1) return

    // Safe "if" branch to prevent unnecessary blocks generation    
    
    if(currentEpochMetadata.CURRENT_LEADER_INFO.pubKey === CONFIGURATION.NODE_LEVEL.PUBLIC_KEY){

        // Check if <epochFullID> is the same in APPROVEMENT_THREAD and in GENERATION_THREAD

        if(WORKING_THREADS.GENERATION_THREAD.epochFullId !== epochFullID){

            // If new epoch - add the aggregated proof of previous epoch finalization

            if(epochIndex !== 0){

                let aefpForPreviousEpoch = await getAggregatedEpochFinalizationProofForPreviousEpoch(epochHandler)

                // If we can't find a proof - try to do it later
                // Only in case it's initial epoch(index is -1) - no sense to push it
                if(!aefpForPreviousEpoch) return

                WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch = aefpForPreviousEpoch

            }

            // Update the index & hash of epoch

            WORKING_THREADS.GENERATION_THREAD.epochFullId = epochFullID

            WORKING_THREADS.GENERATION_THREAD.epochIndex = epochIndex

            // Recount new values

            WORKING_THREADS.GENERATION_THREAD.quorum = epochHandler.quorum

            WORKING_THREADS.GENERATION_THREAD.majority = getQuorumMajority(epochHandler)


            // And nullish the index & hash in generation thread for new epoch

            WORKING_THREADS.GENERATION_THREAD.prevHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
 
            WORKING_THREADS.GENERATION_THREAD.nextIndex = 0
    
        }

        let extraData = {}


        // Do it only for the first block in epoch(with index 0)

        if(WORKING_THREADS.GENERATION_THREAD.nextIndex === 0){

            //___________________ Add the AEFP to the first block of epoch ___________________

            if(WORKING_THREADS.GENERATION_THREAD.epochIndex > 0){

                // Add the AEFP for previous epoch

                extraData.aefpForPreviousEpoch = WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch

                if(!extraData.aefpForPreviousEpoch) return

            }

            // Build the template to insert to the extraData of block. Structure is {pool0:ALRP,...,poolN:ALRP}
    
            let myIndexInLeadersSequence = epochHandler.leadersSequence.indexOf(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)
    
            // Get all previous pools - from zero to <my_position>

            let pubKeysOfAllThePreviousPools = epochHandler.leadersSequence.slice(0,myIndexInLeadersSequence).reverse()

            let indexOfPreviousLeaderInSequence = myIndexInLeadersSequence-1

            let previousLeaderPubkey = epochHandler.leadersSequence[indexOfPreviousLeaderInSequence]


            extraData.delayedTxsBatch = await getBatchOfApprovedDelayedTxsByQuorum(currentEpochMetadata.CURRENT_LEADER_INFO.index)


            //_____________________ Fill the extraData.aggregatedLeadersRotationProofs _____________________


            extraData.aggregatedLeadersRotationProofs = {}

            /*

                Here we need to fill the object with aggregated leader rotation proofs (ALRPs) for all the previous pools till the pool which was rotated on not-zero height
            
                If we can't find all the required ALRPs - skip this iteration to try again later

            */

            // Add the ALRP for the previous pools in leaders sequence

            for(let leaderPubKey of pubKeysOfAllThePreviousPools){

                let vtStatsPerPool = WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[leaderPubKey] || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

                let votingFinalizationPerPool = currentEpochMetadata.FINALIZATION_STATS.get(leaderPubKey) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

                let proofThatAtLeastFirstBlockWasCreated = vtStatsPerPool.index !== 0 || votingFinalizationPerPool.index !== 0

                // We 100% need ALRP for previous pool
                // But no need in pools who created at least one block in epoch and it's not our previous pool
                
                if(leaderPubKey !== previousLeaderPubkey && proofThatAtLeastFirstBlockWasCreated) break


                let aggregatedLeaderRotationProof = getAggregatedLeaderRotationProof(epochHandler,leaderPubKey,indexOfPreviousLeaderInSequence)
                
                if(aggregatedLeaderRotationProof){                    

                    extraData.aggregatedLeadersRotationProofs[leaderPubKey] = aggregatedLeaderRotationProof

                    if(aggregatedLeaderRotationProof.skipIndex >= 0) break // if we hit the ALRP with non-null index(at least index >= 0) it's a 100% that sequence is not broken, so no sense to push ALRPs for previous pools 

                    indexOfPreviousLeaderInSequence--

                } else return

            }

        }

        /*

        _________________________________________GENERATE PORTION OF BLOCKS___________________________________________
    
        Here we check how many transactions(events) we have locally and generate as many blocks as it's possible
    
        */

        let numberOfBlocksToGenerate = Math.ceil(NODE_METADATA.MEMPOOL.length / WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK)


        //_______________________________________FILL THE BLOCK WITH EXTRA DATA_________________________________________

        // 0. Add the extra data to block from configs(it might be your note, for instance)

        extraData.rest = {...CONFIGURATION.NODE_LEVEL.EXTRA_DATA_TO_BLOCK}


        if(numberOfBlocksToGenerate===0) numberOfBlocksToGenerate++

        let atomicBatch = BLOCKCHAIN_DATABASES.BLOCKS.batch()

        for(let i=0;i<numberOfBlocksToGenerate;i++){


            let blockCandidate = new Block(getTransactionsFromMempool(),extraData,WORKING_THREADS.GENERATION_THREAD.epochFullId)
                            
            let hash = Block.genHash(blockCandidate)
    
    
            blockCandidate.sig = await signEd25519(hash,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                
            blockLog(`New block generated`,hash,blockCandidate,WORKING_THREADS.GENERATION_THREAD.epochIndex)
    
    
            WORKING_THREADS.GENERATION_THREAD.prevHash = hash
     
            WORKING_THREADS.GENERATION_THREAD.nextIndex++
        
            // BlockID has the following format => epochID(epochIndex):Ed25519_Pubkey:IndexOfBlockInCurrentEpoch
            let blockID = WORKING_THREADS.GENERATION_THREAD.epochIndex+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+blockCandidate.index
    
            // Store block locally
            atomicBatch.put(blockID,blockCandidate)
               
        }
    
        // Update the GENERATION_THREAD after all
        atomicBatch.put('GT',WORKING_THREADS.GENERATION_THREAD)
    
        await atomicBatch.write()
    
    }

}