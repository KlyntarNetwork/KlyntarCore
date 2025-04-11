import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {BLOCKCHAIN_DATABASES} from '../../globals.js'



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