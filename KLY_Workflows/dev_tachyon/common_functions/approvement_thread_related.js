import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES} from '../blockchain_preparation.js'






export let getFromApprovementThreadState = async recordID => {

    return GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.get(recordID)
    
        .then(something=>{
 
            GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.set(recordID,something)

            return GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(recordID)
 
    
        }).catch(()=>false)

}




export let useTemporaryDb = async(operationType,dbReference,keys,values) => {


    if(operationType === 'get'){

        let value = await dbReference.get(keys)

        return value

    }
    
    else if(operationType === 'put') await dbReference.put(keys,values)

}