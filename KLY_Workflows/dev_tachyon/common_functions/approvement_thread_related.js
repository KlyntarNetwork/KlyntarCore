import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES} from '../globals.js'



export let getFromApprovementThreadState = async recordID => {

    return GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(recordID) || BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.get(recordID)
    
        .then(something=>{
 
            GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.set(recordID,something)

            return GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(recordID)
 
    
        }).catch(()=>false)

}