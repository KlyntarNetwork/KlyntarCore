import {CONFIGURATION, FASTIFY_SERVER} from '../../../../klyntar_core.js'

import {signEd25519} from '../../../../KLY_Utils/utils.js'

import {BLOCKCHAIN_DATABASES} from '../../globals.js'




FASTIFY_SERVER.post('/sign_delayed_ops_batch',{bodyLimit:CONFIGURATION.NODE_LEVEL.MAX_PAYLOAD_SIZE},async(request,response)=>{

    let batchOfDelayedTxs = JSON.parse(request.body) // {epochIndex, delayedTransactions}

    if(typeof batchOfDelayedTxs === 'object'){

        let {epochIndex, delayedTransactions} = batchOfDelayedTxs

        if(typeof epochIndex === 'number' && Array.isArray(delayedTransactions)){

            // Take our own version of array

            let localVersionOfDelayedTransactions = await BLOCKCHAIN_DATABASES.STATE.get(`DELAYED_TRANSACTIONS:${epochIndex}`).catch(()=>null)

            if(Array.isArray(localVersionOfDelayedTransactions)){

                // Now compare

                let isEqual = JSON.stringify(delayedTransactions) === JSON.stringify(localVersionOfDelayedTransactions)

                if(isEqual){

                    // All good, sign and return agreement signature

                    let dataThatShouldBeSigned = `SIG_DELAYED_OPERATIONS:${epochIndex}:${JSON.stringify(delayedTransactions)}`

                    response.send({sig:await signEd25519(dataThatShouldBeSigned,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)})

                } else response.send({err:'Not equal batches'})

            } else response.send({err:'No local version'})

        } else response.send({err:'Wrong format'})

    } else response.send({err:'Wrong format'})

})