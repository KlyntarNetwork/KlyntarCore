import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, GLOBAL_CACHES, WORKING_THREADS} from '../globals.js'

import {getFromApprovementThreadState} from '../common_functions/approvement_thread_related.js'

import {logColors,verifyEd25519,customLog} from '../../../KLY_Utils/utils.js'

import {getQuorumMajority} from '../common_functions/quorum_related.js'

import {grabEpochFinalizationProofs} from './new_epoch_proposer.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

import {epochStillFresh} from '../utils.js'

import Block from '../structures/block.js'

import WS from 'websocket'





let openConnectionsWithQuorum = async (epochHandler) => {

    // Now we can open required WebSocket connections with quorums majority

    let epochFullID = epochHandler.hash + "#" + epochHandler.id

    for(let pubKey of epochHandler.quorum){

        // Check if we already have an open connection stored in cache

        if(!GLOBAL_CACHES.TEMP_CACHE.has('WS:'+pubKey)){
            
            let poolStorage = await getFromApprovementThreadState(pubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

            if(poolStorage){

                let WebSocketClient = WS.client
    
                let client = new WebSocketClient({})
                
                
                // Connect to remote WSS server
                client.connect(poolStorage.wssPoolURL,'echo-protocol')
                
                client.on('connect',connection=>{

                    connection.on('message',async message=>{                        

                        if(message.type === 'utf8'){

                            let parsedData = JSON.parse(message.utf8Data)

                            let proofsGrabber = GLOBAL_CACHES.TEMP_CACHE.get('PROOFS_GRABBER')

                            if(parsedData.finalizationProof && proofsGrabber.huntingForHash === parsedData.votedForHash && GLOBAL_CACHES.FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID)){

                                // Verify the finalization proof
                                                        
                                let dataThatShouldBeSigned = proofsGrabber.acceptedHash+proofsGrabber.huntingForBlockID+proofsGrabber.huntingForHash+epochFullID
                                                        
                                let finalizationProofIsOk = GLOBAL_CACHES.FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID) && epochHandler.quorum.includes(parsedData.voter) && await verifyEd25519(dataThatShouldBeSigned,parsedData.finalizationProof,parsedData.voter)


                                if(finalizationProofIsOk && GLOBAL_CACHES.FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID)){

                                    GLOBAL_CACHES.FINALIZATION_PROOFS.get(proofsGrabber.huntingForBlockID).set(parsedData.voter,parsedData.finalizationProof)

                                }

                            }
                                                
                        }        

                    })

                    connection.on('close',()=>GLOBAL_CACHES.TEMP_CACHE.delete('WS:'+pubKey))
                      
                    connection.on('error',()=>GLOBAL_CACHES.TEMP_CACHE.delete('WS:'+pubKey))

                    GLOBAL_CACHES.TEMP_CACHE.set('WS:'+pubKey,connection)

                })
                
            }
                 
        }

    }

}




