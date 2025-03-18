import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../globals.js'

import {verifyAggregatedFinalizationProof} from '../../common_functions/work_with_proofs.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {signEd25519, verifyEd25519} from '../../../../KLY_Utils/utils.js'





/*

[Info]:

    Accept epoch index to return own assumption about the first block

[Returns]:

    {indexOfFirstBlockCreator, afpForSecondBlock}

*/

// Function to return assumption about the first block in epoch

FASTIFY_SERVER.get('/first_block_assumption/:epoch_index',async(request,response)=>{

    let firstBlockAssumption = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`FIRST_BLOCK_ASSUMPTION:${request.params.epoch_index}`).catch(()=>null)
        
    if(firstBlockAssumption){

        response.send(firstBlockAssumption)

    }else response.send({err:'No assumptions found'})

})





// Handler to acccept propositions to finish the epoch and return agreement to build AEFP - Aggregated Epoch Finalization Proof ✅

FASTIFY_SERVER.post('/epoch_proposition',async(request,response)=>{

    // CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE - set the limit mb

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let atEpochHandlerIndex = atEpochHandler.id

    let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata){

        response.send({err:'Epoch handler on AT is not fresh'})

        return
    }

    let proposition = JSON.parse(request.body)

    let responseStructure = {}
    

    if(typeof proposition === 'object'){

        // Verify the signature

        let pubKeyOfCurrentLeader = CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER

        let payloadSignaIsOk = await verifyEd25519(JSON.stringify(proposition.payload),proposition.payloadSignature,pubKeyOfCurrentLeader)

        let typeCheckIsOk = typeof proposition.payload.afpForFirstBlock === 'object' && typeof proposition.payload.lastBlockProposition === 'object' && typeof proposition.payload.lastBlockProposition.afp === 'object'

        if(payloadSignaIsOk && typeCheckIsOk){

            // First of all - check if mutex is ok

            let votingMutex = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('READY_FOR_EPOCH_FINISH:'+atEpochHandlerIndex).catch(()=>false)

            let votingMutexTmb = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('READY_FOR_EPOCH_FINISH_TMB:'+atEpochHandlerIndex).catch(()=>false)

            if(!votingMutex || !votingMutexTmb){

                await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('READY_FOR_EPOCH_FINISH_REQUEST:'+atEpochHandlerIndex,true).catch(()=>{})

                response.send(responseStructure)

                return

            }

            // Structure is {index,hash,afp}

            let finalizationStatsForBlockGenerator = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(atEpochHandlerIndex+':'+pubKeyOfCurrentLeader).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))


            if(proposition.payload.lastBlockProposition.index >= finalizationStatsForBlockGenerator.index){

                let lastBlockAfpIsOk = await verifyAggregatedFinalizationProof(proposition.payload.lastBlockProposition.afp,atEpochHandler)

                if(lastBlockAfpIsOk){

                    // Try to define the first block hash. For this, use the proposition.payload.afpForFirstBlock
                    
                    let hashOfFirstBlockByLastLeaderInThisEpoch

                    let blockIdOfFirstBlock = atEpochHandler.id+':'+pubKeyOfCurrentLeader+':0' // first block has index 0 - numeration from 0

                    if(blockIdOfFirstBlock === proposition.payload.afpForFirstBlock.blockID && proposition.payload.lastBlockProposition.index>=0){

                        // Verify the AFP for first block

                        let afpIsOk = await verifyAggregatedFinalizationProof(proposition.payload.afpForFirstBlock,atEpochHandler)

                        if(afpIsOk) hashOfFirstBlockByLastLeaderInThisEpoch = proposition.payload.afpForFirstBlock.blockHash


                    }

                    if(hashOfFirstBlockByLastLeaderInThisEpoch){

                        // Send AEFP signature

                        let {index,hash} = proposition.payload.lastBlockProposition

                        let dataToSign = `EPOCH_DONE:0:${index}:${hash}:${hashOfFirstBlockByLastLeaderInThisEpoch}:${epochFullID}`
                
                        // TODO: Disable the ability to send finalization proofs for this epoch
                        // Request for AEFP means that sequencer wants to finish the epoch, so no sense to sign finalization proofs for blocks in this epoch
                        // It's also security prevention from malicious sequencer
                
                        responseStructure = {
                                                        
                            status:'OK',
                                                    
                            sig:await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                                                    
                        }

                    }

                }
                
            }

        }

        response.send(responseStructure)

    } else response.send({err:'Wrong format'})

})