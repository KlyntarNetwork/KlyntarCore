import {verifyEd25519, verifyEd25519Sync, blake3Hash} from '../../../KLY_Utils/utils.js'

import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES, WORKING_THREADS} from '../globals.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from './quorum_related.js'

import tbls from '../../../KLY_Utils/signatures/threshold/tbls.js'

import bls from '../../../KLY_Utils/signatures/multisig/bls.js'

import {getUserAccountFromState} from './state_interactions.js'

import {BLOCKCHAIN_GENESIS} from '../../../klyntar_core.js'

import {getAllKnownPeers} from '../utils.js'

import Block from '../structures/block.js'








export let verifyTxSignatureAndVersion = async(threadID,tx,senderStorageObject) => {

    
    if(WORKING_THREADS[threadID].CORE_MAJOR_VERSION === tx.v){

        // Sender sign concatenated NETWORK_ID(to prevent cross-chains attacks and reuse nonce & signatures), core version, tx type, JSON'ed payload,nonce and fee
        
        let signedData = BLOCKCHAIN_GENESIS.NETWORK_ID + tx.v + tx.type + JSON.stringify(tx.payload) + tx.nonce + tx.fee
        

        if(tx.sigType==='D') return verifyEd25519(signedData,tx.sig,tx.creator)
        
        if(tx.sigType==='T') return tbls.verifyTBLS(tx.creator,tx.sig,signedData)
        
        if(tx.sigType==='P/D') {

            let isOk = false

            try{

                let appropriatePqcUserAccount = await getUserAccountFromState(tx.creator)

                isOk = blake3Hash(appropriatePqcUserAccount.pqcPub) === tx.creator && globalThis.verifyDilithiumSignature(signedData,appropriatePqcUserAccount.pqcPub,tx.sig)
            
            }catch{ isOk = false }

            return isOk
            
        }
        
        if(tx.sigType==='P/B'){
          
            let isOk = false

            try{

                let appropriatePqcUserAccount = await getUserAccountFromState(tx.creator)

                isOk = blake3Hash(appropriatePqcUserAccount.pqcPub) === tx.creator && globalThis.verifyBlissSignature(signedData,appropriatePqcUserAccount.pqcPub,tx.sig)
            
            }catch{ isOk = false }

            return isOk

        }
        
        if(tx.sigType==='M') return bls.verifyThresholdSignature(tx.payload.active,tx.payload.afk,tx.creator,signedData,tx.sig,senderStorageObject.rev_t)     

    } else return false

}




export let verifyAggregatedEpochFinalizationProof = async (itsProbablyAggregatedEpochFinalizationProof,quorum,majority,epochFullID) => {

    let overviewIsOK =
        
        itsProbablyAggregatedEpochFinalizationProof
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof === 'object'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.lastLeader === 'number'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.lastIndex === 'number'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.lastHash === 'string'
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.hashOfFirstBlockByLastLeader === 'string'
        &&
        itsProbablyAggregatedEpochFinalizationProof.proofs
        &&
        typeof itsProbablyAggregatedEpochFinalizationProof.proofs === 'object'



    if(overviewIsOK && itsProbablyAggregatedEpochFinalizationProof){

        /*
    
            The structure of AGGREGATED_EPOCH_FINALIZATION_PROOF is

            {
                lastLeader:<index of Ed25519 pubkey of some pool in sequences of validators>,
                lastIndex:<index of his block in previous epoch>,
                lastHash:<hash of this block>,
                hashOfFirstBlockByLastLeader,

                proofs:{

                    ed25519PubKey0:ed25519Signa0,
                    ...
                    ed25519PubKeyN:ed25519SignaN
                         
                }

            }

            We need to verify that majority have voted for such solution


        */

        let {lastLeader,lastIndex,lastHash,hashOfFirstBlockByLastLeader} = itsProbablyAggregatedEpochFinalizationProof

        let dataThatShouldBeSigned = `EPOCH_DONE:${lastLeader}:${lastIndex}:${lastHash}:${hashOfFirstBlockByLastLeader}:${epochFullID}`
        
        let okSignatures = 0

        let unique = new Set()
        

        for(let [signerPubKey,signa] of Object.entries(itsProbablyAggregatedEpochFinalizationProof.proofs)){

            let isOK = verifyEd25519Sync(dataThatShouldBeSigned,signa,signerPubKey)

            if(isOK && quorum.includes(signerPubKey) && !unique.has(signerPubKey)){

                unique.add(signerPubKey)

                okSignatures++

            }

        }

    
        if(okSignatures>=majority){

            return {
            
                lastLeader,lastIndex,lastHash,hashOfFirstBlockByLastLeader,
        
                proofs:itsProbablyAggregatedEpochFinalizationProof.proofs

            }

        }
        
    }

}




