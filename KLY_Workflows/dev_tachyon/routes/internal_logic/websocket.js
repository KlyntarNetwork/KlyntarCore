import {verifyAggregatedEpochFinalizationProof, verifyAggregatedFinalizationProof} from '../../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, WORKING_THREADS} from '../../blockchain_preparation.js'

import {getPseudoRandomSubsetFromQuorumByTicketId} from '../../common_functions/quorum_related.js'

import {signEd25519, verifyEd25519, logColors, customLog} from '../../../../KLY_Utils/utils.js'

import {useTemporaryDb} from '../../common_functions/approvement_thread_related.js'

import {checkAlrpChainValidity, getBlock} from '../../verification_process/verification.js'

import {CONFIGURATION} from '../../../../klyn74r.js'

import Block from '../../structures/block.js'

import WS from 'websocket'

import http from 'http'




/**
 * 
 * # Info
 * 
 * The main handler that is used for consensus. Here you:
 * 
 *  + Accept the blocks & AFP for previous block
 *  + Verify that it's the part of a valid segment(by comparing a hashes & verifying AFP)
 *  + Store the new block locally
 *  + Generate the finalization proof(FP) for a proposed block => ED25519_SIGNA(prevBlockHash+blockID+blockHash+epochFullID)
 *  + Store the fact that we have voted for a block with a specific hash for proposed slot to prevent double voting(and slashing as result) 
 * 
 * 
 * 
 * # Accept
 * 
 *
 * ```js
 * 
 * //Object like this
 * 
 * 
 * {
 *  
 *      block: {
                        
            creator:'7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta',
            time:1666744452126,
            transactions:[
                tx1,
                tx2,
                tx3,
            ]
            index:1337,
            prevHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            sig:'jXO7fLynU9nvN6Hok8r9lVXdFmjF5eye09t+aQsu+C/wyTWtqwHhPwHq/Nl0AgXDDbqDfhVmeJRKV85oSEDrMjVJFWxXVIQbNBhA7AZjQNn7UmTI75WAYNeQiyv4+R4S'
                        
        },


        previousBlockAFP:{

            prevBlockHash:"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",

            blockID:"1369:7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP:1336",
            
            blockHash:"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",

            proofs:{

                validatorEd25519PubKey0:hisEd25519Signa,
                ...
                validatorEd25519PubKeyN:hisEd25519Signa

            }
            
        }
 * 
 * } 
 * 
 * 
 *  P.S: In case it's the first block in epoch by current pool - we don't need to verify the AFP 
 * 
 * 
 * ```
 *  
 *  
 */
