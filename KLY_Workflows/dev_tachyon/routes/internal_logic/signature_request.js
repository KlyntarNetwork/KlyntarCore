import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'




FASTIFY_SERVER.post('/sign_delayed_ops_batch',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    let batchOfDelayedTxs = JSON.parse(request.body) // {epochIndex, delayedTransactions}

    if(typeof batchOfDelayedTxs === 'object'){

        let {epochIndex, delayedTransactions} = batchOfDelayedTxs

        if(typeof epochIndex === 'number' && Array.isArray(delayedTransactions)){

            //

        } else response.send({err:'Wrong format'})

    } else response.send({err:'Wrong format'})

})