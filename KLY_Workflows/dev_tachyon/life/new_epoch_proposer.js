import {verifyAggregatedEpochFinalizationProof, verifyAggregatedFinalizationProof} from '../common_functions/work_with_proofs.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {useTemporaryDb} from '../common_functions/approvement_thread_related.js'

import {verifyEd25519} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

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

        let pubKeyOfLeader = CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER

        let indexOfLeader = 0


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

        // Structure is Map(quorumMember=>SIG('EPOCH_DONE'+lastLeaderInRcIndex+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId))
        
        let agreements = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION')

        if(!agreements){

            agreements = new Map()

            currentEpochMetadata.TEMP_CACHE.set('EPOCH_PROPOSITION',agreements)
        
        }

        let aefpExistsLocally = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${atEpochHandler.id}`).catch(()=>null)

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
                        
                            let pubKeyOfProposedLeader = CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER
                            
                            let afpToUpgradeIsOk = await verifyAggregatedFinalizationProof(afp,atEpochHandler)

                            let blockIDThatShouldBeInAfp = atEpochHandler.id+':'+pubKeyOfProposedLeader+':'+index
                        
                            if(afpToUpgradeIsOk && blockIDThatShouldBeInAfp === afp.blockID && hash === afp.blockHash){

                                let {prevBlockHash,blockID,blockHash,proofs} = afp
                        
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
            


        let agreementsForEpochManager = currentEpochMetadata.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature

        if(agreementsForEpochManager.size >= majority && epochFinishProposition && epochFinishProposition.lastBlockProposition){
        
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