export let verifyAggregatedFinalizationProof = async (itsProbablyAggregatedFinalizationProof,epochHandler) => {

    // Make the initial overview
    let generalAndTypeCheck =   itsProbablyAggregatedFinalizationProof
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.prevBlockHash === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.blockID === 'string'
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.blockHash === 'string'
                                    &&
                                    itsProbablyAggregatedFinalizationProof.proofs
                                    &&
                                    typeof itsProbablyAggregatedFinalizationProof.proofs === 'object'


    if(generalAndTypeCheck){

        let epochFullID = epochHandler.hash+"#"+epochHandler.id

        let {prevBlockHash,blockID,blockHash,proofs} = itsProbablyAggregatedFinalizationProof

        let dataThatShouldBeSigned = prevBlockHash+blockID+blockHash+epochFullID

        let majority = getQuorumMajority(epochHandler)

        let okSignatures = 0

        let unique = new Set()


        for(let [signerPubKey,signa] of Object.entries(proofs)){

            let isOK = verifyEd25519Sync(dataThatShouldBeSigned,signa,signerPubKey)

            if(isOK && epochHandler.quorum.includes(signerPubKey) && !unique.has(signerPubKey)){

                unique.add(signerPubKey)

                okSignatures++

            }

        }

        return okSignatures >= majority

    }

}




export let getVerifiedAggregatedFinalizationProofByBlockId = async (blockID,epochHandler) => {

    let localVersionOfAfp = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+blockID).catch(()=>null)

    if(!localVersionOfAfp){

        // Go through known hosts and find AGGREGATED_FINALIZATION_PROOF. Call GET /aggregated_finalization_proof route
    
        let setOfUrls = await getQuorumUrlsAndPubkeys(false,epochHandler)

        for(let endpoint of setOfUrls){

            const controller = new AbortController()

            setTimeout(() => controller.abort(), 2000)

            let itsProbablyAggregatedFinalizationProof = await fetch(endpoint+'/aggregated_finalization_proof/'+blockID,{signal:controller.signal}).then(r=>r.json()).catch(()=>null)

            if(itsProbablyAggregatedFinalizationProof){

                let isOK = await verifyAggregatedFinalizationProof(itsProbablyAggregatedFinalizationProof,epochHandler)

                if(isOK){

                    let {prevBlockHash,blockID,blockHash,proofs} = itsProbablyAggregatedFinalizationProof

                    return {prevBlockHash,blockID,blockHash,proofs}

                }

            }

        }

    }else return localVersionOfAfp

}