let runFinalizationProofsGrabbing = async (epochHandler,proofsGrabber) => {

    let epochIndex = epochHandler.id

    let epochFullID = epochHandler.hash + "#" + epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return


    // Get the block index & hash that we're currently hunting for

    let blockIDForHunting = epochHandler.id+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+(proofsGrabber.acceptedIndex+1)

    let finalizationProofsMapping


    if(GLOBAL_CACHES.FINALIZATION_PROOFS.has(blockIDForHunting)){

        finalizationProofsMapping = GLOBAL_CACHES.FINALIZATION_PROOFS.get(blockIDForHunting)

    }

    else{

        finalizationProofsMapping = new Map()

        GLOBAL_CACHES.FINALIZATION_PROOFS.set(blockIDForHunting,finalizationProofsMapping)

    }

    let majority = getQuorumMajority(epochHandler)

    let blockToSend = GLOBAL_CACHES.TEMP_CACHE.get(blockIDForHunting) || await BLOCKCHAIN_DATABASES.BLOCKS.get(blockIDForHunting).catch(()=>null)


    if(!blockToSend) return


    let blockHash = Block.genHash(blockToSend)


    GLOBAL_CACHES.TEMP_CACHE.set(blockIDForHunting,blockToSend)


    proofsGrabber.huntingForBlockID = blockIDForHunting

    proofsGrabber.huntingForHash = blockHash
    

    if(finalizationProofsMapping.size<majority){

        // To prevent spam - set special flag

        if(GLOBAL_CACHES.TEMP_CACHE.has('FP_SPAM_FLAG')) return
    
        GLOBAL_CACHES.TEMP_CACHE.set('FP_SPAM_FLAG',true)


        let dataToSend = JSON.stringify({

            route:'get_finalization_proof',
        
            block:blockToSend,
            
            previousBlockAFP:proofsGrabber.afpForPrevious

        })


        let subsetToSendBlocks = epochHandler.quorum

        for(let pubKeyOfQuorumMember of subsetToSendBlocks){

            // No sense to contact if we already have a proof

            if(finalizationProofsMapping.has(pubKeyOfQuorumMember)) continue

            let connection = GLOBAL_CACHES.TEMP_CACHE.get('WS:'+pubKeyOfQuorumMember)

            if(connection){

                connection.sendUTF(dataToSend)

            }

        }    

    }


    //_______________________ It means that we now have enough FINALIZATION_PROOFs for appropriate block. Now we can start to generate AGGREGATED_FINALIZATION_PROOF _______________________

    if(finalizationProofsMapping.size >= majority){

        // In this case , aggregate FINALIZATION_PROOFs to get the AGGREGATED_FINALIZATION_PROOF and share over the network
        // Also, increase the counter of currentEpochMetadata.TEMP_CACHE.get('PROOFS_GRABBER') to move to the next block and udpate the hash

        /*
        
        Aggregated version of FINALIZATION_PROOFs (it's AGGREGATED_FINALIZATION_PROOF)
        
        {
            prevBlockHash:"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        
            blockID:"93:7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1337",

            blockHash:"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        
            proofs:{

                voterPubKey0:hisEd25519Signa,
                ...
                voterPubKeyN:hisEd25519Signa

            }

        }
    

        */
        
        let aggregatedFinalizationProof = {

            prevBlockHash:proofsGrabber.acceptedHash,

            blockID:blockIDForHunting,
            
            blockHash,

            proofs:Object.fromEntries(finalizationProofsMapping)
            
        }


        // Store locally
        await BLOCKCHAIN_DATABASES.EPOCH_DATA.put('AFP:'+blockIDForHunting,aggregatedFinalizationProof).catch(()=>false)

        // Delete finalization proofs that we don't need more

        GLOBAL_CACHES.FINALIZATION_PROOFS.delete(blockIDForHunting)

        // Repeat procedure for the next block and store the progress

        let latestRID = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('RELATIVE_INDEX').catch(()=>0)

        let atomicBatch = BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.batch()


        atomicBatch.put(`RID:${latestRID}`,blockIDForHunting)

        atomicBatch.put('RELATIVE_INDEX',latestRID+1)


        let epochIsOutdated = !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)

        let copyOfProofsGrabber = {...proofsGrabber}

        let shouldStopVotingProcess = copyOfProofsGrabber.acceptedIndex >= 1 && epochIsOutdated


        if(shouldStopVotingProcess) copyOfProofsGrabber.finishedVoting = true

        
        atomicBatch.put(epochIndex+':PROOFS_GRABBER',copyOfProofsGrabber)


        await atomicBatch.write().then(()=>{

            if(shouldStopVotingProcess){

                proofsGrabber.finishedVoting = true

            }

            proofsGrabber.afpForPrevious = aggregatedFinalizationProof

            proofsGrabber.acceptedIndex++
    
            proofsGrabber.acceptedHash = proofsGrabber.huntingForHash

        }).catch(()=>{})


        customLog(`Approved height for epoch \u001b[38;5;50m${epochHandler.id} \x1b[31;1mis \u001b[38;5;50m${proofsGrabber.acceptedIndex-1} \x1b[32;1m(${(finalizationProofsMapping.size/epochHandler.quorum.length).toFixed(3)*100}% agreements)`,logColors.RED)

        console.log('\n')

        GLOBAL_CACHES.TEMP_CACHE.delete('FP_SPAM_FLAG')

        GLOBAL_CACHES.TEMP_CACHE.delete(blockIDForHunting)


    }else{

        setTimeout(()=>GLOBAL_CACHES.TEMP_CACHE.delete('FP_SPAM_FLAG'),10000)

    }

}











export let startBlocksSharingAndProofsGrabingThread = async () => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochIndex = epochHandler.id
    
    let epochFullID = epochHandler.hash + "#" + epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)



    if(!currentEpochMetadata){

        setTimeout(startBlocksSharingAndProofsGrabingThread,2000)

        return

    }

    // If we don't generate the blocks - skip this function
    
    if(CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER !== CONFIGURATION.NODE_LEVEL.PUBLIC_KEY){

        setTimeout(startBlocksSharingAndProofsGrabingThread,2000)

        return

    }

    let proofsGrabber = GLOBAL_CACHES.TEMP_CACHE.get('PROOFS_GRABBER')


    if(!proofsGrabber || proofsGrabber.epochID !== epochHandler.id){

        // If we still works on the old epoch - continue
        // Otherwise,update the latest height/hash and send them to the new QUORUM
        
        proofsGrabber = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get(epochIndex+':PROOFS_GRABBER').catch(()=>null)

        if(!proofsGrabber){

            // Set the new handler with index 0(because each new epoch start with block index 0)
            
            proofsGrabber = {
    
                epochID:epochHandler.id,

                acceptedIndex:-1,

                acceptedHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

                afpForPrevious:{}
    
            }
    
        }
        
        // And store new descriptor

        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put(epochIndex+':PROOFS_GRABBER',proofsGrabber).catch(()=>{})

        GLOBAL_CACHES.TEMP_CACHE.set('PROOFS_GRABBER',proofsGrabber)

    }


    await openConnectionsWithQuorum(epochHandler)


    let epochIsOutdated = !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)


    if(proofsGrabber.finishedVoting && epochIsOutdated){

        await grabEpochFinalizationProofs()

    } else {

        await runFinalizationProofsGrabbing(epochHandler,proofsGrabber)

    }
    
    setImmediate(startBlocksSharingAndProofsGrabingThread)

}
