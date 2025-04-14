import {BLOCKCHAIN_GENESIS, CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {getQuorumUrlsAndPubkeys} from '../../common_functions/quorum_related.js'

import {TXS_FILTERS} from '../../verification_process/txs_filters.js'

import {GLOBAL_CACHES, WORKING_THREADS} from '../../globals.js'

import {getCurrentLeaderURL} from '../../utils.js'





/**## Returns the info about your KLY infrastructure
 *
 * 
 * ### Info
 * 
 * This route returns the JSON object that you set manually in CONFIGURATION.NODE_LEVEL.MY_KLY_INFRASTRUCTURE
 * Here you can describe your infrastructure - redirects, supported services, plugins installed
 *  Set the CONFIGURATION.NODE_LEVEL.MY_KLY_INFRASTRUCTURE with extra data 
 * 
 * 
 * ### Params
 * 
 *  + 0 - Nothing
 * 
 * 
 * ### Returns
 * 
 *  + JSON'ed value in CONFIGURATION.NODE_LEVEL.MY_KLY_INFRASTRUCTURE
 * 
 *  
 * */

FASTIFY_SERVER.get('/infrastructure_info',(_request,response)=>{

    response
        
        .header('Access-Control-Allow-Origin','*')
        .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.MY_KLY_INFRASTRUCTURE)

        .send(CONFIGURATION.NODE_LEVEL.MY_KLY_INFRASTRUCTURE)


})




// Returns info about symbiotic chain

FASTIFY_SERVER.get('/chain_info',(_request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.CHAIN_INFO){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.CHAIN_INFO}`)
            


        let networkID = BLOCKCHAIN_GENESIS.NETWORK_ID

        // Get the info from symbiote manifest - its static info, as a genesis, but for deployment to hostchain

        let {
        
            NETWORK_WORKFLOW:workflowID,
            HIVEMIND:hivemind,
            HOSTCHAINS:hostchains,
            FIRST_EPOCH_START_TIMESTAMP:startOfFirstEpoch
        
        } = BLOCKCHAIN_GENESIS

        
        // Get the current version of VT and AT(need to understand the core version)

        let verificationThreadWorkflowVersion = WORKING_THREADS.VERIFICATION_THREAD.CORE_MAJOR_VERSION

        let approvementThreadWorkflowVersion = WORKING_THREADS.APPROVEMENT_THREAD.CORE_MAJOR_VERSION


        // Get the current version of workflows_options on VT and AT

        let networkOptionsOnVerificationThread = WORKING_THREADS.VERIFICATION_THREAD.NETWORK_PARAMETERS

        let networkOptionsOnApprovementThread = WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS


        response.send({

            genesis:{

                networkID,startOfFirstEpoch,workflowID,hivemind,hostchains
            
            },

            verificationThread:{

                version:verificationThreadWorkflowVersion,
                params:networkOptionsOnVerificationThread

            },

            approvementThread:{

                version:approvementThreadWorkflowVersion,
                params:networkOptionsOnApprovementThread
            
            }

        })
            

    }else response.send({err:'Route is off'})

})




// Returns metadata related to KLY-EVM
FASTIFY_SERVER.get('/kly_evm_metadata',(_request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.KLY_EVM_METADATA){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.KLY_EVM_METADATA}`)
    

        let responseObject = {

            klyEvmMetadata:WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_METADATA, // {nextEvmBlockIndex,parentHash,timestamp},

            epochMetadata:{

                id: WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id,
                hash: WORKING_THREADS.VERIFICATION_THREAD.EPOCH.hash,
                startTimestamp: WORKING_THREADS.VERIFICATION_THREAD.EPOCH.startTimestamp,

            }

        }

        response.send(responseObject)

    }else response.send({err:'Symbiote not supported'})

})



// Returns urls and pubkeys on current epoch - mostly need for epoch edge transactions / signatures requests
FASTIFY_SERVER.get('/quorum_urls_and_pubkeys',async(_request,response)=>{

    response
        
    .header('Access-Control-Allow-Origin','*')
    .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.QUORUM_URLS_AND_PUBKEYS}`)

    let currentEpoch = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let responseObject = {

        quorumUrlsAndPubkeys: await getQuorumUrlsAndPubkeys(true,currentEpoch),

        epochMetadata:{

            id: currentEpoch.id,
            hash: currentEpoch.hash,
            startTimestamp: currentEpoch.startTimestamp,

        }

    }

    response.send(responseObject)

})




// Returns data that shows your node synchronization status
FASTIFY_SERVER.get('/synchronization_stats',(_request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.SYNC_STATS){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.SYNC_STATS}`)
    

        let responseObject = {

            heightPerShard:{
                [BLOCKCHAIN_GENESIS.SHARD]: WORKING_THREADS.VERIFICATION_THREAD.LAST_HEIGHT,
            },

            epochMetadata:{

                id: WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id,
                hash: WORKING_THREADS.VERIFICATION_THREAD.EPOCH.hash,
                startTimestamp: WORKING_THREADS.VERIFICATION_THREAD.EPOCH.startTimestamp,

            }

        }

        response.send(responseObject)

    }else response.send({err:'Symbiote not supported'})

})




// Returns data related to checkpoints to hostchains
// eslint-disable-next-line no-unused-vars
FASTIFY_SERVER.get('/checkpoints/:epoch_index',(_request,response)=>{

    

})





// Handler to accept transaction, make overview and add to mempool ✅

FASTIFY_SERVER.post('/transaction',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    response.header('Access-Control-Allow-Origin','*')

    let transaction = JSON.parse(request.body)

    //Reject all txs if route is off and other guards methods

    /*
    
        ...and do such "lightweight" verification here to prevent db bloating
        Anyway we can bump with some short-term desynchronization while perform operations over block
        Verify and normalize object
        Fetch values about fees and MC from some decentralized sources
    
        The second operand tells us:if buffer is full-it makes whole logical expression FALSE
        Also check if we have normalizer for this type of event

    
    */

    if(typeof transaction?.creator!=='string' || typeof transaction.nonce!=='number' || typeof transaction.sig!=='string'){

        response.send({err:'Event structure is wrong'})
    
        return
    
    }
    
    if(!CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.MAIN.ACCEPT_TXS){
            
        response.send({err:'Route is off'})
            
        return
            
    }
    
    if(!TXS_FILTERS[transaction.type]){
    
        response.send({err:'No such filter. Make sure your <tx.type> is supported by current version of workflow runned on symbiote'})
            
        return
    
    }
    
    let whoIsCurrentLeader = await getCurrentLeaderURL()

    if(!whoIsCurrentLeader?.isMeLeader){

        if(whoIsCurrentLeader.url){

            fetch(whoIsCurrentLeader.url+'/transaction',{

                method:'POST', body:request.body
    
            }).catch(error=>error)

            response.send({status:`Ok, tx redirected to current leader`})

        } else response.send({err:`Impossible to redirect to current leader`})

    } else if(GLOBAL_CACHES.MEMPOOL.length < CONFIGURATION.NODE_LEVEL.TXS_MEMPOOL_SIZE){

        let filteredTx = await TXS_FILTERS[transaction.type](transaction)
        
        if(filteredTx){
    
            response.send({status:'OK'})
    
            GLOBAL_CACHES.MEMPOOL.push(filteredTx)
                            
        }else response.send({err:`Can't get filtered value of tx`})

    } else response.send({err:'Mempool is fullfilled'})
    
})