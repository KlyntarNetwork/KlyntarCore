import {getPseudoRandomSubsetFromQuorumByTicketId, getQuorumMajority} from '../common_functions/quorum_related.js'

import {getFromApprovementThreadState} from '../common_functions/approvement_thread_related.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../globals.js'

import {logColors,verifyEd25519,customLog} from '../../../KLY_Utils/utils.js'

import {grabEpochFinalizationProofs} from './new_epoch_proposer.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

import {epochStillFresh} from '../utils.js'

import Block from '../structures/block.js'

import WS from 'websocket'





let openConnectionsWithQuorum = async (epochHandler,currentEpochMetadata) => {

    // Now we can open required WebSocket connections with quorums majority

    let {FINALIZATION_PROOFS,TEMP_CACHE} = currentEpochMetadata

    let epochFullID = epochHandler.hash + "#" + epochHandler.id

    for(let pubKey of epochHandler.quorum){

        // Check if we already have an open connection stored in cache

        if(!TEMP_CACHE.has('WS:'+pubKey)){
            
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

                            let proofsGrabber = TEMP_CACHE.get('PROOFS_GRABBER')

                            if(parsedData.finalizationProof && proofsGrabber.huntingForHash === parsedData.votedForHash && FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID)){

                                if(parsedData.type === 'tmb'){

                                    let dataThatShouldBeSigned = proofsGrabber.acceptedHash+proofsGrabber.huntingForBlockID+proofsGrabber.huntingForHash+epochFullID
                        
                                    let finalizationProofIsOk = FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID) && epochHandler.quorum.includes(parsedData.voter) && await verifyEd25519(dataThatShouldBeSigned,parsedData.finalizationProof,parsedData.voter)

                                    if(finalizationProofIsOk && FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID)){
                        
                                        FINALIZATION_PROOFS.get(proofsGrabber.huntingForBlockID).set(parsedData.voter,parsedData.finalizationProof)
                        
                                    }

                                } else if(parsedData.tmbProof) {

                                    // Verify the finalization proof
                        
                                    let dataThatShouldBeSigned = proofsGrabber.acceptedHash+proofsGrabber.huntingForBlockID+proofsGrabber.huntingForHash+epochFullID
                        
                                    let finalizationProofIsOk = FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID) && epochHandler.quorum.includes(parsedData.voter) && await verifyEd25519(dataThatShouldBeSigned,parsedData.finalizationProof,parsedData.voter)

                                    // Now verify the TMB proof(that block was delivered)

                                    dataThatShouldBeSigned += 'VALID_BLOCK_RECEIVED'

                                    let tmbProofIsOk = await verifyEd25519(dataThatShouldBeSigned,parsedData.tmbProof,parsedData.voter)
                            
                                    if(finalizationProofIsOk && tmbProofIsOk && FINALIZATION_PROOFS.has(proofsGrabber.huntingForBlockID)){
                        
                                        FINALIZATION_PROOFS.get(proofsGrabber.huntingForBlockID).set(parsedData.voter,parsedData.finalizationProof)

                                        FINALIZATION_PROOFS.get('TMB:'+proofsGrabber.huntingForBlockID).set(parsedData.voter,parsedData.tmbProof)
                        
                                    }

                                }

                            }
                                                
                        }        

                    })

                    connection.on('close',()=>TEMP_CACHE.delete('WS:'+pubKey))
                      
                    connection.on('error',()=>TEMP_CACHE.delete('WS:'+pubKey))

                    TEMP_CACHE.set('WS:'+pubKey,connection)

                })
                
            }
                 
        }

    }

}




