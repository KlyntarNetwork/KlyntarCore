import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {BLOCKCHAIN_DATABASES} from '../../globals.js'




/*
            
    The structure of AGGREGATED_EPOCH_FINALIZATION_PROOF is

    {
        lastLeader:<index of Ed25519 pubkey of some pool in leaders sequence>,
        lastIndex:<index of his block in previous epoch>,
        lastHash:<hash of this block>,
        hashOfFirstBlockByLastLeader:<hash of the first block by this leader>,
        
        proofs:{

            quorumMemberPubKey0:Ed25519Signa0,
            ...
            quorumMemberPubKeyN:Ed25519SignaN

        }
    
    }

    Signature is => ED25519('EPOCH_DONE'+lastLeaderIndex+lastIndex+lastHash+firstBlockHash+epochFullId)


*/

// Simple GET handler to return AEFP for given and epoch ✅

FASTIFY_SERVER.get('/aggregated_epoch_finalization_proof/:epoch_index',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.MAIN.GET_AGGREGATED_EPOCH_FINALIZATION_PROOF){

        let aggregatedEpochFinalizationProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${request.params.epoch_index}`).catch(()=>null)
        
        if(aggregatedEpochFinalizationProof){

            response.send(aggregatedEpochFinalizationProof)

        }else response.send({err:'No AEFP'})

    }else response.send({err:'Route is off'})

})