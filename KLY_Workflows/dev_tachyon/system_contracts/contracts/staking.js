/* eslint-disable no-unused-vars */

import {getFromState, getUserAccountFromState} from '../../common_functions/state_interactions.js'

import {GLOBAL_CACHES,WORKING_THREADS} from '../../blockchain_preparation.js'




export let gasUsedByMethod=methodID=>{

    if(methodID==='createStakingPool') return 10000

    else if(methodID==='stake') return 10000

    else if(methodID==='unstake') return 10000

    else if(methodID==='slashing') return 10000

}




export let CONTRACT = {

     /*
    
    Used by pool creators to create contract instance and a storage "POOL"

    transaction.payload is
    
    {
        contractID:'system/staking',
        method:'createStakingPool',
        gasLimit:0,
        imports:[],
        params:{
            percentage, poolURL, wssPoolURL
        }
        
    Required input params

        [*] percentage - % of fees that will be earned by pubkey related to PoolID. The rest(100%-Percentage) will be shared among stakers
        [*] poolURL - URL in form http(s)://<domain_or_direct_ip_of_server_cloud_or_smth_like_this>:<port>/<optional_path>
        [*] wssPoolURL - WSS(WebSocket over HTTPS) URL provided by pool for fast data exchange, proofs grabbing, etc.

    */
    createStakingPool:async (originShard,transaction) => {

        let {percentage,poolURL,wssPoolURL} = transaction.payload.params

        if(percentage >= 0 && percentage <= 1 && typeof poolURL === 'string' && typeof wssPoolURL === 'string'){

            // Get the array of delayed operations

            let overNextEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id+2

            let delayedTransactions = await getFromState(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`) // should be array of delayed operations

            if(!Array.isArray(delayedTransactions)){

                delayedTransactions = []

            }

            let templateToPush = {

                type:'createStakingPool',

                creator: transaction.creator,

                originShard, percentage, poolURL, wssPoolURL

            }

            delayedTransactions.push(templateToPush)

            GLOBAL_CACHES.STATE_CACHE.set(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`,delayedTransactions)

            return {isOk:true}

        } else return {isOk:false, reason: `Failed with input verification`}

    },



    updateStakingPool:async (originShard,transaction) => {

        let {activated,percentage,poolURL,wssPoolURL} = transaction.payload.params

        if(percentage >= 0 && percentage <= 1 && typeof poolURL === 'string' && typeof wssPoolURL === 'string'){

            // Get the array of delayed operations

            let overNextEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id+2

            let delayedTransactions = await getFromState(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`) // should be array of delayed operations

            if(!Array.isArray(delayedTransactions)){

                delayedTransactions = []

            }

            let templateToPush = {

                type:'updateStakingPool',

                creator: transaction.creator,

                originShard, activated, percentage, poolURL, wssPoolURL

            }

            delayedTransactions.push(templateToPush)

            GLOBAL_CACHES.STATE_CACHE.set(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`,delayedTransactions)

            return {isOk:true}

        } else return {isOk:false, reason: `Failed with input verification`}

    },


    /*
    
    Method to stake to some pool that exists

    transaction.payload.params is:

    {
        poolPubKey:<Format is Ed25519_pubkey>,
        amount:<amount in KLY>
    }
    
    */
    
    stake:async(originShard,transaction) => {

        let txCreatorAccount = await getUserAccountFromState(originShard+':'+transaction.creator)

        let {poolPubKey,amount} = transaction.payload.params

        if(txCreatorAccount && typeof poolPubKey === 'string' && typeof amount === 'number'){
            
            if(amount <= txCreatorAccount.balance){

                amount = Number(amount.toFixed(9))

                txCreatorAccount.balance -= amount

                txCreatorAccount.balance -= 0.000000001

            }

            // Now add it to delayed operations

            let overNextEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id+2

            let delayedTransactions = await getFromState(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`) // should be array of delayed operations

            if(!Array.isArray(delayedTransactions)){

                delayedTransactions = []

            }

            let templateToPush = {

                type:'stake',

                staker: transaction.creator,

                poolPubKey, amount

            }

            delayedTransactions.push(templateToPush)

            GLOBAL_CACHES.STATE_CACHE.set(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`,delayedTransactions)

            return {isOk:true}

        } else return {isOk:false, reason: `Failed with input verification`}

    },


    /*
     
    Method to unstake from pool and get your assets back

    transaction.payload.params is:

    {
        poolPubKey:<Format is Ed25519_pubkey>,
        amount:<amount in KLY>
    }
    
    */
    unstake:async (originShard,transaction) => {

        let txCreatorAccount = await getUserAccountFromState(originShard+':'+transaction.creator)

        let {poolPubKey,amount} = transaction.payload.params

        if(txCreatorAccount && typeof poolPubKey === 'string' && typeof amount === 'number'){

            // Now add it to delayed operations

            let overNextEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id+2

            let delayedTransactions = await getFromState(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`) // should be array of delayed operations

            if(!Array.isArray(delayedTransactions)){

                delayedTransactions = []

            }

            let templateToPush = {

                type:'unstake',

                unstaker: transaction.creator,

                poolPubKey, amount

            }

            delayedTransactions.push(templateToPush)

            GLOBAL_CACHES.STATE_CACHE.set(`DELAYED_TRANSACTIONS:${overNextEpochIndex}:${originShard}`,delayedTransactions)

            return {isOk:true}

        } else return {isOk:false, reason: `Failed with input verification`}
 
    }
    
    // slashing:async(originShard,transaction) => {


    // }

}