let returnFinalizationProofForBlock=async(parsedData,connection)=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    // Check if we should accept this block.NOTE-use this option only in case if you want to stop accept blocks or override this process via custom runtime scripts or external services
        
    if(!currentEpochMetadata || currentEpochMetadata.SYNCHRONIZER.has('TIME_TO_NEW_EPOCH')){

        connection.close()
    
        return
    
    }


    let {block,previousBlockAFP} = parsedData

    let overviewIsOk = typeof block === 'object' && typeof previousBlockAFP === 'object' && !currentEpochMetadata.SYNCHRONIZER.has('STOP_PROOFS_GENERATION:'+block.creator)


    if(!CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.MAIN.ACCEPT_BLOCKS_AND_RETURN_FINALIZATION_PROOFS || !overviewIsOk){
    
        connection.close()
                   
        return
    
    }else if(!currentEpochMetadata.SYNCHRONIZER.has('GENERATE_FINALIZATION_PROOFS:'+block.creator)){
    
        // Add the sync flag to prevent creation proofs during the process of skip this pool
        currentEpochMetadata.SYNCHRONIZER.set('GENERATE_FINALIZATION_PROOFS:'+block.creator,true)
            
        let shardID

        if(epochHandler.poolsRegistry.includes(block.creator) && typeof currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(block.creator) === 'string'){
            
            shardID = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(block.creator)

        } else {

            connection.close()

            currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+block.creator)
    
            return

        }

        
        // Make sure that we work in a sync mode + verify the signature for the latest block
    
        let finalizationStatsForThisPool = currentEpochMetadata.FINALIZATION_STATS.get(block.creator) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

        let proposedBlockHash = Block.genHash(block)

        // Check that a new proposed block is a part of a valid segment

        let sameSegment = finalizationStatsForThisPool.index < block.index || finalizationStatsForThisPool.index === block.index && proposedBlockHash === finalizationStatsForThisPool.hash && block.epoch === epochFullID


        if(sameSegment){

            let proposedBlockID = epochHandler.id+':'+block.creator+':'+block.index

            let futureMetadataToStore


            if(await verifyEd25519(proposedBlockHash,block.sig,block.creator).catch(()=>false)){

                if(finalizationStatsForThisPool.index === block.index){

                    futureMetadataToStore = finalizationStatsForThisPool
    
                }else{
    
                    futureMetadataToStore = {
    
                        index:block.index-1,
                        
                        hash:previousBlockAFP.blockHash,
    
                        afp:previousBlockAFP
    
                    }
    
                }


                let previousBlockID

                if(block.index === 0){


                    /*
    
                        And finally, if it's the first block in epoch - verify that it contains:
        
                            1) AGGREGATED_EPOCH_FINALIZATION_PROOF for previous epoch(in case we're not working on epoch 0) in block.extraData.aefpForPreviousEpoch
                            2) All the ALRPs for previous pools in leaders sequence in section block.extraData.aggregatedLeadersRotationProofs(in case the block creator is not the first pool in sequence)

                        Also, these proofs should be only in the first block in epoch, so no sense to verify blocks with index !=0

                    */


                    //_________________________________________1_________________________________________
                    
                    // Since we need to verify the AEFP signed by previous quorum - take it from legacy data
                    
                    let legacyEpochData = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`LEGACY_DATA:${epochHandler.id-1}`).catch(()=>null) // {epochFullID,quorum,majority}

                    let aefpIsOk = epochHandler.id === 0 || legacyEpochData && await verifyAggregatedEpochFinalizationProof(
        
                        block.extraData.aefpForPreviousEpoch,
                            
                        legacyEpochData.quorum,
                            
                        legacyEpochData.majority,
        
                        legacyEpochData.epochFullID
                            
                    ).catch(()=>false) && block.extraData.aefpForPreviousEpoch.shard === shardID

                        
                    //_________________________________________2_________________________________________


                    let leadersSequenceForThisShardAndEpoch = epochHandler.leadersSequence[shardID]

                    let positionOfBlockCreatorInLeadersSequence = leadersSequenceForThisShardAndEpoch.indexOf(block.creator)

                    let alrpChainIsOk = await checkAlrpChainValidity(
        
                        block,

                        leadersSequenceForThisShardAndEpoch,
        
                        positionOfBlockCreatorInLeadersSequence,
        
                        epochFullID,
        
                        epochHandler

                    ).then(value=>value.isOK).catch(()=>false)


                    if(!aefpIsOk || !alrpChainIsOk){

                        connection.close()

                        currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+block.creator)

                        return

                    }

                }else{


                    let {prevBlockHash,blockID,blockHash,proofs} = previousBlockAFP

                    previousBlockID = epochHandler.id+':'+block.creator+':'+(block.index-1)
    
                    let itsAfpForPreviousBlock = blockID === previousBlockID
        
                    if(!itsAfpForPreviousBlock || typeof prevBlockHash !== 'string' || typeof blockID !== 'string' || typeof blockHash !== 'string' || typeof proofs !== 'object'){
                        
                        connection.close()

                        currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+block.creator)
                
                        return
                
                    }
                       
                    let isOK = await verifyAggregatedFinalizationProof(previousBlockAFP,epochHandler)
    
                    if(!isOK){

                        currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+block.creator)

                        return

                    }


                }


                // Store the metadata for FINALIZATION_STATS

                useTemporaryDb('put',currentEpochMetadata.DATABASE,block.creator,futureMetadataToStore).then(()=>

                    // Store the block

                    BLOCKCHAIN_DATABASES.BLOCKS.put(proposedBlockID,block).then(()=>{

                        // Store the AFP for previous block

                        let {prevBlockHash,blockID,blockHash,proofs} = previousBlockAFP

                        BLOCKCHAIN_DATABASES.EPOCH_DATA.put('AFP:'+previousBlockID,{prevBlockHash,blockID,blockHash,proofs}).then(async()=>{

                            currentEpochMetadata.FINALIZATION_STATS.set(block.creator,futureMetadataToStore)
    

                            let dataToSign = (previousBlockAFP.blockHash || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')+proposedBlockID+proposedBlockHash+epochFullID
        
                            let finalizationProof = await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)

                            // Once we get the block - return the TMB(Trust Me Bro) proof that we have received the valid block

                            dataToSign += 'VALID_BLOCK_RECEIVED'

                            let tmbProof = await signEd25519(dataToSign,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
    
    
                            currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+block.creator)
        
                            connection.sendUTF(JSON.stringify({voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,finalizationProof,tmbProof,votedForHash:proposedBlockHash}))
    

                        })    
  
                    })
    
                ).catch(()=>{})


            } else {

                connection.close()

                currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+block.creator)
            }

        }        

    }
        
}