export let getFirstBlockInEpoch = async(threadID,epochHandler,getBlockFunction) => {

    // Check if we already tried to find first block by finding pivot in cache

    let idOfHandlerWithFirstBlock = `${threadID}:${epochHandler.id}`

    let cache = threadID === 'VERIFICATION_THREAD' ? GLOBAL_CACHES.STUFF_CACHE : GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE

    let pivotData = cache.get(idOfHandlerWithFirstBlock) // {position,pivotPubKey,firstBlockByPivot,firstBlockHash}

    if(!pivotData){

        // Ask known peers about first block assumption

        let arrayOfPools = epochHandler.leadersSequence

        // Get all known peers and call GET /first_block_assumption/:epoch_index

        let allKnownNodes = [...await getQuorumUrlsAndPubkeys(false,epochHandler),...getAllKnownPeers()]

        let promises = []


        for(let node of allKnownNodes){

            const controller = new AbortController()

            setTimeout(() => controller.abort(), 2000)
            
            promises.push(fetch(node+'/first_block_assumption/'+epochHandler.id,{signal:controller.signal}).then(r=>r.json()).catch(()=>null))

        }

        let minimalIndexOfLeader = 100000000000000

        let afpForSecondBlock

        let propositions = await Promise.all(promises).then(responses=>responses.filter(Boolean)) // array where each element is {indexOfFirstBlockCreator, afpForSecondBlock}
        

        for(let proposition of propositions){

            let firstBlockCreator = arrayOfPools[proposition.indexOfFirstBlockCreator]

            if(firstBlockCreator && await verifyAggregatedFinalizationProof(proposition.afpForSecondBlock,epochHandler)){

                let secondBlockIdThatShouldBeInAfp = `${epochHandler.id}:${firstBlockCreator}:1`

                if(secondBlockIdThatShouldBeInAfp === proposition.afpForSecondBlock.blockID && proposition.indexOfFirstBlockCreator < minimalIndexOfLeader){

                    minimalIndexOfLeader = proposition.indexOfFirstBlockCreator

                    afpForSecondBlock = proposition.afpForSecondBlock

                }

            }

        }

        // Now get the assumption of first block(block itself), compare hashes and build the pivot to find the real first block

        let position = minimalIndexOfLeader

        let pivotPubKey = arrayOfPools[position]
        
        let firstBlockByPivot = await getBlockFunction(epochHandler.id,pivotPubKey,0)

        let firstBlockHash = afpForSecondBlock?.prevBlockHash

        
        if(firstBlockByPivot && firstBlockHash === Block.genHash(firstBlockByPivot)){

            // Once we find it - set as pivot for further actions

            let pivotTemplate = {position, pivotPubKey, firstBlockByPivot, firstBlockHash}

            cache.set(idOfHandlerWithFirstBlock,pivotTemplate)

        }

    }

    
    pivotData = cache.get(idOfHandlerWithFirstBlock)


    if(pivotData){

        // In pivot we have first block created in epoch by some pool

        // Try to move closer to the beginning of the epochHandler.leadersSequence to find the real first block

        // Based on ALRP in pivot block - find the real first block

        let blockToEnumerateAlrp = pivotData.firstBlockByPivot

        let arrayOfPools = epochHandler.leadersSequence


        if(pivotData.position === 0){

            cache.delete(idOfHandlerWithFirstBlock)

            return {firstBlockCreator:pivotData.pivotPubKey,firstBlockHash:pivotData.firstBlockHash}

        }


        for(let position = pivotData.position-1 ; position >= 0 ; position--){

        
            let previousPoolInLeadersSequence = arrayOfPools[position]
    
            let leaderRotationProofForPreviousPool = blockToEnumerateAlrp.extraData.aggregatedLeadersRotationProofs[previousPoolInLeadersSequence]


            if(position === 0){

                cache.delete(idOfHandlerWithFirstBlock)

                if(leaderRotationProofForPreviousPool.skipIndex === -1){

                    return {firstBlockCreator:pivotData.pivotPubKey,firstBlockHash:pivotData.firstBlockHash}

                } else return {firstBlockCreator:previousPoolInLeadersSequence,firstBlockHash:leaderRotationProofForPreviousPool.firstBlockHash}


            } else if(leaderRotationProofForPreviousPool.skipIndex !== -1) {

                // This means that we've found new pivot - so update it and break the cycle to repeat procedure later

                let firstBlockByNewPivot = await getBlockFunction(epochHandler.id,previousPoolInLeadersSequence,0)

                if(firstBlockByNewPivot && leaderRotationProofForPreviousPool.firstBlockHash === Block.genHash(firstBlockByNewPivot)){

                    let newPivotTemplate = {

                        position,
    
                        pivotPubKey:previousPoolInLeadersSequence,
    
                        firstBlockByPivot:firstBlockByNewPivot,
    
                        firstBlockHash:leaderRotationProofForPreviousPool.firstBlockHash
    
                    }

                    cache.set(idOfHandlerWithFirstBlock,newPivotTemplate)

                    break

                } else return

            }
    
        }

    }

}




export let verifyQuorumMajoritySolution = (dataThatShouldBeSigned,agreementsMapping) => {

    // Take the epoch handler on verification thread (VT)

    let epochHandler = WORKING_THREADS.VERIFICATION_THREAD.EPOCH
    
    let majority = getQuorumMajority(epochHandler)

    let okSignatures = 0


    for(let [quorumMemberPubKey,signa] of Object.entries(agreementsMapping)){

        if(verifyEd25519Sync(dataThatShouldBeSigned,signa,quorumMemberPubKey) && epochHandler.quorum.includes(quorumMemberPubKey)){

            okSignatures++

        }

    }

    return okSignatures >= majority
    
}