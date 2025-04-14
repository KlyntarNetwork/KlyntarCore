import {verifyAggregatedEpochFinalizationProof, verifyAggregatedFinalizationProof} from '../common_functions/work_with_proofs.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES, WORKING_THREADS} from '../globals.js'

import {verifyEd25519} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

import {epochStillFresh} from '../utils.js'




export let startNewEpochProposerThread=async()=>{

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochIndex = atEpochHandler.id

    let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

    let indexOfLeader = GLOBAL_CACHES.TEMP_CACHE.get(epochIndex+':CURRENT_LEADER') || atEpochHandler.currentLeaderIndex

    let pubKeyOfLeader = atEpochHandler.leadersSequence[indexOfLeader]

    let leadersSequence = atEpochHandler.leadersSequence // [pool0,pool1,...,poolN]

    
    GLOBAL_CACHES.TEMP_CACHE.set(epochIndex+':CURRENT_LEADER',indexOfLeader)


    let iAmInTheQuorum = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum.includes(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)

    let timeForNewEpoch = !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)

    // First of all - prevent generation of new finalization proofs

    let epochFinishResponse = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('EPOCH_FINISH_RESPONSE:'+epochIndex).catch(()=>false)

    if(timeForNewEpoch && !epochFinishResponse){

        // Send the signal

        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('EPOCH_FINISH_REQUEST:'+epochIndex,true).catch(()=>false)

        setTimeout(startNewEpochProposerThread,3000)

        return

    }

    if(iAmInTheQuorum && timeForNewEpoch && epochFinishResponse){

        let epochFinishProposition = {}

        let majority = getQuorumMajority(atEpochHandler)


        /*
            
            Now to avoid loops, check if last leader created at least 1 block
            
        */

        let localVotingDataForLeader = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':'+pubKeyOfLeader).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))

        if(localVotingDataForLeader.index === -1){

            // Change to previous leader that finish its work on height > -1

            for(let position = indexOfLeader-1 ; position >= 0 ; position --){

                let previousLeader = atEpochHandler.leadersSequence[position]

                let localVotingData = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':'+previousLeader).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))

                if(localVotingData.index > -1){

                    pubKeyOfLeader = previousLeader

                    indexOfLeader = position

                    break

                }

            }

        }

        // Structure is Map(quorumMember=>SIG('EPOCH_DONE'+lastLeaderInRcIndex+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId))
        
        let agreements = GLOBAL_CACHES.TEMP_CACHE.get('EPOCH_PROPOSITION')

        if(!agreements){

            agreements = new Map()

            GLOBAL_CACHES.TEMP_CACHE.set('EPOCH_PROPOSITION',agreements)
        
        }



        let aefpExistsLocally = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${epochIndex}`).catch(()=>false)

        if(!aefpExistsLocally){

            epochFinishProposition = {

                currentLeader:indexOfLeader,

                afpForFirstBlock:{},

                lastBlockProposition: await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':'+pubKeyOfLeader).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))

            }

            // In case we vote for index > 0 - we need to add the AFP proof to proposition as a proof that first block by this leader has such hash
            // This will be added to AEFP and used on verification thread

            if(epochFinishProposition.lastBlockProposition.index >= 0){

                let firstBlockID = epochIndex+':'+pubKeyOfLeader+':0'

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

                    let agreements = GLOBAL_CACHES.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature                        

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

                            let blockIDThatShouldBeInAfp = epochIndex+':'+pubKeyOfProposedLeader+':'+index
                        
                            if(afpToUpgradeIsOk && blockIDThatShouldBeInAfp === afp.blockID && hash === afp.blockHash){

                                let {prevBlockHash,blockID,blockHash,proofs} = afp
                        
                                // Update the info about current leader

                                GLOBAL_CACHES.TEMP_CACHE.set(epochIndex+':CURRENT_LEADER',possibleAgreements.currentLeader)

                                await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put(epochIndex+':'+pubKeyOfProposedLeader,{index,hash,afp:{prevBlockHash,blockID,blockHash,proofs}}).catch(()=>{})
                        
                                // Clear the mapping with signatures because it becomes invalid

                                agreements.clear()

                            }

                        }

                    }

                }
                
            }).catch(()=>{});
            
            
        }
            


        let agreementsForEpochManager = GLOBAL_CACHES.TEMP_CACHE.get('EPOCH_PROPOSITION') // signer => signature

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

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`AEFP:${epochIndex}`,aggregatedEpochFinalizationProof).catch(()=>{})

            } else {

                agreementsForEpochManager.clear()

            }

        }

    }

    setTimeout(startNewEpochProposerThread,3000) // each 3 seconds - do monitoring

}