import {verifyAggregatedEpochFinalizationProof, verifyAggregatedFinalizationProof} from '../common_functions/work_with_proofs.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {useTemporaryDb} from '../common_functions/approvement_thread_related.js'

import {verifyEd25519} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import {epochStillFresh} from '../utils.js'




export let checkIfItsTimeToStartNewEpoch=async()=>{

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)
    

    if(!currentEpochMetadata){

        setTimeout(checkIfItsTimeToStartNewEpoch,3000)

        return

    }


    let iAmInTheQuorum = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum.includes(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)


    if(iAmInTheQuorum && !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)){
        
        // Stop to generate finalization proofs
        currentEpochMetadata.SYNCHRONIZER.set('TIME_TO_NEW_EPOCH',true)

        let canGenerateEpochFinalizationProof = true

        let pubKeyOfLeader = currentEpochMetadata.CURRENT_LEADER_INFO.pubKey

        let indexOfLeader = currentEpochMetadata.CURRENT_LEADER_INFO.index


        if(currentEpochMetadata.SYNCHRONIZER.has('GENERATE_FINALIZATION_PROOFS:'+pubKeyOfLeader)){

            canGenerateEpochFinalizationProof = false

        }
        

        if(canGenerateEpochFinalizationProof){

            await useTemporaryDb('put',currentEpochMetadata.DATABASE,'TIME_TO_NEW_EPOCH',true).then(()=>

                currentEpochMetadata.SYNCHRONIZER.set('READY_FOR_NEW_EPOCH',true)


            ).catch(()=>{})

        }
        

        // Check the safety
        if(!currentEpochMetadata.SYNCHRONIZER.has('READY_FOR_NEW_EPOCH')){

            setTimeout(checkIfItsTimeToStartNewEpoch,3000)

            return

        }
    

        let epochFinishProposition = {}

        let majority = getQuorumMajority(atEpochHandler)

        let leadersSequence = atEpochHandler.leadersSequence // [pool0,pool1,...,poolN]


        /*
            
            Now to avoid loops, check if last leader created at least 1 block
            
        */

        let localVotingDataForLeader = currentEpochMetadata.FINALIZATION_STATS.get(pubKeyOfLeader) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

        if(localVotingDataForLeader.index === -1){

            // Change to previous leader that finish its work on height > -1

            for(let position = indexOfLeader-1 ; position >= 0 ; position --){

                let previousLeader = atEpochHandler.leadersSequence[position]

                let localVotingData = currentEpochMetadata.FINALIZATION_STATS.get(previousLeader) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

                if(localVotingData.index > -1){

                    pubKeyOfLeader = previousLeader

                    indexOfLeader = position

                    // Also, change the value in pointer to current leader

                    currentEpochMetadata.CURRENT_LEADER_INFO = {index:position, pubKey:previousLeader}

                    break

                }

            }

        }

        // Structure is Map(quorumMember=>SIG('EPOCH_DONE'+lastLeaderInRcIndex+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId))
        
        let agreements = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION')

        if(!agreements){

            agreements = new Map()

            currentEpochMetadata.TEMP_CACHE.set('EPOCH_PROPOSITION',agreements)
        
        }

                    /*
            
                Thanks to verification process of block 0 on route POST /block (see routes/main.js) we know that each block created by leader will contain all the ALRPs
        
                1) Start to build epoch finalization proposition. This object has the following structure


                {

                 currentLeader:<int - pointer to current leader based on AT.EPOCH.leadersSequence>

                        lastBlockProposition:{
                            index:,
                            hash:,
                            
                            afp:{

                                prevBlockHash:<must be the same as lastBlockProposition.hash>

                                blockID:<must be next to lastBlockProposition.index>,

                                blockHash,

                                proofs:{

                                    quorumMember0_Ed25519PubKey: ed25519Signa0,
                                    ...
                                    quorumMemberN_Ed25519PubKey: ed25519SignaN
                
                                }

                            }
                    
                        }

                }


                2) Take the <lastBlockProposition> for <currentLeader> from TEMP.get(<epochFullID>).FINALIZATION_STATS

                3) If nothing in FINALIZATION_STATS - then set index to -1 and hash to default(0123...)

                4) Send epoch propostion to POST /epoch_proposition to all(or at least 2/3N+1) quorum members


                ____________________________________________After we get responses____________________________________________

                5) If validator agree with all the propositions - it generate signatures to paste this short proof to the fist block in the next epoch(to section block.extraData.aefpForPreviousEpoch)

                6) If we get 2/3N+1 agreements - aggregate it and store locally. This called AGGREGATED_EPOCH_FINALIZATION_PROOF (AEFP)

                    The structure is


                       {
                
                            lastLeader:<index of Ed25519 pubkey of some pool in sequence of validators>,
                            lastIndex:<index of his block in previous epoch>,
                            lastHash:<hash of this block>,
                            firstBlockHash,

                            proofs:{

                                ed25519PubKey0:ed25519Signa0,
                                ...
                                ed25519PubKeyN:ed25519SignaN
                         
                            }

                        }


                7) Then, we can share these proofs by route GET /aggregated_epoch_finalization_proof/:EPOCH_ID

                8) Pools can query network for this proofs to set to <block.extraData.aefpForPreviousEpoch> to know where to start VERIFICATION_THREAD in a new epoch                
                

            */


        let aefpExistsLocally = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${atEpochHandler.id}`).catch(()=>false)

        if(!aefpExistsLocally){

            epochFinishProposition = {

                currentLeader:indexOfLeader,

                afpForFirstBlock:{},

                lastBlockProposition:currentEpochMetadata.FINALIZATION_STATS.get(pubKeyOfLeader) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

            }

            // In case we vote for index > 0 - we need to add the AFP proof to proposition as a proof that first block by this leader has such hash
            // This will be added to AEFP and used on verification thread

            if(epochFinishProposition.lastBlockProposition.index >= 0){

                let firstBlockID = atEpochHandler.id+':'+pubKeyOfLeader+':0'

                epochFinishProposition.afpForFirstBlock = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+firstBlockID).catch(()=>({}))

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
                                status:'UPGRADE'|'OK',

                                -------------------------------[In case 'OK']-------------------------------

                                sig: SIG('EPOCH_DONE'+lastAuth+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId)
                        
                                -----------------------------[In case 'UPGRADE']----------------------------

                                currentLeader:<index>,
                                lastBlockProposition:{
                                    index,hash,afp:{prevBlockHash,blockID,blockHash,proofs}
                                }
                        }
                
                
                */

                if(typeof possibleAgreements === 'object'){

                    let agreements = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature                        

                    if(possibleAgreements){

                        if(possibleAgreements.status==='OK'){

                            // Verify EPOCH_FINALIZATION_PROOF signature and store to mapping

                            let dataThatShouldBeSigned = `EPOCH_DONE:${epochFinishProposition.currentLeader}:${epochFinishProposition.lastBlockProposition.index}:${epochFinishProposition.lastBlockProposition.hash}:${epochFinishProposition.afpForFirstBlock.blockHash}:${epochFullID}`

                            if(await verifyEd25519(dataThatShouldBeSigned,possibleAgreements.sig,descriptor.pubKey)) agreements.set(descriptor.pubKey,possibleAgreements.sig)


                        }else if(possibleAgreements.status==='UPGRADE'){

                            // Check the AFP and update the local data

                            let {index,hash,afp} = possibleAgreements.lastBlockProposition
                        
                            let pubKeyOfProposedLeader = leadersSequence[possibleAgreements.currentLeader]
                            
                            let afpToUpgradeIsOk = await verifyAggregatedFinalizationProof(afp,atEpochHandler)

                            let blockIDThatShouldBeInAfp = atEpochHandler.id+':'+pubKeyOfProposedLeader+':'+index
                        
                            if(afpToUpgradeIsOk && blockIDThatShouldBeInAfp === afp.blockID && hash === afp.blockHash){

                                let {prevBlockHash,blockID,blockHash,proofs} = afp
                        
                                // Update the info about current leader

                                currentEpochMetadata.CURRENT_LEADER_INFO = {index:possibleAgreements.currentLeader, pubKey:pubKeyOfProposedLeader}
                                
                                // Update FINALIZATION_STATS

                                currentEpochMetadata.FINALIZATION_STATS.set(pubKeyOfProposedLeader,{index,hash,afp:{prevBlockHash,blockID,blockHash,proofs}})
                        
                                // Clear the mapping with signatures because it becomes invalid

                                agreements.clear()

                            }

                        }

                    }

                }
                
            }).catch(()=>{});
            
            
        }
            


        let agreementsForEpochManager = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION')// signer => signature

        if(agreementsForEpochManager.size >= majority){
        
            let aggregatedEpochFinalizationProof = {

                lastLeader: epochFinishProposition.currentLeader,
                
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

    setTimeout(checkIfItsTimeToStartNewEpoch,3000) // each 3 seconds - do monitoring

}