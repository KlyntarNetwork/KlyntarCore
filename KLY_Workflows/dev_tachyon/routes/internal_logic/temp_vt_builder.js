import {getVerifiedAggregatedFinalizationProofByBlockId} from '../../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../globals.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'



/*

[Info]:

    Accept indexes of leaders by requester version and return required data to define finalization pair for previous leaders (height+hash)

[Accept]:

    {
        
        proposedIndex: <index of current leader by requester version>

    }

[Returns]:

    {
        
        proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader

    }

*/

// Function to return info about current leaders and afpsForSecondBlock to help nodes to know the last blocks by previous leaders and let VT continue to work✅

FASTIFY_SERVER.post('/data_to_build_temp_data_for_verification_thread',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){
        
        response.send({err:'Epoch handler on AT is not ready'})

        return
    }


    let proposedIndexOfLeader = JSON.parse(request.body) // format {proposedIndex:index}


    if(typeof proposedIndexOfLeader === 'object'){

        let objectToReturn = {}

        let currentLeaderInfo = currentEpochMetadata.CURRENT_LEADER_INFO

        if(currentLeaderInfo && epochHandler.leadersSequence){

            // Get the index of current leader, first block by it and AFP to prove that this first block was accepted in this epoch

            let currentLeaderPubKeyByMyVersion = epochHandler.leadersSequence[currentLeaderInfo.index]

            let firstBlockID = `${epochHandler.id}:${currentLeaderPubKeyByMyVersion}:0`

            let firstBlockByCurrentLeader = await BLOCKCHAIN_DATABASES.BLOCKS.get(firstBlockID).catch(()=>null)


            if(firstBlockByCurrentLeader){

                let secondBlockID = `${epochHandler.id}:${currentLeaderPubKeyByMyVersion}:1`

                let afpForSecondBlockByCurrentLeader = await getVerifiedAggregatedFinalizationProofByBlockId(secondBlockID,epochHandler).catch(()=>null)

                if(afpForSecondBlockByCurrentLeader){

                    objectToReturn = {
                            
                        proposedIndexOfLeader:currentLeaderInfo.index,
                            
                        firstBlockByCurrentLeader,
                            
                        afpForSecondBlockByCurrentLeader
                        
                    }

                }

            }

        }

        response.send(objectToReturn)

    } else response.send({err:'Wrong format'})

})