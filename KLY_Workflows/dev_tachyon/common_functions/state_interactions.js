import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES} from '../globals.js'





/**
 * @param {'put'|'delete'|'update'} crudOp
 */
export let trackStateChange = (key,value,crudOp) => {

    GLOBAL_CACHES.STATE_CHANGES_CACHE[crudOp][key] = value

}




export let getUserAccountFromState = async recordID =>{

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
        .then(account=>{
 
            if(account.type==='eoa') {

                trackStateChange(recordID,account,'update') // we need to know the state of account before transactions in block

                account.balance = BigInt(account.balance)

                GLOBAL_CACHES.STATE_CACHE.set(recordID,account)

                return GLOBAL_CACHES.STATE_CACHE.get(recordID)

            } 
    
        }).catch(()=>null)
 
}


export let getContractAccountFromState = async recordID =>{

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
        .then(account=>{
 
            if(account.type==='contract') {

                trackStateChange(recordID,account,'update') // we need to know the state of account before transactions in block

                account.balance = BigInt(account.balance)

                GLOBAL_CACHES.STATE_CACHE.set(recordID,account)

                return GLOBAL_CACHES.STATE_CACHE.get(recordID)

            }
    
        }).catch(()=>null)
 
}


export let getFromState = async recordID => {

    // We get from db only first time-the other attempts will be gotten from cache

    return GLOBAL_CACHES.STATE_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.STATE.get(recordID)
    
        .then(something=>{

            trackStateChange(recordID,something,'update') // we need to know the state of account before transactions in block
 
            GLOBAL_CACHES.STATE_CACHE.set(recordID,something)

            return GLOBAL_CACHES.STATE_CACHE.get(recordID)
 
    
        }).catch(()=>{

            if(recordID.startsWith('DELAYED_TRANSACTIONS')){

                trackStateChange(recordID,1,'put')

                GLOBAL_CACHES.STATE_CACHE.set(recordID,[])

                return GLOBAL_CACHES.STATE_CACHE.get(recordID)

            }

            return null

        })

}