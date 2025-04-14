import {getQuorumUrlsAndPubkeys} from '../../common_functions/quorum_related.js'

import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {TXS_FILTERS} from '../../verification_process/txs_filters.js'

import {GLOBAL_CACHES, WORKING_THREADS} from '../../globals.js'

import {getCurrentLeaderURL} from '../../utils.js'




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