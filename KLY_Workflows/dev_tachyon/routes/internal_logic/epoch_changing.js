import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../globals.js'

import {verifyAggregatedFinalizationProof} from '../../common_functions/work_with_proofs.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'

import {signEd25519} from '../../../../KLY_Utils/utils.js'





/*

[Info]:

    Accept epoch index and shard to return own assumption about the first block

[Returns]:

    {indexOfFirstBlockCreator, afpForSecondBlock}

*/

// Function to return assumption about the first block in epoch on specific shard

FASTIFY_SERVER.get('/first_block_assumption/:epoch_index/:shard',async(request,response)=>{

    let firstBlockAssumption = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`FIRST_BLOCK_ASSUMPTION:${request.params.epoch_index}:${request.params.shard}`).catch(()=>null)
        
    if(firstBlockAssumption){

        response.send(firstBlockAssumption)

    }else response.send({err:'No assumptions found'})

})





// Handler to acccept propositions to finish the epoch for shards and return agreement to build AEFP - Aggregated Epoch Finalization Proof ✅

FASTIFY_SERVER.post('/epoch_proposition',async(request,response)=>{

    // CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE - set the limit mb

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata){

        response.send({err:'Epoch handler on AT is not fresh'})

        return
    }

    if(!currentEpochMetadata.SYNCHRONIZER.has('READY_FOR_NEW_EPOCH')){

        response.send({err:'Not ready'})

        return

    }
    
    /* 
    
        Parse the proposition

        !Reminder:  The structure of proposition is:

        {
                
            "shard0":{

                currentLeader:<int - pointer to current leader of shard based on AT.EPOCH.leadersSequence[shardID]>
                
                afpForFirstBlock:{

                    prevBlockHash,
                    blockID,
                    blockHash,

                    proofs:{
                     
                        pubKey0:signa0,         => prevBlockHash+blockID+hash+AT.EPOCH.hash+"#"+AT.EPOCH.id
                        ...
                        
                    }

                },

                lastBlockProposition:{
                    
                    index:,
                    hash:,

                    afp:{

                        prevBlockHash,
                        blockID,
                        blockHash,

                        proofs:{
                     
                            pubKey0:signa0,         => prevBlockHash+blockID+hash+AT.EPOCH.hash+"#"+AT.EPOCH.id
                            ...
                        
                        }                        

                    }
                    
                }

            },

            "shard1":{
                ...            
            }

            ...
                    
            "shardN":{
                ...
            }
                
        }


        1) We need to iterate over propositions(per shard)
        2) Compare <currentLeader> with our local version of current leader on shard(take it from currentEpochMetadata.SHARDS_LEADERS_HANDLERS)
        
            [If proposed.currentLeader >= local.currentLeader]:

                1) Verify index & hash & afp in <lastBlockProposition>
                
                2) If proposed height >= local version - generate and return signature ED25519_SIG('EPOCH_DONE'+shard+lastAuth+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId)

                3) Else - send status:'UPGRADE' with local version of finalization proof, index and hash(take it from currentEpochMetadata.FINALIZATION_STATS)

            [Else if proposed.currentLeader < local.currentLeader AND currentEpochMetadata.FINALIZATION_STATS.has(local.currentLeader)]:

                1) Send status:'UPGRADE' with local version of currentLeader, metadata for epoch(from currentEpochMetadata.FINALIZATION_STATS), index and hash



        !Reminder: Response structure is

        {
            
            shardA:{
                                
                status:'UPGRADE'|'OK',

                -------------------------------[In case status === 'OK']-------------------------------

                signa: SIG('EPOCH_DONE'+shard+lastAuth+lastIndex+lastHash+hashOfFirstBlockByLastLeader+epochFullId)
                        
                ----------------------------[In case status === 'UPGRADE']-----------------------------

                currentLeader:<index>,
                
                lastBlockProposition:{
                
                    index,
                    hash,
                    afp
                
                }   

            },

            shardB:{
                ...(same)
            },
            ...,
            shardQ:{
                ...(same)
            }
    
        }


    */
   

    let possiblePropositionForNewEpoch = JSON.parse(request.body)

    let responseStructure = {}
    

    if(typeof possiblePropositionForNewEpoch === 'object'){


        for(let [shardID,proposition] of Object.entries(possiblePropositionForNewEpoch)){

            if(responseStructure[shardID]) continue

            if(typeof shardID === 'string' && typeof proposition.currentLeader === 'number' && typeof proposition.afpForFirstBlock === 'object' && typeof proposition.lastBlockProposition === 'object' && typeof proposition.lastBlockProposition.afp === 'object'){

                // Get the local version of SHARDS_LEADERS_HANDLERS and FINALIZATION_STATS

                let leadersHandlerForThisShard = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(shardID) // {currentLeader:<uint>}

                let localIndexOfLeader = leadersHandlerForThisShard.currentLeader

                let pubKeyOfCurrentLeaderOnShard = atEpochHandler.leadersSequence[shardID][localIndexOfLeader]

                // Structure is {index,hash,afp}

                let epochManagerForLeader = currentEpochMetadata.FINALIZATION_STATS.get(pubKeyOfCurrentLeaderOnShard) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}


                // Try to define the first block hash. For this, use the proposition.afpForFirstBlock
                        
                let hashOfFirstBlockByLastLeaderInThisEpoch

                let blockIdOfFirstBlock = atEpochHandler.id+':'+pubKeyOfCurrentLeaderOnShard+':0' // first block has index 0 - numeration from 0

                if(blockIdOfFirstBlock === proposition.afpForFirstBlock.blockID && proposition.lastBlockProposition.index>=0){

                    // Verify the AFP for first block

                    let afpIsOk = await verifyAggregatedFinalizationProof(proposition.afpForFirstBlock,atEpochHandler)

                    if(afpIsOk) hashOfFirstBlockByLastLeaderInThisEpoch = proposition.afpForFirstBlock.blockHash


                }


                if(!hashOfFirstBlockByLastLeaderInThisEpoch) continue


                //_________________________________________ Now compare _________________________________________

                if(proposition.currentLeader === localIndexOfLeader){

                    if(epochManagerForLeader.index === proposition.lastBlockProposition.index && epochManagerForLeader.hash === proposition.lastBlockProposition.hash){
                        
                        // Send AEFP signature

                        let {index,hash} = proposition.lastBlockProposition

                        let dataToSign = `EPOCH_DONE:${shardID}:${proposition.currentLeader}:${index}:${hash}:${hashOfFirstBlockByLastLeaderInThisEpoch}:${epochFullID}`


                        responseStructure[shardID] = {
                                                
                            status:'OK',
                                            
                            sig:await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                                            
                        }

                            
                    }else if(epochManagerForLeader.index < proposition.lastBlockProposition.index){

                        // Verify AGGREGATED_FINALIZATION_PROOF & upgrade local version & send AEFP signature

                        let {index,hash,afp} = proposition.lastBlockProposition

                        let isOk = await verifyAggregatedFinalizationProof(afp,atEpochHandler)


                        if(isOk){

                            // Check that this AFP is for appropriate pool

                            let [epochIndex,pubKeyOfCreator] = afp.blockID.split(':')

                            let blockIdThatShouldBeInAfp = `${epochIndex}:${pubKeyOfCreator}:${index}`

                            if(pubKeyOfCreator === pubKeyOfCurrentLeaderOnShard && hash === afp.blockHash && blockIdThatShouldBeInAfp === afp.blockID){

                            
                                if(leadersHandlerForThisShard) leadersHandlerForThisShard.currentLeader = proposition.currentLeader

                                else currentEpochMetadata.SHARDS_LEADERS_HANDLERS.set(shardID,{currentLeader:proposition.currentLeader})
    

                                if(epochManagerForLeader){

                                    epochManagerForLeader.index = index
    
                                    epochManagerForLeader.hash = hash
    
                                    epochManagerForLeader.afp = afp
    
                                } else currentEpochMetadata.FINALIZATION_STATS.set(pubKeyOfCurrentLeaderOnShard,{index,hash,afp})

                            
                                // Generate EPOCH_FINALIZATION_PROOF_SIGNATURE

                                let dataToSign = `EPOCH_DONE:${shardID}:${proposition.currentLeader}:${index}:${hash}:${hashOfFirstBlockByLastLeaderInThisEpoch}:${epochFullID}`

                                responseStructure[shardID] = {
                            
                                    status:'OK',
                        
                                    sig:await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                        
                                }

                            }

                        }


                    }else if(epochManagerForLeader.index > proposition.lastBlockProposition.index){

                        // Send 'UPGRADE' msg

                        responseStructure[shardID] = {

                            status:'UPGRADE',
                            
                            currentLeader:localIndexOfLeader,
                
                            lastBlockProposition:epochManagerForLeader // {index,hash,afp}
                    
                        }

                    }

                }else if(proposition.currentLeader < localIndexOfLeader){

                    // Send 'UPGRADE' msg

                    responseStructure[shardID] = {

                        status:'UPGRADE',
                            
                        currentLeader:localIndexOfLeader,
                
                        lastBlockProposition:epochManagerForLeader // {index,hash,afp}
                    
                    }

                }

            }

        }

        response.send(responseStructure)

    }else response.send({err:'Wrong format'})


})