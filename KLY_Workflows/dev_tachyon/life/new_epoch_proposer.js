import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {verifyEd25519} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyntar_core.js'




export let grabEpochFinalizationProofs=async()=>{

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)
    

    if(!currentEpochMetadata){

        return

    }


    let iAmSequencer = CONFIGURATION.NODE_LEVEL.PUBLIC_KEY === CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER


    if(iAmSequencer){
    
        let pubKeyOfLeader = CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER

        let epochFinishProposition = {}

        let majority = getQuorumMajority(atEpochHandler)

        // Structure is Map(quorumMember=>SIG('EPOCH_DONE'+lastLeaderIndex+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId))
        
        let agreements = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION')

        if(!agreements){

            agreements = new Map()

            currentEpochMetadata.TEMP_CACHE.set('EPOCH_PROPOSITION',agreements)
        
        }

        let aefpExistsLocally = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${atEpochHandler.id}`).catch(()=>null)

        let proofsGrabber = currentEpochMetadata.TEMP_CACHE.get('PROOFS_GRABBER')

        if(!aefpExistsLocally && proofsGrabber && proofsGrabber.acceptedIndex > 1){

            let firstBlockID = atEpochHandler.id+':'+pubKeyOfLeader+':0'

            let afpForFirstBlock = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+firstBlockID).catch(()=>({}))

            epochFinishProposition = {

                afpForFirstBlock,

                lastBlockProposition:{ index: proofsGrabber.acceptedIndex, hash: proofsGrabber.acceptedHash, afp: proofsGrabber.afpForPrevious }

            }

        }


        //____________________________________ Send the epoch finish proposition ____________________________________


        let optionsToSend = {method:'POST',body:JSON.stringify(epochFinishProposition)}
        
        let quorumMembers = await getQuorumUrlsAndPubkeys(true)

        //Descriptor is {url,pubKey}

        for(let descriptor of quorumMembers){
            
            const controller = new AbortController()

            setTimeout(() => controller.abort(), 2000)

            optionsToSend.signal = controller.signal

            await fetch(descriptor.url+'/epoch_proposition',optionsToSend).then(r=>r.json()).then(async possibleAgreements => {

                /*
                
                    possibleAgreements structure is:
                    
                    
                        {
                            status:'OK',

                            sig: SIG('EPOCH_DONE'+lastLeaderIndex+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId)
                        }
                
                
                */
                

                if(typeof possibleAgreements === 'object'){                    

                    let agreements = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature                        

                    if(possibleAgreements){

                        if(possibleAgreements.status==='OK'){

                            // Verify EPOCH_FINALIZATION_PROOF signature and store to mapping

                            let dataThatShouldBeSigned = `EPOCH_DONE:0:${epochFinishProposition.lastBlockProposition.index}:${epochFinishProposition.lastBlockProposition.hash}:${epochFinishProposition.afpForFirstBlock.blockHash}:${epochFullID}`

                            if(await verifyEd25519(dataThatShouldBeSigned,possibleAgreements.sig,descriptor.pubKey)) agreements.set(descriptor.pubKey,possibleAgreements.sig)


                        }

                    }

                }
                
            }).catch(()=>{});
            
            
        }
            


        let agreementsForEpochManager = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature

        if(agreementsForEpochManager.size >= majority && epochFinishProposition && epochFinishProposition.lastBlockProposition){
        
            let aggregatedEpochFinalizationProof = {

                lastLeader: 0,
                
                lastIndex: epochFinishProposition.lastBlockProposition.index,
                
                lastHash: epochFinishProposition.lastBlockProposition.hash,

                hashOfFirstBlockByLastLeader: epochFinishProposition.afpForFirstBlock.blockHash,

                proofs:Object.fromEntries(agreementsForEpochManager)
                
            }                

            // Make final verification

            if(await verifyAggregatedEpochFinalizationProof(aggregatedEpochFinalizationProof,atEpochHandler.quorum,majority,epochFullID)){

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`AEFP:${atEpochHandler.id}`,aggregatedEpochFinalizationProof).catch(()=>{})

            } else {

                agreementsForEpochManager.clear()

            }

        }

    }

}