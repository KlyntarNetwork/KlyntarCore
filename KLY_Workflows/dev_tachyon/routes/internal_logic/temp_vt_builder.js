import {getVerifiedAggregatedFinalizationProofByBlockId} from '../../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../globals.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'



/*

[Info]:

    Accept indexes of leaders on shards by requester version and return required data to define finalization pair for previous leaders (height+hash)

[Accept]:

    {
        shardID:<index of current leader on shard by requester version>
        ...
    }

[Returns]:

   {

        shard_0:{proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader},

        shard_1:{proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader},

        ...

        shard_N:{proposedLeaderIndex,firstBlockByCurrentLeader,afpForSecondBlockByCurrentLeader}

    }

*/

// Function to return info about current leaders on shards and afpsForSecondBlock to help nodes to know the last blocks by previous leaders and let VT continue to work✅

FASTIFY_SERVER.post('/data_to_build_temp_data_for_verification_thread',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){
        
        response.send({err:'Epoch handler on AT is not ready'})

        return
    }


    let proposedIndexesOfLeadersPerShard = JSON.parse(request.body) // format {shardID:index}


    if(typeof proposedIndexesOfLeadersPerShard === 'object'){

        let objectToReturn = {}

        for(let shardID of Object.keys(proposedIndexesOfLeadersPerShard)){

            // Try to get the current leader on shard

            let leaderHandlerForShard = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(shardID)

            if(leaderHandlerForShard && epochHandler.leadersSequence[shardID]){

                // Get the index of current leader, first block by it and AFP to prove that this first block was accepted in this epoch

                let currentLeaderPubKeyByMyVersion = epochHandler.leadersSequence[shardID][leaderHandlerForShard.currentLeader]

                let firstBlockID = `${epochHandler.id}:${currentLeaderPubKeyByMyVersion}:0`

                let firstBlockByCurrentLeader = await BLOCKCHAIN_DATABASES.BLOCKS.get(firstBlockID).catch(()=>null)


                if(firstBlockByCurrentLeader){

                    let secondBlockID = `${epochHandler.id}:${currentLeaderPubKeyByMyVersion}:1`

                    let afpForSecondBlockByCurrentLeader = await getVerifiedAggregatedFinalizationProofByBlockId(secondBlockID,epochHandler).catch(()=>null)

                    if(afpForSecondBlockByCurrentLeader){

                        objectToReturn[shardID] = {
                            
                            proposedIndexOfLeader:leaderHandlerForShard.currentLeader,
                            
                            firstBlockByCurrentLeader,
                            
                            afpForSecondBlockByCurrentLeader
                        
                        }

                    }

                }

            }

        }

        response.send(objectToReturn)

    } else response.send({err:'Wrong format'})

})