let runFinalizationProofsGrabbing = async (epochHandler,proofsGrabber) => {    

    let epochFullID = epochHandler.hash + "#" + epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return

    let {FINALIZATION_PROOFS,TEMP_CACHE} = currentEpochMetadata


    // Get the block index & hash that we're currently hunting for

    let blockIDForHunting = epochHandler.id+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+(proofsGrabber.acceptedIndex+1)

    let finalizationProofsMapping, tmbProofsMapping


    if(FINALIZATION_PROOFS.has(blockIDForHunting)){

        finalizationProofsMapping = FINALIZATION_PROOFS.get(blockIDForHunting)

        tmbProofsMapping = FINALIZATION_PROOFS.get('TMB:'+blockIDForHunting)
    }

    else{

        finalizationProofsMapping = new Map()
        
        tmbProofsMapping = new Map()

        FINALIZATION_PROOFS.set(blockIDForHunting,finalizationProofsMapping)
        
        FINALIZATION_PROOFS.set('TMB:'+blockIDForHunting,tmbProofsMapping)

    }

    let majority = getQuorumMajority(epochHandler)

    let blockToSend = TEMP_CACHE.get(blockIDForHunting) || await BLOCKCHAIN_DATABASES.BLOCKS.get(blockIDForHunting).catch(()=>null)


    if(!blockToSend) return


    let blockHash = Block.genHash(blockToSend)


    TEMP_CACHE.set(blockIDForHunting,blockToSend)


    proofsGrabber.huntingForBlockID = blockIDForHunting

    proofsGrabber.huntingForHash = blockHash


    if(finalizationProofsMapping.size<majority){

        // To prevent spam

        // In case we already have enough TMB proofs - no sense to send blocks to the rest. Send just TMB proofs as proofs that "enough number of validators from quorum has a valid block"

        if(tmbProofsMapping.size > 21){

            // Otherwise - send blocks to safe minority to grab TMB proofs

            let templateToSend = {}

            tmbProofsMapping.forEach((signa,pubKey)=>templateToSend[pubKey] = signa)

            let dataToSend = JSON.stringify({

                route:'tmb',
            
                blockCreator: blockToSend.creator,

                blockIndex:blockToSend.index,

                blockHash: blockHash,
                
                previousBlockAFP:proofsGrabber.afpForPrevious,

                tmbProofs: templateToSend,

                tmbTicketID:0
    
            })
    
    
            for(let pubKeyOfQuorumMember of epochHandler.quorum){
    
                // No sense to get finalization proof again if we already have
    
                if(finalizationProofsMapping.has(pubKeyOfQuorumMember)) continue
    
                let connection = TEMP_CACHE.get('WS:'+pubKeyOfQuorumMember)
    
                if(connection) connection.sendUTF(dataToSend)
    
            }

            await new Promise(resolve=>

                setTimeout(()=>resolve(),200)
        
            )


        } else {

            if(TEMP_CACHE.has('FP_SPAM_FLAG')) return
    
            TEMP_CACHE.set('FP_SPAM_FLAG',true)

            // Otherwise - send blocks to safe minority to grab TMB proofs

            let dataToSend = JSON.stringify({

                route:'get_finalization_proof',
            
                block:blockToSend,
                
                previousBlockAFP:proofsGrabber.afpForPrevious
    
            })
    
            // Send only to safe subset of validators from quorum

            let subsetToSendBlocks = getPseudoRandomSubsetFromQuorumByTicketId(0,epochHandler)
    
            for(let pubKeyOfQuorumMember of subsetToSendBlocks){
    
                // No sense to contact if we already have a proof
    
                if(finalizationProofsMapping.has(pubKeyOfQuorumMember)) continue
    
                let connection = TEMP_CACHE.get('WS:'+pubKeyOfQuorumMember)
    
                if(connection){

                    connection.sendUTF(dataToSend)

                }
    
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
        FINALIZATION_PROOFS.delete(blockIDForHunting)

        FINALIZATION_PROOFS.delete('TMB:'+blockIDForHunting)


        // Repeat procedure for the next block and store the progress
        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('PROOFS_GRABBER',proofsGrabber).then(()=>{

            proofsGrabber.afpForPrevious = aggregatedFinalizationProof

            proofsGrabber.acceptedIndex++
    
            proofsGrabber.acceptedHash = proofsGrabber.huntingForHash

        }).catch(()=>{})


        customLog(`Approved height for epoch \u001b[38;5;50m${epochHandler.id} \x1b[31;1mis \u001b[38;5;50m${proofsGrabber.acceptedIndex-1} \x1b[32;1m(${(finalizationProofsMapping.size/epochHandler.quorum.length).toFixed(3)*100}% agreements)`,logColors.RED)

        console.log('\n')

        TEMP_CACHE.delete('FP_SPAM_FLAG')

        TEMP_CACHE.delete(blockIDForHunting)


    }else{

        setTimeout(()=>TEMP_CACHE.delete('FP_SPAM_FLAG'),10000)

    }

}











export let shareBlocksAndGetFinalizationProofs = async () => {

    let atEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = atEpochHandler.hash + "#" + atEpochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)



    if(!currentEpochMetadata){

        setTimeout(shareBlocksAndGetFinalizationProofs,2000)

        return

    }

    // If we don't generate the blocks - skip this function
    
    if(CONFIGURATION.NODE_LEVEL.OPTIONAL_SEQUENCER !== CONFIGURATION.NODE_LEVEL.PUBLIC_KEY){

        setTimeout(shareBlocksAndGetFinalizationProofs,2000)

        return

    }

    let {TEMP_CACHE} = currentEpochMetadata

    let proofsGrabber = TEMP_CACHE.get('PROOFS_GRABBER')


    if(!proofsGrabber || proofsGrabber.epochID !== atEpochHandler.id){

        // If we still works on the old epoch - continue
        // Otherwise,update the latest height/hash and send them to the new QUORUM
        
        proofsGrabber = await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.get('PROOFS_GRABBER').catch(()=>null)

        if(!proofsGrabber){

            // Set the new handler with index 0(because each new epoch start with block index 0)
            
            proofsGrabber = {
    
                epochID:atEpochHandler.id,

                acceptedIndex:-1,

                acceptedHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

                afpForPrevious:{}
    
            }
    
        }
        
        // And store new descriptor

        await BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put('PROOFS_GRABBER',proofsGrabber).catch(()=>{})

        TEMP_CACHE.set('PROOFS_GRABBER',proofsGrabber)

    }


    await openConnectionsWithQuorum(atEpochHandler,currentEpochMetadata)

    let haveAtLeastOneApprovedBlock = proofsGrabber.acceptedIndex > -1

    let epochIsOutdated = !epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)

    if(haveAtLeastOneApprovedBlock && epochIsOutdated){

        await grabEpochFinalizationProofs()

    } else {

        await runFinalizationProofsGrabbing(atEpochHandler,proofsGrabber).catch(()=>{})

    }
    
    setImmediate(shareBlocksAndGetFinalizationProofs)

}
