import {checkAlrpChainValidity, verifyAggregatedFinalizationProof} from '../common_functions/work_with_proofs.js'

import {getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {getBlock} from '../verification_process/verification.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

import {getRandomFromArray} from '../utils.js'

import {WORKING_THREADS} from '../globals.js'

import Block from '../structures/block.js'





export let findTemporaryInfoAboutFinalBlocksByPreviousPools=async()=>{

    /*
    
        [+] In this function we should time by time ask for ALRPs for pools to understand of how to continue VERIFICAION_THREAD

        [+] Use VT.TEMP_INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS


        Based on current epoch in APPROVEMENT_THREAD - build the temporary info about index/hashes of pools to keep work on verification thread
    
    */


    let verificationThread = WORKING_THREADS.VERIFICATION_THREAD

    let tempInfoAboutLastBlocksByPreviousPools = verificationThread.TEMP_INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS

    let vtEpochHandler = verificationThread.EPOCH

    let vtEpochFullID = vtEpochHandler.hash+'#'+vtEpochHandler.id

    let vtLeadersSequence = vtEpochHandler.leadersSequence


    if(!tempInfoAboutLastBlocksByPreviousPools[vtEpochFullID]){

        // Create empty template

        tempInfoAboutLastBlocksByPreviousPools[vtEpochFullID] = {

            currentLeader:0,
                
            currentToVerify:0,
            
            infoAboutFinalBlocksInThisEpoch:{} // poolPubKey => {index,hash}

        }

    }


    //________________________________ Start to find ________________________________

    // TODO: Choose only several random sources instead of the whole quorum

    let quorumMembers = await getQuorumUrlsAndPubkeys(true)

    let randomTarget = getRandomFromArray(quorumMembers)

    let localVersionOfCurrentLeader = {

        proposedIndex: tempInfoAboutLastBlocksByPreviousPools[vtEpochFullID].currentLeader

    }

    // Make request to /data_to_build_temp_data_for_verification_thread

    const controller = new AbortController()

    setTimeout(() => controller.abort(), 7000)

    let optionsToSend = {

        method: 'POST',

        body: JSON.stringify(localVersionOfCurrentLeader),

        signal: controller.signal

    }


    let metadata = await fetch(randomTarget.url+'/data_to_build_temp_data_for_verification_thread',optionsToSend).then(r=>r.json()).catch(()=>null)


    /*
        
        The response has the following structure:

        [0] - {err:'Some error text'} - ignore, do nothing

        [1] - Object with this structure

        {proposedIndexOfLeader,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader}


        -----------------------------------------------[Decomposition]-----------------------------------------------


        [0] proposedIndexOfLeader - index of current leader. To get the pubkey - take the APPROVEMENT_THREAD.EPOCH.leadersSequence[proposedIndex]

        [1] firstBlockByCurrentLeader - just block

        [2] afpForSecondBlockByCurrentLeader default AFP structure -> 


            {
                prevBlockHash:<string>              => it should be the hash of <firstBlockByCurrentLeader>
                blockID:<string>,
                blockHash:<string>,
                proofs:{

                    quorumMemberPubKey0:ed25519Signa,
                    ...                                             => Signa is prevBlockHash+blockID+hash+AT.EPOCH.HASH+"#"+AT.EPOCH.id
                    quorumMemberPubKeyN:ed25519Signa,

                }
                         
            }


            -----------------------------------------------[What to do next?]-----------------------------------------------
        
            Compare the <proposedAuthorityIndex> with our local pointer tempInfoAboutLastBlocksByPreviousPools[approvementThreadEpochFullID].currentLeader

            In case our local version has bigger index - ignore

            In case proposed version has bigger index - we need to update our local data

            For this:

                0) Verify that this block was approved by quorum majority(2/3N+1) by checking the <afpForSecondBlockByCurrentLeader>

                If all the verification steps is OK - add to some cache

                ---------------------------------[After the verification of all the responses?]---------------------------------

                Start restoring VT

    */

        if(metadata && typeof metadata==='object'){

            let {
                
                proposedIndexOfLeader,
                
                firstBlockByCurrentLeader: firstBlockByProposedLeader,
                
                afpForSecondBlockByCurrentLeader: secondBlockAFPByProposedLeader
            
            } = metadata            


            let bothNotNull = firstBlockByProposedLeader && secondBlockAFPByProposedLeader
    
            
            if(typeof proposedIndexOfLeader === 'number' && bothNotNull && typeof firstBlockByProposedLeader === 'object' && typeof secondBlockAFPByProposedLeader==='object'){
                  
                if(localVersionOfCurrentLeader.proposedIndex <= proposedIndexOfLeader && firstBlockByProposedLeader.index === 0){

                    // Verify the AFP for second block(with index 1 in epoch) to make sure that block 0(first block in epoch) was 100% accepted
    
                    let afpIsOk = await verifyAggregatedFinalizationProof(secondBlockAFPByProposedLeader,vtEpochHandler)
    
                    afpIsOk &&= secondBlockAFPByProposedLeader.prevBlockHash === Block.genHash(firstBlockByProposedLeader)

                    if(afpIsOk){

                        // Verify all the ALRPs in block header
    
                        let {isOK,infoAboutFinalBlocksInThisEpoch} = await checkAlrpChainValidity(
                                
                            firstBlockByProposedLeader, vtLeadersSequence, proposedIndexOfLeader, vtEpochFullID, vtEpochHandler, true
                            
                        )

                        let shouldChange = true

                        if(isOK){

                            let collectionOfAlrpsFromAllThePreviousLeaders = [infoAboutFinalBlocksInThisEpoch] // each element here is object like {pool:{index,hash,firstBlockHash}}

                            let currentAlrpSet = {...infoAboutFinalBlocksInThisEpoch}

                            let position = proposedIndexOfLeader-1


                            /*
                            
                            ________________ What to do next? ________________

                            Now we know that proposed leader has created some first block(firstBlockByCurrentLeader)

                            and we verified the AFP so it's clear proof that block is 100% accepted and the data inside is valid and will be a part of epoch data



                            Now, start the cycle in reverse order on range

                            [proposedIndexOfLeader-1 ; localVersionOfCurrentLeaders]
                            
                            

                            
                            */

                            if(position >= localVersionOfCurrentLeader.proposedIndex){

                                // eslint-disable-next-line no-constant-condition
                                while(true){

                                    for(; position >= localVersionOfCurrentLeader.proposedIndex ; position--){

                                        let poolOnThisPosition = vtLeadersSequence[position]
    
                                        let alrpForThisPoolFromCurrentSet = currentAlrpSet[poolOnThisPosition]
    
                                        if(alrpForThisPoolFromCurrentSet.index !== -1){
    
                                            // Ask the first block and extract next set of ALRPs
    
                                            let firstBlockInThisEpochByPool = await getBlock(vtEpochHandler.id,poolOnThisPosition,0)
    
                                            // Compare hashes to make sure it's really the first block by pool X in epoch Y
    
                                            if(firstBlockInThisEpochByPool && Block.genHash(firstBlockInThisEpochByPool) === alrpForThisPoolFromCurrentSet.firstBlockHash){
                            
                                                let alrpChainValidation = position === 0 ? {isOK:true,infoAboutFinalBlocksInThisEpoch:{}} : await checkAlrpChainValidity(
                                                    
                                                    firstBlockInThisEpochByPool, vtLeadersSequence, position, vtEpochFullID, vtEpochHandler, true
                                                    
                                                )
                            
                                                if(alrpChainValidation.isOK){
    
                                                    // If ok - fill the potential <infoAboutFinalBlocksInThisEpoch>
    
                                                    collectionOfAlrpsFromAllThePreviousLeaders.push(alrpChainValidation.infoAboutFinalBlocksInThisEpoch)
    
                                                    currentAlrpSet = alrpChainValidation.infoAboutFinalBlocksInThisEpoch

                                                    position--
    
                                                    break
    
                                                }else{
    
                                                    shouldChange = false
    
                                                    break
    
                                                }
    
                                            }else{
    
                                                shouldChange = false
    
                                                break
    
                                            }
    
                                        }
    
                                    }

                                    if(!shouldChange || position <= localVersionOfCurrentLeader.proposedIndex) break

                                }


                                // Now, <collectionOfAlrpsFromAllThePreviousLeaders> is array of objects like {pool:{index,hash,firstBlockHash}}
                                // We need to reverse it and fill the temp data for VT

                                if(shouldChange){

                                    // Update the data about last block index and hash

                                    let tempReassignmentChain = tempInfoAboutLastBlocksByPreviousPools[vtEpochFullID].infoAboutFinalBlocksInThisEpoch // poolPubKey => {index,hash}


                                    for(let reassignStats of collectionOfAlrpsFromAllThePreviousLeaders.reverse()){

                                        // collectionOfAlrpsFromAllThePreviousLeaders[i] = {pool0:{index,hash},poolN:{index,hash}}

                                        for(let [poolPubKey,descriptor] of Object.entries(reassignStats)){

                                            if(!tempReassignmentChain[poolPubKey]) tempReassignmentChain[poolPubKey] = descriptor
                
                                        }

                                    }

                                    // Finally, set the <currentLeader> to the new pointer

                                    tempInfoAboutLastBlocksByPreviousPools[vtEpochFullID].currentLeader = proposedIndexOfLeader


                                }

                            }

                        }

                    }

                }

            } 
        
        }
        
    setTimeout(findTemporaryInfoAboutFinalBlocksByPreviousPools,CONFIGURATION.NODE_LEVEL.TIMEOUT_TO_FIND_TEMP_INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS)
    
}