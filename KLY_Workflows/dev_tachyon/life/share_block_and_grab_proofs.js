import {getPseudoRandomSubsetFromQuorumByTicketId, getQuorumMajority} from '../common_functions/quorum_related.js'

import {getFromApprovementThreadState, useTemporaryDb} from '../common_functions/approvement_thread_related.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../blockchain_preparation.js'

import {verifyAggregatedFinalizationProof} from '../common_functions/work_with_proofs.js'

import {logColors,verifyEd25519,customLog} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyn74r.js'

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


                            if(parsedData.route === 'get_leader_rotation_proof'){

                                
                            /*                                
 
                                ___________________________ Now analyze the responses ___________________________

                            [1] In case quroum member has the same or lower index in own FINALIZATION_STATS for this pool - we'll get the response like this:

                            {
                                type:'OK',
                                sig: ED25519_SIG('LEADER_ROTATION_PROOF:<poolPubKey>:<firstBlockHash>:<skipIndex>:<skipHash>:<epochFullID>')
                            }

                            We should just verify this signature and add to local list for further aggregation
                            And this quorum member update his own local version of FP to have FP with bigger index


                            [2] In case quorum member has bigger index in FINALIZATION_STATS - it sends us 'UPDATE' message with the following format:

                            {
                
                                type:'UPDATE',
             
                                skipData:{
                                
                                    index,
                                    hash,
                                    afp:{

                                        prevBlockHash,      => must be the same as skipData.hash
                                        blockID,            => must be skipData.index+1 === blockID
                                        blockHash,
                                        proofs:{

                                            pubKey0:signa0,         => prevBlockHash+blockID+blockHash+AT.EPOCH.HASH+"#"+AT.EPOCH.id
                                        ...

                                        }

                                    }

                                }
             
                            }


                                parsedData format is:

                                {
                                    route,voter,type,forPoolPubkey

                                    skipData:{index,hash,afp} | sig:string
                                }

                                    
                                    
                            */

                                let localMetadataForPotentialAlrp = TEMP_CACHE.get(`LRPS:${parsedData.forPoolPubkey}`) // format is {afpForFirstBlock,skipIndex,skipHash,skipAfp,proofs}


                                if(localMetadataForPotentialAlrp){

                                    let firstBlockHash = localMetadataForPotentialAlrp.afpForFirstBlock.blockHash

                                    let index = localMetadataForPotentialAlrp.skipIndex

                                    let hash = localMetadataForPotentialAlrp.skipHash

                                    let dataThatShouldBeSigned = `LEADER_ROTATION_PROOF:${parsedData.forPoolPubkey}:${firstBlockHash}:${index}:${hash}:${epochFullID}`


                                    if(parsedData.type === 'OK' && typeof parsedData.sig === 'string'){
        
                                        let signatureIsOk = await verifyEd25519(dataThatShouldBeSigned,parsedData.sig,parsedData.voter)
                                
                                        if(signatureIsOk){

                                            localMetadataForPotentialAlrp.proofs[parsedData.voter] = parsedData.sig
                                                                
                                        }
                                
                                    }else if(parsedData.type === 'UPDATE' && parsedData.skipData && typeof parsedData.skipData === 'object' && parsedData.afpForFirstBlock && typeof parsedData.afpForFirstBlock === 'object'){
                                                                
                                        let {index,hash,afp} = parsedData.skipData
                                
                                        
                                        let blockIdInAfp = (epochHandler.id+':'+parsedData.forPoolPubkey+':'+index)
                                
                                        let proposedHeightIsValid = afp && typeof afp === 'object' && hash === afp.blockHash && blockIdInAfp === afp.blockID && await verifyAggregatedFinalizationProof(afp,epochHandler)
                                

                                        let firstBlockID = (epochHandler.id+':'+parsedData.forPoolPubkey+':0')

                                        let proposedFirstBlockAfpIsValid = firstBlockID === parsedData.afpForFirstBlock.blockID && await verifyAggregatedFinalizationProof(parsedData.afpForFirstBlock,epochHandler)


                                        if(proposedHeightIsValid && proposedFirstBlockAfpIsValid && localMetadataForPotentialAlrp.skipIndex < index){

                                            let {prevBlockHash,blockID,blockHash,proofs} = afp
                                                 
                                                
                                            localMetadataForPotentialAlrp.afpForFirstBlock = {

                                                prevBlockHash: parsedData.afpForFirstBlock.prevBlockHash,

                                                blockID: parsedData.afpForFirstBlock.blockID,

                                                blockHash: parsedData.afpForFirstBlock.blockHash,

                                                proofs: parsedData.afpForFirstBlock.proofs

                                            }

                                            localMetadataForPotentialAlrp.skipIndex = index
                            
                                            localMetadataForPotentialAlrp.skipHash = hash
                            
                                            localMetadataForPotentialAlrp.skipAfp = {prevBlockHash,blockID,blockHash,proofs}
                        
                                            // If our local version had lower index - clear grabbed signatures to repeat grabbing process again, with bigger block height
                            
                                            localMetadataForPotentialAlrp.proofs = {}
                                
                                        }
                                     
                                    }

                                }

                            }

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

    let {FINALIZATION_PROOFS,DATABASE,TEMP_CACHE} = currentEpochMetadata


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
        await useTemporaryDb('put',DATABASE,'PROOFS_GRABBER',proofsGrabber).then(()=>{

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

    let canGenerateBlocksNow = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)

    // If we don't generate the blocks - skip this function
    
    if(typeof canGenerateBlocksNow !== 'string'){

        setTimeout(shareBlocksAndGetFinalizationProofs,2000)

        return

    }

    let {DATABASE,TEMP_CACHE} = currentEpochMetadata

    let proofsGrabber = TEMP_CACHE.get('PROOFS_GRABBER')


    if(!proofsGrabber || proofsGrabber.epochID !== atEpochHandler.id){

        // If we still works on the old epoch - continue
        // Otherwise,update the latest height/hash and send them to the new QUORUM
        
        proofsGrabber = await useTemporaryDb('get',DATABASE,'PROOFS_GRABBER').catch(()=>false)

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

        await useTemporaryDb('put',DATABASE,'PROOFS_GRABBER',proofsGrabber).catch(()=>{})

        TEMP_CACHE.set('PROOFS_GRABBER',proofsGrabber)

    }


    await openConnectionsWithQuorum(atEpochHandler,currentEpochMetadata)

    await runFinalizationProofsGrabbing(atEpochHandler,proofsGrabber).catch(()=>{})


    setImmediate(shareBlocksAndGetFinalizationProofs)

}
