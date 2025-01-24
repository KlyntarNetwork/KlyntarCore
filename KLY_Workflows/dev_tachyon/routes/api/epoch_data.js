import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../globals.js'

import {BLOCKCHAIN_GENESIS, CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'




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




// Returns the info about the current epoch on AT(Approvement Thread) and VT(Verification Thread)

FASTIFY_SERVER.get('/current_epoch/:threadID',(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.DATA_ABOUT_EPOCH_ON_THREAD){

        response
            
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.DATA_ABOUT_EPOCH_ON_THREAD}`)
            
        
        response.send(

            WORKING_THREADS[request.params.threadID === 'vt' ? 'VERIFICATION_THREAD': 'APPROVEMENT_THREAD'].EPOCH

        )

    }else response.send({err:'Route is off'})

})




// Returns the info about the current leader (leader = pool with the right to generate blocks in current timeframe of epoch)

FASTIFY_SERVER.get('/current_leader',(_request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.GET_CURRENT_SHARD_LEADERS){

        response
            
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.GET_CURRENT_SHARD_LEADERS}`)
            
        
        // Get the current epoch metadata

        let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
        
        let epochFullID = atEpochHandler.hash+"#"+atEpochHandler.id

        let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

        let dataToReturn = { [BLOCKCHAIN_GENESIS.SHARD]: currentEpochMetadata.CURRENT_LEADER_INFO.pubKey }

        response.send(dataToReturn)

    }else response.send({err:'Route is off'})

})




// Returns the info about specific epoch by it's numerical index.

FASTIFY_SERVER.get('/epoch_by_index/:index',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.GET_EPOCH_BY_INDEX){

        response
            
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.GET_EPOCH_BY_INDEX}`)
            
        
        // Get epoch handler from DB

        let epochHandler

        if(request.params.index == WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id){

            epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

        } else epochHandler = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HANDLER:${request.params.index}`).catch(()=>null)

        response.send(epochHandler)


    }else response.send({err:'Route is off'})

})




// Returns stats - total number of blocks, total number of txs and number of succesful txs

FASTIFY_SERVER.get('/verification_thread_stats_per_epoch/:index',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.VT_STATS_PER_EPOCH){

        response
        
            .header('Access-Control-Allow-Origin','*')    
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.VT_STATS_PER_EPOCH}`)


        if(request.params.index == WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id){

            response.send(WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH)

        }else{

            // Get these stats from DB related to epoch data

            let emptyTemplate = {

                totalBlocksNumber:-1,
                
                totalTxsNumber:-1,
    
                successfulTxsNumber:-1,
    
                newUserAccountsNumber:{
                    native:-1,
                    evm:-1
                },
    
                newSmartContractsNumber:{
                    native:-1,
                    evm:-1
                },
    
                rwxContracts:{
                    total:-1,
                    closed:-1
                },
    
                totalKlyStaked:-1,
                totalUnoStaked:-1
    
            }


            let vtStatsPerEpoch = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`VT_STATS_PER_EPOCH:${request.params.index}`).catch(()=>emptyTemplate)

            response.send(vtStatsPerEpoch)

        }


    }else response.send({err:'Route is off'})

})




FASTIFY_SERVER.get('/historical_stats_per_epoch/:start_index/:limit',async(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.VT_STATS_PER_EPOCH){

        response

            .header('Access-Control-Allow-Origin','*')    
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.VT_STATS_PER_EPOCH}`)


        let startFromEpoch

        if(request.params.start_index === 'latest') startFromEpoch = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id

        else startFromEpoch = +(request.params.start_index)


        let limit = +(request.params.limit) // 20 recommended

        let responseObject = {}

        let emptyTemplate = {

            totalBlocksNumber:-1,
            
            totalTxsNumber:-1,

            successfulTxsNumber:-1,

            newUserAccountsNumber:{
                native:-1,
                evm:-1
            },

            newSmartContractsNumber:{
                native:-1,
                evm:-1
            },

            rwxContracts:{
                total:-1,
                closed:-1
            },

            totalKlyStaked:-1,
            totalUnoStaked:-1

        }

        for(let i = 0 ; i < limit ; i++){

            responseObject[startFromEpoch] = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`VT_STATS_PER_EPOCH:${startFromEpoch}`).catch(()=>emptyTemplate)

            if(startFromEpoch === WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id){

                responseObject[startFromEpoch] = WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH

            }

            if(startFromEpoch === 0) break

            startFromEpoch--

        }

        response.send(responseObject)

    }else response.send({err:'Route is off'})

})