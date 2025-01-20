import {getUserAccountFromState, getContractAccountFromState, trackStateChange} from "../../common_functions/state_interactions.js"

import {verifyQuorumMajoritySolution} from "../../common_functions/work_with_proofs.js"

import {GLOBAL_CACHES, WORKING_THREADS} from "../../globals.js"

import {blake3Hash} from "../../../../KLY_Utils/utils.js"




export let gasUsedByMethod=methodID=>{

    if(methodID==='createContract') return 10000

    else if(methodID==='resolveContract') return 10000

}




export let CONTRACT = {


    createContract:async(originShard,transaction,atomicBatch)=>{

        /*
        
            Format of transaction.payload.params is
       
            {

                params:{

                    agreementText:'Lorem ipsum dolor sit amet. If delivery delay with to transfer 5 KLY to account <bblalba>',

                    delegations:{

                        account1:[], // delegations in form of {contract:'',method:'',params:{}}
                    
                        account2:[],

                        ...
                        accountN:[]

                    }

                    ...<Here in form of key:value will be added additional params to extend the mediation setup. For example, preffered region and language, wished validators and other params>

                }

                signatures:{

                    account1: {sigType:'D',sig:SIG(params+tx.nonce)}
                    
                    account2: {sigType:'M',sig:SIG(params+tx.nonce)},

                    ...
                    accountN: {sigType:'P/D',sig:SIG(params+tx.nonce)}

                }

            }
        
        */

        // Create metadata first
        
        let futureRwxContractMetadataTemplate = {

            type:'contract',
            lang:'system/rwx/sub',
            balance:'0',
            gas:0,
            storages:['DEFAULT'],
            storageAbstractionLastPayment:-1

        }

        // ...then - create a single storage for this new contract to store the body itself
        let futureRwxContractSingleStorage = transaction.payload.params

        let contractID = `0x${blake3Hash(originShard+transaction.creator+transaction.nonce)}`

        
        // And put it to atomic batch to BLOCKCHAIN_DATABASES.STATE

        atomicBatch.put(originShard+':'+contractID,futureRwxContractMetadataTemplate)

        trackStateChange(originShard+':'+contractID,1,'put')

        atomicBatch.put(originShard+':'+contractID+'_STORAGE_DEFAULT',futureRwxContractSingleStorage)

        trackStateChange(originShard+':'+contractID+'_STORAGE_DEFAULT',1,'put')


        WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.rwxContracts.total++

        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.rwxContracts.total++


        return {isOk:true}

    },




    resolveContract:async(originShard,transaction,atomicBatch)=>{

        // Here we simply execute array of delegations by contract parties dependent on solution and delete contract from state to mark deal as solved and prevent replay attacks
        // For stats it's possible to leave the fact of contract in separate DB
        // Batch of contract calls must be signed by quorum majority

        /*
        
            Format of transaction.payload.params is

            {

                rwxContractId:<BLAKE3 hash id of contract on this shard>,

                executionBatch:[

                   {

                        to:'account to transfer KLY to',

                        amount:<number of KLY to transfer to this account>

                    }

                    ...

                ],

                quorumAgreements:{

                    quorumMemberPubKey1: Signa1,
                    ...
                    quorumMemberPubKeyN: SignaN,

                }

            }
        
        
        */

        let epochHandler = WORKING_THREADS.VERIFICATION_THREAD.EPOCH

        let epochFullID = epochHandler.hash+'#'+epochHandler.id

        let payloadJSON = JSON.stringify(transaction.payload) 
    
        let dataThatShouldBeSigned = `RWX:${epochFullID}:${payloadJSON}`
    
        let proofsByQuorumMajority = transaction.payload?.params?.quorumAgreements



        if(verifyQuorumMajoritySolution(dataThatShouldBeSigned,proofsByQuorumMajority)){

            // Now, parse the rest data from payload and execute all inner txs

            let {rwxContractId, executionBatch} = transaction.payload.params

            // Check if it's not a same-block-replay attack

            if(!GLOBAL_CACHES.STATE_CACHE.has(originShard+':'+rwxContractId+':'+'REPLAY_PROTECTION')){

                // Check if contract present in state

                let rwxContractRelatedToDeal = await getContractAccountFromState(originShard+':'+rwxContractId)

                if(rwxContractRelatedToDeal){

                    for(let subTx of executionBatch){

                        // Each tx has format like TX type -> {to,amount}
                        
                        let recipientAccount = await getUserAccountFromState(originShard+':'+subTx.to)

                        let amountInWeiToTransfer = BigInt(subTx.amount)

                        let hasEnoughToTransfer = (rwxContractRelatedToDeal.balance - amountInWeiToTransfer) >= 0n

                        if(recipientAccount && hasEnoughToTransfer){

                            recipientAccount.balance += amountInWeiToTransfer

                            rwxContractRelatedToDeal.balance -= amountInWeiToTransfer

                        }   
    
                    }
    
                    // Finally - delete this RWX contract from DB to prevent replay attacks
                
                    atomicBatch.del(originShard+':'+rwxContractId)
    
                    atomicBatch.del(originShard+':'+rwxContractId+'_STORAGE_DEFAULT')


                    WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.rwxContracts.closed++

                    WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.rwxContracts.closed++


                    // Delete from cache too

                    GLOBAL_CACHES.STATE_CACHE.delete(originShard+':'+rwxContractId)

                    GLOBAL_CACHES.STATE_CACHE.delete(originShard+':'+rwxContractId+'_STORAGE_DEFAULT')
                
                    GLOBAL_CACHES.STATE_CACHE.set(originShard+':'+rwxContractId+':'+'REPLAY_PROTECTION',true)


                } else return {isOk:false, reason:'No RWX contract with this id'}
                
            } else return {isOk:false, reason:'Replay attack detection'}
            
        } else return {isOk:false, reason:'Majority verification failed'}

    }

}