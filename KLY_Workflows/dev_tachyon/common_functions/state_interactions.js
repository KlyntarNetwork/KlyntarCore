import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES} from '../blockchain_preparation.js'








export let getUserAccountFromState = async recordID =>{

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
        .then(account=>{
 
            if(account.type==='eoa') {

                account.balance = BigInt(account.balance)

                GLOBAL_CACHES.STATE_CACHE.set(recordID,account)

            }

            return GLOBAL_CACHES.STATE_CACHE.get(recordID)
 
    
        }).catch(()=>false)
 
}


export let getContractAccountFromState = async recordID =>{

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
        .then(account=>{
 
            if(account.type==='contract') {

                account.balance = BigInt(account.balance)

                GLOBAL_CACHES.STATE_CACHE.set(recordID,account)

            }

            return GLOBAL_CACHES.STATE_CACHE.get(recordID)
 
    
        }).catch(()=>false)
 
}


export let getFromState = async recordID => {

    // We get from db only first time-the other attempts will be gotten from cache

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
        .then(something=>{
 
            GLOBAL_CACHES.STATE_CACHE.set(recordID,something)

            return GLOBAL_CACHES.STATE_CACHE.get(recordID)
 
    
        }).catch(()=>false)

}