/*

    Accept
    
    {
        blockCreator,

        blockIndex,

        blockHash,

        previousBlockAFP,

        tmbProofs:{

            poolPubKey0: Ed25519Signa(previousBlockHash+proposedBlockID+proposedBlockHash+epochFullID+'VALID_BLOCK_RECEIVED'),
            ...
            (20 more proofs)
        }

        tmbTicketID:<int in range 0-9999>

    }

*/
let returnFinalizationProofBasedOnTmbProof=async(parsedData,connection)=>{

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    // Check if we should accept this block.NOTE-use this option only in case if you want to stop accept blocks or override this process via custom runtime scripts or external services
        
    if(!currentEpochMetadata || currentEpochMetadata.SYNCHRONIZER.has('TIME_TO_NEW_EPOCH')){

        connection.close()
    
        return
    
    }


    let {blockCreator,blockIndex,blockHash,previousBlockAFP,tmbProofs,tmbTicketID} = parsedData


    let typeCheckOverviewIsOk = typeof blockCreator === 'string' && typeof blockHash === 'string' && typeof blockIndex === 'number' && typeof tmbTicketID === 'number'
    
                                && 
                                
                                typeof previousBlockAFP === 'object' && typeof tmbProofs === 'object'
                                
                                &&
                                
                                !currentEpochMetadata.SYNCHRONIZER.has('STOP_PROOFS_GENERATION:'+blockCreator)



    if(!CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.MAIN.ACCEPT_BLOCKS_AND_RETURN_FINALIZATION_PROOFS || !typeCheckOverviewIsOk){
    
        connection.close()
                   
        return
    
    }else if(!currentEpochMetadata.SYNCHRONIZER.has('GENERATE_FINALIZATION_PROOFS:'+blockCreator)){
    
        // Add the sync flag to prevent creation proofs during the process of skip this pool
        
        currentEpochMetadata.SYNCHRONIZER.set('GENERATE_FINALIZATION_PROOFS:'+blockCreator,true)

        let thisLeaderCanGenerateBlocksNow = epochHandler.poolsRegistry.includes(blockCreator) && typeof currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(blockCreator) === 'string'
    
        
        if(!thisLeaderCanGenerateBlocksNow){
    
            connection.close()

            currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+blockCreator)
    
            return
    
        }

        
        // Make sure that we work in a sync mode + verify the signature for the latest block
    
        let finalizationStatsForThisPool = currentEpochMetadata.FINALIZATION_STATS.get(blockCreator) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

        let proposedBlockHash = blockHash

        // Check that a new proposed block is a part of a valid segment

        let sameSegment = finalizationStatsForThisPool.index < blockIndex || finalizationStatsForThisPool.index === blockIndex && proposedBlockHash === finalizationStatsForThisPool.hash


        if(sameSegment){

            let proposedBlockID = epochHandler.id+':'+blockCreator+':'+blockIndex

            let dataToSignToApproveProposedBlock = (previousBlockAFP.blockHash || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')+proposedBlockID+proposedBlockHash+epochFullID

            let futureMetadataToStore

            // Verify the TMB proofs

            let subsetOfValidators = getPseudoRandomSubsetFromQuorumByTicketId(tmbTicketID,epochHandler)

            let dataThatShouldBeSignedInTMB = dataToSignToApproveProposedBlock+'VALID_BLOCK_RECEIVED'

            // Now, we have to get valid signatures for all the members in this array

            let tmbVerificationIsOk = true


            for(let choosenValidator of subsetOfValidators) {

                let signaIsOk = await verifyEd25519(dataThatShouldBeSignedInTMB,tmbProofs[choosenValidator],choosenValidator)

                if(!signaIsOk) {

                    tmbVerificationIsOk = false

                    break

                }

            }


            if(tmbVerificationIsOk){

                if(finalizationStatsForThisPool.index === blockIndex){

                    futureMetadataToStore = finalizationStatsForThisPool
    
                }else{
    
                    futureMetadataToStore = {
    
                        index:blockIndex-1,
                        
                        hash:previousBlockAFP.blockHash,
    
                        afp:previousBlockAFP
    
                    }
    
                }


                // Now verify the aggregated skip proof
                let {prevBlockHash,blockID:blockIDFromAFP,blockHash:blockHashFromAFP,proofs} = previousBlockAFP

                if(blockIndex !== 0){

                    let previousBlockID = epochHandler.id+':'+blockCreator+':'+(blockIndex-1)
    
                    let itsReallyAfpForPreviousBlock = blockIDFromAFP === previousBlockID
    
    
                    if(!itsReallyAfpForPreviousBlock || typeof prevBlockHash !== 'string' || typeof blockIDFromAFP !== 'string' || typeof blockHashFromAFP !== 'string' || typeof proofs !== 'object'){
                            
                        connection.close()
    
                        currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+blockCreator)
                
                        return
                
                    }
                       
                    let isOK = await verifyAggregatedFinalizationProof(previousBlockAFP,epochHandler)
    
                    if(!isOK){
    
                        currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+blockCreator)
    
                        return
    
                    }
    
                }


                // Store the metadata for FINALIZATION_STATS

                useTemporaryDb('put',currentEpochMetadata.DATABASE,blockCreator,futureMetadataToStore).then(()=>{

                    // Store the AFP for previous block

                    BLOCKCHAIN_DATABASES.EPOCH_DATA.put('AFP:'+blockIDFromAFP,{prevBlockHash,blockID:blockIDFromAFP,blockHash:blockHashFromAFP,proofs}).then(async()=>{

                        currentEpochMetadata.FINALIZATION_STATS.set(blockCreator,futureMetadataToStore)
            
                        let finalizationProof = await signEd25519(dataToSignToApproveProposedBlock,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)    
    
                        currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+blockCreator)
        
                        connection.sendUTF(JSON.stringify({type:'tmb',voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,finalizationProof,votedForHash:proposedBlockHash}))
    
                    })
    
                }).catch(()=>{})


            } else {

                connection.close()

                currentEpochMetadata.SYNCHRONIZER.delete('GENERATE_FINALIZATION_PROOFS:'+blockCreator)
            }

        }        

    }
        
}




