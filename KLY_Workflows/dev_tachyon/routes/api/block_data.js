import {BLOCKCHAIN_GENESIS, CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'

import {BLOCKCHAIN_DATABASES, WORKING_THREADS} from '../../globals.js'

import Block from '../../structures/block.js'




// Returns block
// 0 - blockID(in format <EpochID>:<ValidatorPubkey>:<Index of block in epoch>)

FASTIFY_SERVER.get('/block/:id',(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.BLOCK){

        response
        
            .header('Access-Control-Allow-Origin','*')    
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.BLOCK}`)
    

        BLOCKCHAIN_DATABASES.BLOCKS.get(request.params.id).then(block=>

            response.send(block)
            
        ).catch(()=>response.send({err:'No block'}))


    }else response.send({err:'Route is off'})

})



// Returns batch of blocks with proof that it's valid chain
// 0 - blockID(in format <EpochID>:<ValidatorPubkey>:<Index of block in epoch>)

FASTIFY_SERVER.get('/multiple_blocks/:epoch_index/:pool_id/:from_index',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.BLOCK){

        response
        
            .header('Access-Control-Allow-Origin','*')    
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.BLOCK}`)
    

        // We need to send range of blocks from <from_index+1> to <from_index+100>
        // Also, send the AFP for latest block - so the response structure is {blocks:[],afpForLatest}

        let responseStructure = {

            blocks:[],

            afpForLatest:{}

        }

    
        for(let i=0 ; i<100 ; i++){

            let blockIdToFind = request.params.epoch_index+':'+request.params.pool_id+':'+(request.params.from_index+i)

            let block = await BLOCKCHAIN_DATABASES.BLOCKS.get(blockIdToFind).catch(()=>null)

            if(block){

                responseStructure.blocks.push(block)

            } else break

        }

        let latestBlock = responseStructure.blocks[responseStructure.blocks.length-1]

        let blockIdToFindAfp = request.params.epoch_index+':'+request.params.pool_id+':'+(latestBlock.index+1)

        let afpForLatest = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+blockIdToFindAfp).catch(()=>null)

        responseStructure.afpForLatest = afpForLatest

        response.send(responseStructure)
        

    } else response.send({err:'Route is off'})

})





// 0 - index

FASTIFY_SERVER.get('/block_by_sid/:sid',(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.BLOCK_BY_SID){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.BLOCK_BY_SID}`)
            
        
        let absoluteHeight = request.params.sid

        BLOCKCHAIN_DATABASES.STATE.get(`SID:${absoluteHeight}`).then(blockID =>

            BLOCKCHAIN_DATABASES.BLOCKS.get(blockID).then(
                
                block => response.send(block)
            
            )

        ).catch(()=>response.send({err:'No block receipt'}))


    }else response.send({err:'Route is off'})

})



/*

0 - start from (indexation by SID)
1 - limit (20 by default)

Returns array of blocks sorted by SID in reverse order

*/

FASTIFY_SERVER.get('/latest_n_blocks/:start_index/:limit',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.LATEST_N_BLOCKS){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.LATEST_N_BLOCKS}`)

        let limit = +request.params.limit

        let promises = []

        // In case <start_index> is equal to "x" - this is a signal that requestor doesn't know the latest block height, so we set it manually based on this node data

        if(request.params.start_index === "x"){

            request.params.start_index = WORKING_THREADS.VERIFICATION_THREAD.SID_TRACKER - 1 // -1 because value in tracker point to the next block

        }


        for(let i=0 ; i < limit ; i++){

            let index = request.params.start_index - i

            let sid = index

            let blockPromise = BLOCKCHAIN_DATABASES.STATE.get('SID:'+sid).then(
            
                blockID => BLOCKCHAIN_DATABASES.BLOCKS.get(blockID).then(block=>{

                    block.hash = Block.genHash(block)

                    block.sid = BLOCKCHAIN_GENESIS.SHARD+':'+sid

                    return block

                })
                
            ).catch(()=>false)
    
            promises.push(blockPromise)

        }


        let blocksArray = await Promise.all(promises).then(array=>array.filter(Boolean))

        response.send(blocksArray)


    }else response.send({err:'Route is off'})

})




// Returns stats - total number of blocks, total number of txs and number of succesful txs

FASTIFY_SERVER.get('/verification_thread_stats',(_,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.VT_TOTAL_STATS){

        response
        
            .header('Access-Control-Allow-Origin','*')    
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.VT_TOTAL_STATS}`)
    
        response.send(WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS)

    }else response.send({err:'Route is off'})

})


/*

To return AGGREGATED_FINALIZATION_PROOF related to some block PubX:Index

Only in case when we have AGGREGATED_FINALIZATION_PROOF we can verify block with the 100% garantee that it's the part of valid version of chain and will be included to epoch

Params:

    blockID - blockID in format EpochID:BlockCreatorEd25519PubKey:IndexOfBlockInEpoch. Example 733:9H9iFRYHgN7SbZqPfuAkE6J6brPd4B5KzW5C6UzdGwxz:99

Returns:

    {
        prevBlockHash,
        blockID,
        blockHash,
        proofs:{

            signerPubKey:ed25519Signature,
            ...

        }
        
    }

*/

// Just GET route to return the AFP for block by it's id (reminder - BlockID structure is <epochID>:<blockCreatorPubKey>:<index of block in this epoch>) ✅
FASTIFY_SERVER.get('/aggregated_finalization_proof/:blockID',async(request,response)=>{

    response.header('Access-Control-Allow-Origin','*')

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.MAIN.GET_AGGREGATED_FINALIZATION_PROOFS){

        let aggregatedFinalizationProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+request.params.blockID).catch(()=>null)

        if(aggregatedFinalizationProof){

            response.send(aggregatedFinalizationProof)

        } else {

            // If we don't have an aggregated finalization proof - check if block was executed in verification thread
            // In case we have a receipt for blockID - that's signal that block was included to state
            // So, we can return a manually built AFP

            let possibleReceipt = await BLOCKCHAIN_DATABASES.STATE.get('BLOCK_RECEIPT:'+request.params.blockID).catch(()=>null)

            if(possibleReceipt){

                let afpToReturn = {

                    prevBlockHash: "",
                    blockID: request.params.blockID,
                    blockHash: "",
                    proofs: {
                        approvedAndIncludedToState:true
                    }
                }

                response.send(afpToReturn)

            } else response.send({err:'No proof'})

        }

    }else response.send({err:'Route is off'})
    
})