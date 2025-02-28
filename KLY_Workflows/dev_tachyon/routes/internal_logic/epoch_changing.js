import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../globals.js'

import {verifyAggregatedFinalizationProof} from '../../common_functions/work_with_proofs.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {signEd25519} from '../../../../KLY_Utils/utils.js'





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

    let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata){

        response.send({err:'Epoch handler on AT is not fresh'})

        return
    }

    let proposition = JSON.parse(request.body)

    let responseStructure = {}
    

    if(typeof proposition === 'object'){

        if(typeof proposition.afpForFirstBlock === 'object' && typeof proposition.lastBlockProposition === 'object' && typeof proposition.lastBlockProposition.afp === 'object'){

            let pubKeyOfCurrentLeader = CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER

            // Structure is {index,hash,afp}

            let epochManagerForLeader = currentEpochMetadata.FINALIZATION_STATS.get(pubKeyOfCurrentLeader) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}


            // Try to define the first block hash. For this, use the proposition.afpForFirstBlock
                    
            let hashOfFirstBlockByLastLeaderInThisEpoch

            let blockIdOfFirstBlock = atEpochHandler.id+':'+pubKeyOfCurrentLeader+':0' // first block has index 0 - numeration from 0

            if(blockIdOfFirstBlock === proposition.afpForFirstBlock.blockID && proposition.lastBlockProposition.index>=0){

                // Verify the AFP for first block

                let afpIsOk = await verifyAggregatedFinalizationProof(proposition.afpForFirstBlock,atEpochHandler)

                if(afpIsOk) hashOfFirstBlockByLastLeaderInThisEpoch = proposition.afpForFirstBlock.blockHash


            }


            if(!hashOfFirstBlockByLastLeaderInThisEpoch){

                response.send({err:`Can't verify hash`})

                return

            }


            if(epochManagerForLeader.index === proposition.lastBlockProposition.index && epochManagerForLeader.hash === proposition.lastBlockProposition.hash){
                    
                // Send AEFP signature

                let {index,hash} = proposition.lastBlockProposition

                let dataToSign = `EPOCH_DONE:0:${index}:${hash}:${hashOfFirstBlockByLastLeaderInThisEpoch}:${epochFullID}`


                responseStructure = {
                                        
                    status:'OK',
                                    
                    sig:await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                                    
                }

                    
            }else if(epochManagerForLeader.index > proposition.lastBlockProposition.index){

                // Send 'UPGRADE' msg

                responseStructure = {

                    status:'UPGRADE',
        
                    lastBlockProposition:epochManagerForLeader // {index,hash,afp}
            
                }

            }

        }

        response.send(responseStructure)

    } else response.send({err:'Wrong format'})

})