let returnBlocksRange = async(data,connection)=>{

    // We need to send range of blocks from <heightThatUserHave+1> to <heightThatUserHave+499> or less(limit is up to 500 blocks). Also, send the AFP for latest block
    // Also, the response structure is {blocks:[],afpForLatest}

    let responseStructure = {

        blocks:[],

        afpForLatest:{}

    }

    
    for(let i=1;i<50;i++){

        let blockIdToFind = data.epochIndex+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+(data.hasUntilHeight+i)

        let blockIdToFindAfp = data.epochIndex+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+(data.hasUntilHeight+i+1)

        let block = await BLOCKCHAIN_DATABASES.BLOCKS.get(blockIdToFind).catch(()=>null)

        let afpForBlock = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get('AFP:'+blockIdToFindAfp).catch(()=>null)

        if(block && afpForBlock){

            responseStructure.blocks.push(block)

            responseStructure.afpForLatest = afpForBlock

        }else if(block && data.sendWithNoAfp && data.sendWithNoAfp.index === block.index){

            responseStructure.blocks.push(block)

        }else break

    }

    connection.sendUTF(JSON.stringify(responseStructure))

}




let returnLeaderRotationProofForSetOfLeaders = async(requestForLeaderRotationProof,connection)=>{

    /*

        [Info]:

            Route to return LRP(leader rotation proof)
    
            Returns the signature if requested height to skip >= than our own
    
            Otherwise - send the UPDATE message with FINALIZATION_PROOF 



        [Accept]:

        {

            poolPubKey,

            shard

            afpForFirstBlock:{

                prevBlockHash
                blockID,    => epochID:poolPubKey:0
                blockHash,
                proofs:{

                    pubkey0:signa0,         => SIG(prevBlockHash+blockID+blockHash+AT.EPOCH.HASH+"#"+AT.EPOCH.id)
                    ...
                    pubkeyN:signaN

                }

            }

            skipData:{

            index,
            hash,

            afp:{
                
                prevBlockHash,
                blockID,
                blockHash,

                proofs:{
                     
                    pubKey0:signa0,         => prevBlockHash+blockID+hash+AT.EPOCH.HASH+"#"+AT.EPOCH.id
                    ...
                        
                }

            }

        }

    }


[Response]:


[1] In case we have skip handler for this pool in SKIP_HANDLERS and if <skipData> in skip handler has <= index than in <skipData> from request we can response

    Also, bear in mind that we need to sign the hash of ASP for previous pool (field <previousAspHash>). We need this to verify the chains of ASPs by hashes not signatures.



    This will save us in case of a large number of ASPs that need to be checked
    
    Inserting an ASP hash for a pool that is 1 position earlier allows us to check only 1 signature and N hashes in the ASP chain
    
    Compare this with a case when we need to verify N signatures
    
    Obviously, the hash generation time and comparison with the <previousAspHash> field is cheaper than checking the aggregated signature (if considered within the O notation)
        

    Finally, we'll send this object as response

    {
        type:'OK',
        sig: ED25519_SIG('LEADER_ROTATION_PROOF:<poolPubKey>:<firstBlockHash>:<index>:<hash>:<epochFullID>')
    }


[2] In case we have bigger index in skip handler than in proposed <skipData> - response with 'UPDATE' message:

    {
        type:'UPDATE',
                        
        skipData:{

            index,
            hash,

            afp:{
                
                prevBlockHash,
                blockID,
                blockHash,

                proofs:{
                     
                    pubKey0:signa0,         => prevBlockHash+blockID+blockHash+AT.EPOCH.hash+"#"+AT.EPOCH.id
                    ...
                        
                }

            }

        }
                        
    }
    
    
    */


    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata){

        connection.sendUTF(JSON.stringify({err:'Epoch handler on AT is not ready'}))

        return
    }



    let overviewIsOk = requestForLeaderRotationProof && typeof requestForLeaderRotationProof === 'object' && typeof requestForLeaderRotationProof.skipData === 'object'
    
        overviewIsOk &&= epochHandler.leadersSequence[requestForLeaderRotationProof.shard] // make sure that shard exists

        overviewIsOk &&= currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(requestForLeaderRotationProof.shard)?.currentLeader > requestForLeaderRotationProof.hisIndexInLeadersSequence // we can't create LRP in case local version of shard leader is bigger/equal to requested


    if(overviewIsOk){
        
        let {index,hash,afp} = requestForLeaderRotationProof.skipData

        let localFinalizationStats = currentEpochMetadata.FINALIZATION_STATS.get(requestForLeaderRotationProof.poolPubKey)



        // We can't sign the LRP(leader rotation proof) in case requested height is lower than our local version. So, send 'UPDATE' message to requester
        if(localFinalizationStats && localFinalizationStats.index > index){

            let responseData = {

                route: 'get_leader_rotation_proof',

                voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,
                
                forPoolPubkey: requestForLeaderRotationProof.poolPubKey,

                type:'UPDATE',

                skipData:localFinalizationStats // {index,hash,afp:{prevBlockHash,blockID,blockHash,proofs:{quorumMember0:signa,...,quorumMemberN:signaN}}}

            }

            connection.sendUTF(JSON.stringify(responseData))

        }else{

           
            //________________________________________________ Verify the proposed AFP ________________________________________________
            
            
            let afpIsOk = false

            if(index > -1 && typeof afp.blockID === 'string'){

                // eslint-disable-next-line no-unused-vars
                let [_epochID,_blockCreator,indexOfBlockInAfp] = afp.blockID.split(':')

                if(typeof afp === 'object' && afp.blockHash === hash && index == indexOfBlockInAfp){

                    afpIsOk = await verifyAggregatedFinalizationProof(afp,epochHandler)

                }

            } else afpIsOk = true

            
            if(!afpIsOk){

                connection.sendUTF(JSON.stringify({err:'Wrong aggregated signature for skipIndex > -1'}))

                return

            }


            //_____________________ Verify the AFP for the first block to understand the hash of first block ______________________________

            // We need the hash of first block to fetch it over the network and extract the aggregated leader rotation proof for previous pool, take the hash of it and include to final signature
            

            let dataToSignForSkipProof, firstBlockAfpIsOk = false


            /*
            
                We also need the hash of ASP for previous pool

                In case index === -1 it's a signal that no block was created, so no ASPs for previous pool. Sign the nullhash(0123456789ab...)

                Otherwise - find block, compare it's hash with <requestForSkipProof.afpForFirstBlock.prevBlockHash>

                In case hashes match - extract the ASP for previous pool <epochHandler.leadersSequence[shard][indexOfThis-1]>, get the BLAKE3 hash and paste this hash to <dataToSignForSkipProof>
            
                [REMINDER]: Signature structure is ED25519_SIG('LEADER_ROTATION_PROOF:<poolPubKey>:<firstBlockHash>:<index>:<hash>:<epochFullID>')

            */

            if(index === -1){

                // If skipIndex is -1 then sign the hash '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'(null,default hash) as the hash of firstBlockHash
                
                dataToSignForSkipProof = `LEADER_ROTATION_PROOF:${requestForLeaderRotationProof.poolPubKey}:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:${index}:${'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'}:${epochFullID}`

                firstBlockAfpIsOk = true


            }else if(index >= 0 && typeof requestForLeaderRotationProof.afpForFirstBlock === 'object'){

                // Verify the aggregatedFinalizationProofForFirstBlock in case skipIndex > 0

                let blockIdOfFirstBlock = epochHandler.id+':'+requestForLeaderRotationProof.poolPubKey+':0'
            
                if(await verifyAggregatedFinalizationProof(requestForLeaderRotationProof.afpForFirstBlock,epochHandler) && requestForLeaderRotationProof.afpForFirstBlock.blockID === blockIdOfFirstBlock){

                    let block = await getBlock(epochHandler.id,requestForLeaderRotationProof.poolPubKey,0)

                    if(block && Block.genHash(block) === requestForLeaderRotationProof.afpForFirstBlock.blockHash){

                        let firstBlockHash = requestForLeaderRotationProof.afpForFirstBlock.blockHash

                        dataToSignForSkipProof = `LEADER_ROTATION_PROOF:${requestForLeaderRotationProof.poolPubKey}:${firstBlockHash}:${index}:${hash}:${epochFullID}`

                        firstBlockAfpIsOk = true                    
    
                    }

                }

            }
            
            // If proof is ok - generate LRP(leader rotation proof)

            if(firstBlockAfpIsOk){

                let skipMessage = {

                    route:'get_leader_rotation_proof',

                    voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,

                    forPoolPubkey: requestForLeaderRotationProof.poolPubKey,
                    
                    type:'OK',

                    sig:await signEd25519(dataToSignForSkipProof,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                }

                connection.sendUTF(JSON.stringify(skipMessage))
                
            } else connection.sendUTF(JSON.stringify({err:`Wrong signatures in <afpForFirstBlock>`}))
             
        }

    } else connection.sendUTF(JSON.stringify({err:'Wrong format'}))

}




