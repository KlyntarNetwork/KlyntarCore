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

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochIndex = epochHandler.id

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata){

        response.send({err:'Epoch handler on AT is not fresh'})

        return
    }

    let epochFinishResponse = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('EPOCH_FINISH_RESPONSE:'+epochIndex).catch(()=>false)

    if(epochFinishResponse){

        let proposition = JSON.parse(request.body)

        let responseStructure = {}
        
    
        if(typeof proposition === 'object'){
    
            let typeCheckIsOk = typeof proposition.currentLeader === 'number' && typeof proposition.afpForFirstBlock === 'object' && typeof proposition.lastBlockProposition === 'object' && typeof proposition.lastBlockProposition.afp === 'object'
    
            if(typeCheckIsOk){
    
                // Get the local version about voting
    
                let localIndexOfLeader = currentEpochMetadata.CURRENT_LEADER_INFO.index
    
                let pubKeyOfCurrentLeader = currentEpochMetadata.CURRENT_LEADER_INFO.pubKey
    
                // Structure is {index,hash,afp}
    
                let votingDataForLeader = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':'+pubKeyOfCurrentLeader).catch(()=>({index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}))
    
    
                // Try to define the first block hash. For this, use the proposition.afpForFirstBlock
                        
                let hashOfFirstBlockByLastLeaderInThisEpoch
    
                let blockIdOfFirstBlock = epochHandler.id+':'+pubKeyOfCurrentLeader+':0' // first block has index 0 - numeration from 0
    
                if(blockIdOfFirstBlock === proposition.afpForFirstBlock.blockID && proposition.lastBlockProposition.index>=0){
    
                    // Verify the AFP for first block
    
                    let afpIsOk = await verifyAggregatedFinalizationProof(proposition.afpForFirstBlock,epochHandler)
    
                    if(afpIsOk) hashOfFirstBlockByLastLeaderInThisEpoch = proposition.afpForFirstBlock.blockHash
    
    
                }
    
    
                if(!hashOfFirstBlockByLastLeaderInThisEpoch){
    
                    response.send({err:`Can't verify hash`})
    
                    return
    
                }
    
    
                //_________________________________________ Now compare _________________________________________
    
                if(proposition.currentLeader === localIndexOfLeader){
    
                    if(votingDataForLeader.index === proposition.lastBlockProposition.index && votingDataForLeader.hash === proposition.lastBlockProposition.hash){
                        
                        // Send AEFP signature
    
                        let {index,hash} = proposition.lastBlockProposition
    
                        let dataToSign = `EPOCH_DONE:${proposition.currentLeader}:${index}:${hash}:${hashOfFirstBlockByLastLeaderInThisEpoch}:${epochFullID}`
    
    
                        responseStructure = {
                                                
                            status:'OK',
                                            
                            sig:await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                                            
                        }
    
                            
                    }else if(votingDataForLeader.index > proposition.lastBlockProposition.index){
    
                        // Send 'UPGRADE' msg
    
                        responseStructure = {
    
                            status:'UPGRADE',
                            
                            currentLeader:localIndexOfLeader,
                
                            lastBlockProposition:votingDataForLeader // {index,hash,afp}
                    
                        }
    
                    }
    
                }else if(proposition.currentLeader < localIndexOfLeader){
    
                    // Send 'UPGRADE' msg
    
                    responseStructure = {
    
                        status:'UPGRADE',
                            
                        currentLeader:localIndexOfLeader,
                
                        lastBlockProposition:votingDataForLeader // {index,hash,afp}
                    
                    }
    
                }
    
            }
    
            response.send(responseStructure)
    
        } else response.send({err:'Wrong format'})

    } else response.send({err:'Too early'})

})