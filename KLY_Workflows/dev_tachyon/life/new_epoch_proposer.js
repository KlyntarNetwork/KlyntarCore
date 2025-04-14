import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, GLOBAL_CACHES, WORKING_THREADS} from '../globals.js'

import {signEd25519, verifyEd25519} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyntar_core.js'




export let grabEpochFinalizationProofs=async()=>{

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochIndex = atEpochHandler.id

    let epochHash = atEpochHandler.hash

    let epochFullID = epochHash+"#"+epochIndex

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)
    

    if(!currentEpochMetadata){

        return

    }


    let iAmSequencer = CONFIGURATION.NODE_LEVEL.PUBLIC_KEY === CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER


    if(iAmSequencer){
    
        let pubKeyOfLeader = CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER

        let epochFinishProposition = {payload:{}, payloadSignature:''}

        let majority = getQuorumMajority(atEpochHandler)

        // Structure is Map(quorumMember=>SIG('EPOCH_DONE'+lastLeaderIndex+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId))
        
        let agreements = GLOBAL_CACHES.TEMP_CACHE.get('EPOCH_PROPOSITION')

        if(!agreements){

            agreements = new Map()

            GLOBAL_CACHES.TEMP_CACHE.set('EPOCH_PROPOSITION',agreements)
        
        }

        let aefpExistsLocally = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${atEpochHandler.id}`).catch(()=>null)

        let proofsGrabber = GLOBAL_CACHES.TEMP_CACHE.get('PROOFS_GRABBER')

        if(!aefpExistsLocally && proofsGrabber && proofsGrabber.finishedVoting){

            let firstBlockID = atEpochHandler.id+':'+pubKeyOfLeader+':0'

            let afpForFirstBlock = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+firstBlockID).catch(()=>({}))

            epochFinishProposition.payload = {

                epochIndex,

                epochHash,

                afpForFirstBlock,

                lastBlockProposition:{ index: proofsGrabber.acceptedIndex, hash: proofsGrabber.acceptedHash, afp: proofsGrabber.afpForPrevious }

            }

        }


        //____________________________________ Send the epoch finish proposition ____________________________________

        // Also, as a sequencer we need to sign the proposition

        epochFinishProposition.payloadSignature = await signEd25519(JSON.stringify(epochFinishProposition.payload),CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)

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

                    let agreements = GLOBAL_CACHES.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature                        

                    if(possibleAgreements){

                        if(possibleAgreements.status==='OK'){

                            // Verify EPOCH_FINALIZATION_PROOF signature and store to mapping

                            let dataThatShouldBeSigned = `EPOCH_DONE:0:${epochFinishProposition.payload.lastBlockProposition.index}:${epochFinishProposition.payload.lastBlockProposition.hash}:${epochFinishProposition.payload.afpForFirstBlock.blockHash}:${epochFullID}`

                            if(await verifyEd25519(dataThatShouldBeSigned,possibleAgreements.sig,descriptor.pubKey)) agreements.set(descriptor.pubKey,possibleAgreements.sig)


                        }

                    }

                }
                
            }).catch(()=>{});
            
            
        }
            


        let agreementsForEpochManager = GLOBAL_CACHES.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature

        if(agreementsForEpochManager.size >= majority && epochFinishProposition.payload && epochFinishProposition.payload.lastBlockProposition){
        
            let aggregatedEpochFinalizationProof = {

                epochIndex,

                epochHash,

                lastLeader: 0,
                
                lastIndex: epochFinishProposition.payload.lastBlockProposition.index,
                
                lastHash: epochFinishProposition.payload.lastBlockProposition.hash,

                hashOfFirstBlockByLastLeader: epochFinishProposition.payload.afpForFirstBlock.blockHash,

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