let WebSocketServer = WS.server

let server = http.createServer({},(_,response)=>{

    response.writeHead(404)

    response.end()

})


server.listen(CONFIGURATION.NODE_LEVEL.WEBSOCKET_PORT,CONFIGURATION.NODE_LEVEL.WEBSOCKET_INTERFACE,()=>

    customLog(`Websocket server was activated on \u001b[38;5;168m${CONFIGURATION.NODE_LEVEL.WEBSOCKET_INTERFACE}:${CONFIGURATION.NODE_LEVEL.WEBSOCKET_PORT}`,logColors.CD)
    
)


let klyntarWebsocketServer = new WebSocketServer({
    
    httpServer: server,

    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false,

    maxReceivedMessageSize: 1024*1024*50 // 50 Mb

})




klyntarWebsocketServer.on('request',request=>{

    let connection = request.accept('echo-protocol', request.origin)

    connection.on('message',message=>{

        if (message.type === 'utf8') {

            let data = JSON.parse(message.utf8Data)

            if(data.route==='get_finalization_proof'){

                returnFinalizationProofForBlock(data,connection)

            }else if(data.route==='tmb'){

                // For TMB(Trust Me Bro) requests

                returnFinalizationProofBasedOnTmbProof(data,connection)
                

            }else if(data.route==='get_blocks'){

                returnBlocksRange(data,connection)

            }else if(data.route==='get_leader_rotation_proof'){

                returnLeaderRotationProofForSetOfLeaders(data,connection)

            }

            else{

                connection.close(1337,'No available route')

            }

        }
    
    })
    
    connection.on('close',()=>{})

    connection.on('error',()=>{})

})