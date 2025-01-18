import {getFirstBlockOnEpochOnSpecificShard, verifyAggregatedFinalizationProof} from '../common_functions/work_with_proofs.js'

import {getFromState, getUserAccountFromState, trackStateChange} from '../common_functions/state_interactions.js'

import {BLOCKCHAIN_DATABASES, WORKING_THREADS, GRACEFUL_STOP, GLOBAL_CACHES} from '../blockchain_preparation.js'

import {getAllKnownPeers, isMyCoreVersionOld, epochStillFresh, getRandomFromArray} from '../utils.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {customLog, blake3Hash, logColors, verifyEd25519Sync} from '../../../KLY_Utils/utils.js'

import {BLOCKCHAIN_GENESIS, CONFIGURATION} from '../../../klyn74r.js'

import {executeDelayedTransaction} from '../life/find_new_epoch.js'

import {KLY_EVM} from '../../../KLY_VirtualMachines/kly_evm/vm.js'

import {vtStatsLog} from '../common_functions/logging.js'

import {VERIFIERS} from './txs_verifiers.js'

import {Transaction} from '@ethereumjs/tx'

import Block from '../structures/block.js'

import fetch from 'node-fetch'

import WS from 'websocket'

import Web3 from 'web3'




let getBlockReward = () => {

    if(WORKING_THREADS.VERIFICATION_THREAD.MONTHLY_ALLOCATION_FOR_REWARDS === 0) return 0n

    else {

        let perEpochAllocation = WORKING_THREADS.VERIFICATION_THREAD.MONTHLY_ALLOCATION_FOR_REWARDS / 30

        let perShardAllocationPerEpoch = perEpochAllocation / WORKING_THREADS.VERIFICATION_THREAD.EPOCH.shardsRegistry.length
    
        let blocksPerShardPerEpoch = Math.floor(86400000/WORKING_THREADS.VERIFICATION_THREAD.NETWORK_PARAMETERS.BLOCK_TIME) 
    
        let blockReward = perShardAllocationPerEpoch / blocksPerShardPerEpoch

    
        return BigInt(Math.floor(blockReward))

    }

}







export let getBlock = async (epochIndex,blockCreator,index) => {

    let blockID = epochIndex+':'+blockCreator+':'+index

    // Try to find block locally

    let block = await BLOCKCHAIN_DATABASES.BLOCKS.get(blockID).catch(()=>null)


    if(!block){

        // First of all - try to find by pre-set URL

        const controller = new AbortController()

        setTimeout(() => controller.abort(), 2000)


        block = await fetch(CONFIGURATION.NODE_LEVEL.GET_BLOCKS_URL+`/block/`+blockID,{signal:controller.signal}).then(r=>r.json()).then(block=>{
                
            if(typeof block.extraData==='object' && typeof block.prevHash==='string' && typeof block.epoch==='string' && typeof block.sig==='string' && block.index === index && block.creator === blockCreator && Array.isArray(block.transactions)){

                BLOCKCHAIN_DATABASES.BLOCKS.put(blockID,block)
    
                return block
    
            } 
    
        }).catch(()=>null)

        
        if(!block){

            // Finally - request blocks from quorum members

            // Combine all nodes we know about and try to find block there
            
            let allKnownNodes = [...await getQuorumUrlsAndPubkeys(),...getAllKnownPeers()]
    
            for(let host of allKnownNodes){

                if(host===CONFIGURATION.NODE_LEVEL.MY_HOSTNAME) continue

                const controller = new AbortController()

                setTimeout(() => controller.abort(), 2000)
                
                let itsProbablyBlock = await fetch(host+`/block/`+blockID,{signal:controller.signal}).then(r=>r.json()).catch(()=>null)
                
                if(itsProbablyBlock){

                    let overviewIsOk =

                        typeof itsProbablyBlock.extraData==='object'
                        &&
                        typeof itsProbablyBlock.prevHash==='string'
                        &&
                        typeof itsProbablyBlock.epoch==='string'
                        &&
                        typeof itsProbablyBlock.sig==='string'
                        &&
                        itsProbablyBlock.index===index
                        &&
                        itsProbablyBlock.creator===blockCreator
                        &&
                        Array.isArray(itsProbablyBlock.transactions)
                

                    if(overviewIsOk){

                        BLOCKCHAIN_DATABASES.BLOCKS.put(blockID,itsProbablyBlock).catch(()=>{})
    
                        return itsProbablyBlock
    
                    }
    
                }
    
            }

        }

    }

    return block

}



export let getMultipleBlocks = async (epochHandler,blockCreator,fromIndex) => {

    // Try to ask 100 blocks batch - from <fromIndex> to <fromIndex+100>

    // 1. Try to find blocks locally

    let epochIndex = epochHandler.id

    let allKnownNodes = [...await getQuorumUrlsAndPubkeys(),...getAllKnownPeers()]

    let randomTargetURL = getRandomFromArray(allKnownNodes)


    const controller = new AbortController()

    setTimeout(() => controller.abort(), 7000)

    ///multiple_blocks/:epoch_index/:pool_id/:from_index


    let response = await fetch(randomTargetURL+`/multiple_blocks/${epochIndex}/${blockCreator}/${fromIndex}`).then(r=>r.json()).catch(()=>null)


    /*
        
        The response has the following structure:

        {
        
            blocks:[],
            afpForLatest:{}

        }
    
    */
    
    if(response && Array.isArray(response.blocks) && response.blocks[0]?.index === fromIndex){

        if(response.afpForLatest){

            // Make sure it's a chain

            let breaked = false

            for(let currentBlockIndexInArray = response.blocks.length-1 ; currentBlockIndexInArray >= 0 ; currentBlockIndexInArray--){

                let currentBlock = response.blocks[currentBlockIndexInArray]

                // Compare hashes - currentBlock.prevHash must be the same as Hash(blocks[index-1])

                let hashesAreEqual = true, indexesAreOk = true

                if(currentBlockIndexInArray>0){

                    hashesAreEqual = Block.genHash(response.blocks[currentBlockIndexInArray-1]) === currentBlock.prevHash

                    indexesAreOk = response.blocks[currentBlockIndexInArray-1].index+1 === response.blocks[currentBlockIndexInArray].index

                }

                // Now, check the structure of block

                let typeCheckIsOk = typeof currentBlock.extraData==='object' && typeof currentBlock.prevHash==='string' && typeof currentBlock.epoch==='string' && typeof currentBlock.sig==='string' && Array.isArray(currentBlock.transactions)
        
                let itsTheSameCreator = currentBlock.creator === blockCreator

                let overviewIsOk = typeCheckIsOk && itsTheSameCreator && hashesAreEqual && indexesAreOk

                // If it's the last block in array(and first in enumeration) - check the AFP for latest block

                if(overviewIsOk && currentBlockIndexInArray === response.blocks.length-1){

                    let blockIDThatMustBeInAfp = epochIndex+':'+blockCreator+':'+(currentBlock.index+1)

                    let prevBlockHashThatMustBeInAfp = Block.genHash(currentBlock)

                    overviewIsOk &&= blockIDThatMustBeInAfp === response.afpForLatest.blockID && prevBlockHashThatMustBeInAfp === response.afpForLatest.prevBlockHash && await verifyAggregatedFinalizationProof(response.afpForLatest,epochHandler)

                }
        
        
                if(!overviewIsOk){

                    breaked = true

                    break

                }

            }

            if(!breaked) return response.blocks

        } else {

            let maybeWeFindLatest = GLOBAL_CACHES.STUFF_CACHE.get('GET_FINAL_BLOCK:'+blockCreator)

            let lastBlockInArr = response.blocks[response.blocks.length-1]

            if(maybeWeFindLatest && lastBlockInArr.index > maybeWeFindLatest.index){

                response.blocks = response.blocks.filter(block=>block.index <= maybeWeFindLatest.index)

            }

            lastBlockInArr = response.blocks[response.blocks.length-1]

            if(lastBlockInArr.index === maybeWeFindLatest.index && maybeWeFindLatest.hash === Block.genHash(lastBlockInArr)){
    
                // Finally - make sure it's a chain in array

                let breaked = false

                for(let currentBlockIndexInArray = response.blocks.length-1 ; currentBlockIndexInArray >= 0 ; currentBlockIndexInArray--){

                    let currentBlock = response.blocks[currentBlockIndexInArray]

                    // Compare hashes - currentBlock.prevHash must be the same as Hash(blocks[index-1])

                    let hashesAreEqual = true, indexesAreOk = true

                    if(currentBlockIndexInArray>0){

                        hashesAreEqual = Block.genHash(response.blocks[currentBlockIndexInArray-1]) === currentBlock.prevHash

                        indexesAreOk = response.blocks[currentBlockIndexInArray-1].index+1 === response.blocks[currentBlockIndexInArray].index

                    }

                    // Now, check the structure of block

                    let typeCheckIsOk = typeof currentBlock.extraData==='object' && typeof currentBlock.prevHash==='string' && typeof currentBlock.epoch==='string' && typeof currentBlock.sig==='string' && Array.isArray(currentBlock.transactions)
        
                    let itsTheSameCreator = currentBlock.creator === blockCreator

                    let overviewIsOk = typeCheckIsOk && itsTheSameCreator && hashesAreEqual && indexesAreOk
        
        
                    if(!overviewIsOk){

                        breaked = true

                        break

                    }

                }

                if(!breaked) return response.blocks
    
            }

        }

    }

}




let checkAggregatedLeaderRotationProofValidity = async (pubKeyOfSomePreviousLeader,aggregatedLeaderRotationProof,epochFullID,epochHandler) => {

    /*

    Check the <agregatedLeaderRotationProof>(ALRP) signed by majority(2/3N+1) and aggregated
    
    ALRP structure is:
    
    {

        firstBlockHash,

        skipIndex,

        skipHash,

        proofs:{

            quorumMemberPubKey0:hisEd25519Signa,
            ...
            quorumMemberPubKeyN:hisEd25519Signa

        }

    }

        Check the signed string: `LEADER_ROTATION_PROOF:${poolPubKeyThatWasLeader}:${firstBlockHash}:${skipIndex}:${skipHash}:${epochFullID}`

        Also, if skipIndex === 0 - it's signal that firstBlockHash = skipHash

        If skipIndex === -1 - skipHash and firstBlockHash will be default - '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

    */

    
    if(aggregatedLeaderRotationProof && typeof aggregatedLeaderRotationProof === 'object'){    

        // Check the proofs
    
        let {firstBlockHash,skipIndex,skipHash,proofs} = aggregatedLeaderRotationProof

        let majority = getQuorumMajority(epochHandler)

        let dataThatShouldBeSigned = `LEADER_ROTATION_PROOF:${pubKeyOfSomePreviousLeader}:${firstBlockHash}:${skipIndex}:${skipHash}:${epochFullID}`
 
        let okSignatures = 0

        let unique = new Set()
    
    
        for(let [signerPubKey,signa] of Object.entries(proofs)){

            let isOk = verifyEd25519Sync(dataThatShouldBeSigned,signa,signerPubKey)

            if(isOk && epochHandler.quorum.includes(signerPubKey) && !unique.has(signerPubKey)){

                unique.add(signerPubKey)

                okSignatures++

            }
    
        }

        return okSignatures >= majority

    }

}




export let checkAlrpChainValidity = async (firstBlockInThisEpochByPool,leadersSequence,position,epochFullID,oldEpochHandler,dontCheckSignature) => {

    /*
    
        Here we need to check the integrity of chain of proofs to make sure that we can get the obvious variant of a valid chain to verify

        We need to check if <firstBlockInThisEpochByPool.extraData.aggregatedLeadersRotationProofs> contains all the ALRPs(aggregated leader rotation proofs)
        
            for pools from <position>(index of current pool in <leadersSequence>) to the first pool with non-zero ALRP

        
        So, we simply start the reverse enumeration in <leadersSequence> from <position> to the beginning of <leadersSequence> and extract the ALRPs

        Once we met the ALRP with index not equal to -1 (>=0) - we can stop enumeration and return true
    
    */


    let aggregatedLeaderesRotationProofsRef = firstBlockInThisEpochByPool.extraData?.aggregatedLeadersRotationProofs

    let infoAboutFinalBlocksInThisEpoch = {}


    if(aggregatedLeaderesRotationProofsRef && typeof aggregatedLeaderesRotationProofsRef === 'object'){


        let arrayForIteration = leadersSequence.slice(0,position).reverse() // take all the pools till position of current pool and reverse it because in optimistic case we just need to find the closest pool to us with non-zero ALRP 

        let arrayIndexer = 0

        let bumpedWithPoolWhoCreatedAtLeastOneBlock = false


        for(let poolPubKey of arrayForIteration){

            let alrpForThisPool = aggregatedLeaderesRotationProofsRef[poolPubKey]
    
            if(alrpForThisPool && typeof alrpForThisPool === 'object'){

                let signaIsOk = dontCheckSignature || await checkAggregatedLeaderRotationProofValidity(poolPubKey,alrpForThisPool,epochFullID,oldEpochHandler)

                if(signaIsOk){

                    infoAboutFinalBlocksInThisEpoch[poolPubKey] = {
                        
                        index:alrpForThisPool.skipIndex,
                        
                        hash:alrpForThisPool.skipHash,
                        
                        firstBlockHash:alrpForThisPool.firstBlockHash
                    
                    }

                    arrayIndexer++

                    if(alrpForThisPool.skipIndex>=0){

                        bumpedWithPoolWhoCreatedAtLeastOneBlock = true

                        break

                    }

                }else return {isOK:false}

            } else return {isOK:false}
    
        }

        // Returns true only in case if we checked ALRPs for all the previous pools in leaders sequence or untill the pool who created at least one block
        if(arrayIndexer === position || bumpedWithPoolWhoCreatedAtLeastOneBlock){
            
            return {isOK:true,infoAboutFinalBlocksInThisEpoch}

        } else return {isOK:false}
    
    } else return {isOK:false}

}





let findInfoAboutLastBlocksByPreviousShardsLeaders = async (vtEpochHandler,shardID,aefp) => {

    let emptyTemplate = {}

    let vtEpochIndex = vtEpochHandler.id

    let oldLeadersSequenceForShard = vtEpochHandler.leadersSequence[shardID]
    
    if(!WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS) WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS = {}

    let infoAboutFinalBlocksByPool = new Map() // poolID => {poolThatWasLeader_A:ALRP,poolThatWasLeader_B:ALRP,...poolThatWasLeader_X:ALRP}
        

    // Start the cycle in reverse order from <aefp.lastLeader>

    let lastLeaderPoolPubKey = oldLeadersSequenceForShard[aefp.lastLeader]

    emptyTemplate[lastLeaderPoolPubKey] = {
        
        index:aefp.lastIndex,
        
        hash:aefp.lastHash

    }

    let infoAboutLastBlocksByPreviousPool

    for(let position = aefp.lastLeader; position > 0; position--){

        let poolPubKey = oldLeadersSequenceForShard[position]

        // In case we know that pool on this position created 0 block - don't return from function and continue the cycle iterations

        if(infoAboutLastBlocksByPreviousPool && infoAboutLastBlocksByPreviousPool[poolPubKey].index === -1){

            continue

        } else {

            // Get the first block of this epoch from VERIFICATION_STATS_PER_POOL

            let firstBlockInThisEpochByPool = await getBlock(vtEpochIndex,poolPubKey,0)

            if(!firstBlockInThisEpochByPool) return

            // In this block we should have ALRPs for all the previous pools

            let {isOK,infoAboutFinalBlocksInThisEpoch} = await checkAlrpChainValidity(
            
                firstBlockInThisEpochByPool,oldLeadersSequenceForShard,position,null,null,true
            
            )


            if(isOK){

                infoAboutFinalBlocksByPool.set(poolPubKey,infoAboutFinalBlocksInThisEpoch) // filteredInfoForVerificationThread = {Pool0:{index,hash},Pool1:{index,hash},...PoolN:{index,hash}}

                infoAboutLastBlocksByPreviousPool = infoAboutFinalBlocksInThisEpoch

            }

        }

    }

    for(let poolPubKey of oldLeadersSequenceForShard){

        if(infoAboutFinalBlocksByPool.has(poolPubKey)){

            let metadataForReassignment = infoAboutFinalBlocksByPool.get(poolPubKey)

            for(let [reassignedPoolPubKey,alrpData] of Object.entries(metadataForReassignment)){

                if(!emptyTemplate[reassignedPoolPubKey]) emptyTemplate[reassignedPoolPubKey] = alrpData

            }

        }

    }

    WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS[shardID] = emptyTemplate


        /*
        
        
        After execution of this function we have:

        [0] WORKING_THREADS.VERIFICATION_THREAD.EPOCH.leadersSequence with structure:
        
        {
            shard_0:[Pool0A,Pool1A,....,PoolNA],
            
            shard_1:[Pool0B,Pool1B,....,PoolNB]
        
            ...
        }

        Using this chains we'll finish the verification process

        [1] WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS with structure:

        {
            shard_0:{

                Pool0A:{index,hash},
                Pool1A:{index,hash},
                ....,
                PoolNA:{index,hash}

            },
            
            shard_1:{

                Pool0B:{index,hash},
                Pool1B:{index,hash},
                ....,
                PoolNB:{index,hash}

            }

            ...
        
        }

        ___________________________________ So ___________________________________

        Using the order in EPOCH.leadersSequence finish the verification based on index:hash pairs in INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS
        
        
        */
   

}





let setUpNewEpochForVerificationThread = async vtEpochHandler => {
 

    let vtEpochFullID = vtEpochHandler.hash+"#"+vtEpochHandler.id

    let vtEpochOldIndex = vtEpochHandler.id

    let nextVtEpochIndex = vtEpochOldIndex + 1

    // Stuff related for next epoch

    let nextEpochHash = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HASH:${nextVtEpochIndex}`).catch(()=>{})

    let nextEpochQuorum = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_QUORUM:${nextVtEpochIndex}`).catch(()=>{})

    let nextEpochLeadersSequences = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_LEADERS_SEQUENCES:${nextVtEpochIndex}`).catch(()=>{})


    // Get the epoch edge transactions that we need to execute

    let delayedTransactions = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`DELAYED_TRANSACTIONS:${vtEpochFullID}`).catch(()=>null)

    
    if(nextEpochHash && nextEpochQuorum && nextEpochLeadersSequences && delayedTransactions){

        GLOBAL_CACHES.STATE_CHANGES_CACHE = { put: {}, delete: {}, update: {} }

        GLOBAL_CACHES.STATE_CACHE.clear()
        
        
        let atomicBatch = BLOCKCHAIN_DATABASES.STATE.batch()


        //____________________________________ START TO EXECUTE EPOCH EDGE TRANSACTIONS ____________________________________


        for(let delayedTransaction of delayedTransactions){

            await executeDelayedTransaction('VERIFICATION_THREAD',delayedTransaction).catch(()=>{})
    
        }

        // Now delete the delayed transactions array

        // let overPreviousEpochHandler = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HANDLER:${vtEpochHandler.id-2}`).catch(()=>null)

        // if(overPreviousEpochHandler) {

        //     for(let shardID of overPreviousEpochHandler.shardsRegistry){

        //         atomicBatch.del(`DELAYED_TRANSACTIONS:${vtEpochHandler.id}:${shardID}`)

        //     }

        // }
    

        // Nullify values for the upcoming epoch

        WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL = {}
        
        for(let poolPubKey of WORKING_THREADS.VERIFICATION_THREAD.EPOCH.poolsRegistry){

            WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[poolPubKey] = {
                
                index:-1,
                
                hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
            
            }

            // Close connection in case we have
            
            let tunnelHandler = GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolPubKey)

            if(tunnelHandler) tunnelHandler.connection.close()

        }

        // Finally - delete the AEFP metadata with info about hights and hashes per shard

        delete WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS

        // Delete the useless temporary info from previous epoch about indexes/hashes to verify on shards
        
        delete WORKING_THREADS.VERIFICATION_THREAD.TEMP_INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS[vtEpochFullID]


        GLOBAL_CACHES.STUFF_CACHE.delete('SHARDS_READY_TO_NEW_EPOCH')


        customLog(`\u001b[38;5;154mDelayed transactions were executed for epoch \u001b[38;5;93m${WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id} ### ${WORKING_THREADS.VERIFICATION_THREAD.EPOCH.hash} (VT)\u001b[0m`,logColors.GREEN)


        // Store the stats during verification thread work in this epoch
        
        await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`VT_STATS_PER_EPOCH:${vtEpochHandler.id}`,WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH).catch(()=>{})


        // Finally - set the new index, hash, timestamp, quorum and assign validators for shards for next epoch

        WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id = vtEpochHandler.id+1

        WORKING_THREADS.VERIFICATION_THREAD.EPOCH.hash = nextEpochHash

        WORKING_THREADS.VERIFICATION_THREAD.EPOCH.startTimestamp += WORKING_THREADS.VERIFICATION_THREAD.NETWORK_PARAMETERS.EPOCH_TIME

        WORKING_THREADS.VERIFICATION_THREAD.EPOCH.quorum = nextEpochQuorum
                
        WORKING_THREADS.VERIFICATION_THREAD.EPOCH.leadersSequence = nextEpochLeadersSequences

        
        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH = {
            
            totalBlocksNumber:0, totalTxsNumber:0, successfulTxsNumber:0,

            newUserAccountsNumber:{
                native:0,
                evm:0
            },

            newSmartContractsNumber:{
                native:0,
                evm:0
            },

            rwxContracts:{
                total:0,
                closed:0
            },

            totalKlyStaked:0,
            totalUnoStaked:0,

            coinsAllocations:{ mining:0 }
        
        }

        // Unlock the coins and distribute to appropriate accounts

        if(BLOCKCHAIN_GENESIS.UNLOCKS){

            for(let [recipient,unlocksTable] of Object.entries(BLOCKCHAIN_GENESIS.UNLOCKS)){

                if(unlocksTable[`${nextVtEpochIndex}`]){

                    if(recipient === 'mining') {

                        WORKING_THREADS.VERIFICATION_THREAD.MONTHLY_ALLOCATION_FOR_REWARDS = unlocksTable[`${nextVtEpochIndex}`]

                    }

                    if(recipient.startsWith('0x') && recipient.length === 42){
        
                        let unlockAmount = unlocksTable[`${nextVtEpochIndex}`]
        
                        let amountInWei = BigInt(unlockAmount) * (BigInt(10) ** BigInt(18))

                        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.coinsAllocations[recipient] = unlockAmount
        
                        let recipientAccount = await KLY_EVM.getAccount(recipient)
        
                        recipientAccount.balance += amountInWei
        
                        await KLY_EVM.updateAccount(recipient,recipientAccount)
        
                    }    

                }
    
            }    

        }

        // Update the KLY-EVM state root after allocations

        WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_STATE_ROOT = await KLY_EVM.getStateRoot()

        
        // Commit the changes of state using atomic batch

        GLOBAL_CACHES.STATE_CACHE.forEach(
            
            (value,storageCellID) => atomicBatch.put(storageCellID,value)
            
        )

        atomicBatch.put('VT',WORKING_THREADS.VERIFICATION_THREAD)

        await atomicBatch.write()

        // Clear the cache for stuff

        GLOBAL_CACHES.STUFF_CACHE.clear()


        // Now we can delete useless data from EPOCH_DATA db

        await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`EPOCH_HASH:${nextVtEpochIndex}`).catch(()=>{})

        await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`EPOCH_QUORUM:${nextVtEpochIndex}`).catch(()=>{})

        await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`EPOCH_LEADERS_SEQUENCES:${nextVtEpochIndex}`).catch(()=>{})

        // await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`DELAYED_TRANSACTIONS:${vtEpochFullID}`).catch(()=>{}) // decided to not to delete for API explicit information

        await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`FIRST_BLOCKS_IN_NEXT_EPOCH_PER_SHARD:${vtEpochOldIndex-1}`).catch(()=>{})



        customLog(`Epoch on verification thread was updated => \x1b[34;1m${WORKING_THREADS.VERIFICATION_THREAD.EPOCH.hash}#${WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id}`,logColors.GREEN)
        

        //_______________________Check the version required for the next epoch________________________

        if(isMyCoreVersionOld('VERIFICATION_THREAD')){

            customLog(`New version detected on VERIFICATION_THREAD. Please, upgrade your node software`,logColors.YELLOW)
        
            // Stop the node to update the software
            GRACEFUL_STOP()
        
        }

    }

}




let tryToFinishCurrentEpochOnVerificationThread = async vtEpochHandler => {

    let vtEpochIndex = vtEpochHandler.id

    let nextEpochIndex = vtEpochIndex+1

    let nextEpochHash = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HASH:${nextEpochIndex}`).catch(()=>{})

    let nextEpochQuorum = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_QUORUM:${nextEpochIndex}`).catch(()=>{})

    let nextEpochLeadersSequences = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_LEADERS_SEQUENCES:${nextEpochIndex}`).catch(()=>{})

    let nextEpochHandlerTemplate = {

        id:nextEpochIndex,
        
        hash:nextEpochHash,

        quorum:nextEpochQuorum,

        leadersSequence:nextEpochLeadersSequences

    }


    if(nextEpochHash && nextEpochQuorum && nextEpochLeadersSequences){

        let handlerWithFirstBlocksPerShardOnNextEpoch = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`FIRST_BLOCKS_IN_NEXT_EPOCH_PER_SHARD:${vtEpochIndex}`).catch(()=>false) || {} // {shardID:{firstBlockCreator,firstBlockHash}} 

        let totalNumberOfShards = 0, totalNumberOfShardsReadyForMove = 0

        // Find the first blocks for epoch X+1
        
        for(let shardID of Object.keys(nextEpochLeadersSequences)){

            totalNumberOfShards++

            if(!handlerWithFirstBlocksPerShardOnNextEpoch[shardID]) handlerWithFirstBlocksPerShardOnNextEpoch[shardID]={}

            if(!handlerWithFirstBlocksPerShardOnNextEpoch[shardID].firstBlockCreator){

                let findResult = await getFirstBlockOnEpochOnSpecificShard('VERIFICATION_THREAD',nextEpochHandlerTemplate,shardID,getBlock)

                if(findResult){

                    handlerWithFirstBlocksPerShardOnNextEpoch[shardID].firstBlockCreator = findResult.firstBlockCreator

                    handlerWithFirstBlocksPerShardOnNextEpoch[shardID].firstBlockHash = findResult.firstBlockHash

                }

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`FIRST_BLOCKS_IN_NEXT_EPOCH_PER_SHARD:${vtEpochIndex}`,handlerWithFirstBlocksPerShardOnNextEpoch).catch(()=>{})

            }

            //____________After we get the first blocks for epoch X+1 - get the AEFP from it and build the data for VT to finish epoch X____________

            let firstBlockOnThisShardInThisEpoch = await getBlock(nextEpochIndex,handlerWithFirstBlocksPerShardOnNextEpoch[shardID].firstBlockCreator,0)

            if(firstBlockOnThisShardInThisEpoch && Block.genHash(firstBlockOnThisShardInThisEpoch) === handlerWithFirstBlocksPerShardOnNextEpoch[shardID].firstBlockHash){

                handlerWithFirstBlocksPerShardOnNextEpoch[shardID].aefp = firstBlockOnThisShardInThisEpoch.extraData.aefpForPreviousEpoch

            }

            if(handlerWithFirstBlocksPerShardOnNextEpoch[shardID].aefp) totalNumberOfShardsReadyForMove++

        }


        if(totalNumberOfShards === totalNumberOfShardsReadyForMove){

            // Create empty template

            if(!WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS) WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS = {}

            for(let shardID of Object.keys(nextEpochLeadersSequences)){

                // Now, using this AEFP (especially fields lastLeader,lastIndex,lastHash,firstBlockHash) build metadata to finish VT thread for this epoch and shard
                
                if(!WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS[shardID]) await findInfoAboutLastBlocksByPreviousShardsLeaders(vtEpochHandler,shardID,handlerWithFirstBlocksPerShardOnNextEpoch[shardID].aefp)

            }

        }

    }

}




let openTunnelToFetchBlocksForPool = async (poolPubKeyToOpenConnectionWith,epochHandler) => {

    /* 
    
        Open connection with websocket endpoint which was set by target pool

    */


    let endpointURL = CONFIGURATION.NODE_LEVEL?.BLOCKS_TUNNELS?.[poolPubKeyToOpenConnectionWith]

    if(!endpointURL){

        let poolStorage = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+poolPubKeyToOpenConnectionWith+'(POOL)_STORAGE_POOL')
        
        if(poolStorage) endpointURL = poolStorage.wssPoolURL
    
    }



    if(endpointURL){

        // Open tunnel, set listeners for events, add to cache and fetch blocks portions time by time. 

        // GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolToVerifyRightNow)

        await new Promise(resolve=>{

            let WebSocketClient = WS.client
    
            let client = new WebSocketClient({

                maxReceivedMessageSize: 1024 * 1024 * 500

            })

            client.connect(endpointURL,'echo-protocol')


            client.on('connect',connection=>{

                connection.on('message',async message=>{

                    if(message.type === 'utf8'){

                        if(GLOBAL_CACHES.STUFF_CACHE.has('TUNNEL_REQUEST_ACCEPTED:'+poolPubKeyToOpenConnectionWith)) return

                        GLOBAL_CACHES.STUFF_CACHE.set('TUNNEL_REQUEST_ACCEPTED:'+poolPubKeyToOpenConnectionWith,true)
                        
                        let handler = GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolPubKeyToOpenConnectionWith) // {url,hasUntilHeight,connection,cache(blockID=>block)}

                        let parsedData = JSON.parse(message.utf8Data) // {blocks:[],afpForLatest}

                        let limit = 500 // max 500 blocks per request. Change it if you neeed

                        let bothNotNull = parsedData && parsedData.afpForLatest

                        if(handler && bothNotNull && typeof parsedData === 'object' && typeof parsedData.afpForLatest === 'object' && Array.isArray(parsedData.blocks) && parsedData.blocks.length <= limit && parsedData.blocks[0]?.index === handler.hasUntilHeight+1){

                            let lastBlockInfo = GLOBAL_CACHES.STUFF_CACHE.get('GET_FINAL_BLOCK:'+poolPubKeyToOpenConnectionWith)

                            if(lastBlockInfo && handler.hasUntilHeight+1 === lastBlockInfo.index){

                                let lastBlockThatWeGet = parsedData.blocks[parsedData.blocks.length-1]

                                if(lastBlockThatWeGet){

                                    let blockHash = Block.genHash(lastBlockThatWeGet)

                                    if(blockHash === lastBlockInfo.hash && lastBlockInfo.index === lastBlockThatWeGet.index){

                                        let blockID = epochHandler.id+':'+poolPubKeyToOpenConnectionWith+':'+lastBlockThatWeGet.index

                                        handler.cache.set(blockID,lastBlockThatWeGet)
                                        
                                        handler.hasUntilHeight = lastBlockThatWeGet.index
                                        
                                        GLOBAL_CACHES.STUFF_CACHE.delete('GET_FINAL_BLOCK:'+poolPubKeyToOpenConnectionWith)

                                    }

                                }

                            }else{


                                // Make sure it's a chain

                                let breaked = false

                                
                                /*
                        
                                    Run the cycle to verify the range:

                                    Start from blocks[blocks.length-1] to 0. The first block in .blocks array must be +1 than we have locally

                                    Make sure it's a valid chain(Block_N.prevHash=Hash(Block_N-1))

                                    Finally, check the AFP for latest block - this way we verify the whole segment using O(1) complexity
                        
                                */

                                for(let currentBlockIndexInArray = parsedData.blocks.length-1 ; currentBlockIndexInArray >= 0 ; currentBlockIndexInArray--){

                                    let currentBlock = parsedData.blocks[currentBlockIndexInArray]

                                    // Compare hashes - currentBlock.prevHash must be the same as Hash(blocks[index-1])

                                    let hashesAreEqual = true, indexesAreOk = true

                                    if(currentBlockIndexInArray>0){

                                        hashesAreEqual = Block.genHash(parsedData.blocks[currentBlockIndexInArray-1]) === currentBlock.prevHash

                                        indexesAreOk = parsedData.blocks[currentBlockIndexInArray-1].index+1 === parsedData.blocks[currentBlockIndexInArray].index

                                    }

                                    // Now, check the structure of block

                                    let typeCheckIsOk = typeof currentBlock.extraData==='object' && typeof currentBlock.prevHash==='string' && typeof currentBlock.epoch==='string' && typeof currentBlock.sig==='string' && Array.isArray(currentBlock.transactions)
                                
                                    let itsTheSameCreator = currentBlock.creator === poolPubKeyToOpenConnectionWith

                                    let overviewIsOk = typeCheckIsOk && itsTheSameCreator && hashesAreEqual && indexesAreOk

                                    // If it's the last block in array(and first in enumeration) - check the AFP for latest block

                                    if(overviewIsOk && currentBlockIndexInArray === parsedData.blocks.length-1){

                                        let blockIDThatMustBeInAfp = epochHandler.id+':'+poolPubKeyToOpenConnectionWith+':'+(currentBlock.index+1)

                                        let prevBlockHashThatMustBeInAfp = Block.genHash(currentBlock)

                                        overviewIsOk &&= blockIDThatMustBeInAfp === parsedData.afpForLatest.blockID && prevBlockHashThatMustBeInAfp === parsedData.afpForLatest.prevBlockHash && await verifyAggregatedFinalizationProof(parsedData.afpForLatest,epochHandler)

                                    }
                                
                                
                                    if(!overviewIsOk){

                                        breaked = true

                                        break

                                    }

                                }

                            
                                // If we have size - add blocks here. The reserve is 5000 blocks per shard

                                if(handler.cache.size+parsedData.blocks.length<=5000 && !breaked){

                                    // Add the blocks to mapping

                                    parsedData.blocks.forEach(block=>{

                                        let blockID = epochHandler.id+':'+poolPubKeyToOpenConnectionWith+':'+block.index

                                        handler.cache.set(blockID,block)

                                    })

                                    handler.hasUntilHeight = parsedData.blocks[parsedData.blocks.length-1].index
                                
                                }

                            }
                            
                        }

                        GLOBAL_CACHES.STUFF_CACHE.delete('TUNNEL_REQUEST_ACCEPTED:'+poolPubKeyToOpenConnectionWith)
                    
                    }        

                })

                // Start to ask for blocks time by time
                
                let stopHandler = setInterval(()=>{

                    if(!GLOBAL_CACHES.STUFF_CACHE.has('TUNNEL_REQUEST_ACCEPTED:'+poolPubKeyToOpenConnectionWith)){

                        let handler = GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolPubKeyToOpenConnectionWith) // {url,hasUntilHeight,connection,cache(blockID=>block)}

                        let lastBlockInfo = GLOBAL_CACHES.STUFF_CACHE.get('GET_FINAL_BLOCK:'+poolPubKeyToOpenConnectionWith)

                        if(handler){
    
                            let messageToSend = {
    
                                route:'get_blocks',

                                pool:poolPubKeyToOpenConnectionWith,
        
                                hasUntilHeight:handler.hasUntilHeight,

                                epochIndex:epochHandler.id,

                                sendWithNoAfp:{}
        
                            }

                            if(lastBlockInfo && handler.hasUntilHeight+1 === lastBlockInfo.index) messageToSend.sendWithNoAfp = lastBlockInfo
        
                            connection.sendUTF(JSON.stringify(messageToSend))
    
                        }    

                    }

                },2000)

                connection.on('close',()=>{

                    GLOBAL_CACHES.STUFF_CACHE.delete('TUNNEL:'+poolPubKeyToOpenConnectionWith)

                    clearInterval(stopHandler)

                })
                      
                connection.on('error',()=>{

                    GLOBAL_CACHES.STUFF_CACHE.delete('TUNNEL:'+poolPubKeyToOpenConnectionWith)

                    clearInterval(stopHandler)

                })

                let hasUntilHeight = WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[poolPubKeyToOpenConnectionWith].index

                GLOBAL_CACHES.STUFF_CACHE.set('TUNNEL:'+poolPubKeyToOpenConnectionWith,{url:endpointURL,hasUntilHeight,connection,cache:new Map()}) // mapping <cache> has the structure blockID => block

            })

            resolve()

        })                
 
    }

}




let checkConnectionWithPool = async(poolToCheckConnectionWith,vtEpochHandler) => {

    if(!GLOBAL_CACHES.STUFF_CACHE.has('TUNNEL:'+poolToCheckConnectionWith) && !GLOBAL_CACHES.STUFF_CACHE.has('TUNNEL_OPENING_PROCESS:'+poolToCheckConnectionWith)){

        await openTunnelToFetchBlocksForPool(poolToCheckConnectionWith,vtEpochHandler)

        GLOBAL_CACHES.STUFF_CACHE.set('TUNNEL_OPENING_PROCESS:'+poolToCheckConnectionWith,true)

        setTimeout(()=>{

            GLOBAL_CACHES.STUFF_CACHE.delete('TUNNEL_OPENING_PROCESS:'+poolToCheckConnectionWith)

        },5000)

        
    }else if(GLOBAL_CACHES.STUFF_CACHE.has('CHANGE_TUNNEL:'+poolToCheckConnectionWith)){

        // Check if endpoint wasn't changed dynamically(via priority changes in configs/storage)

        let tunnelHandler = GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolToCheckConnectionWith) // {url,hasUntilHeight,connection,cache(blockID=>block)}

        tunnelHandler.connection.close()

        GLOBAL_CACHES.STUFF_CACHE.delete('CHANGE_TUNNEL:'+poolToCheckConnectionWith)

        await openTunnelToFetchBlocksForPool(poolToCheckConnectionWith,vtEpochHandler)
        
        GLOBAL_CACHES.STUFF_CACHE.set('TUNNEL_OPENING_PROCESS:'+poolToCheckConnectionWith,true)

        setTimeout(()=>{

            GLOBAL_CACHES.STUFF_CACHE.delete('TUNNEL_OPENING_PROCESS:'+poolToCheckConnectionWith)

        },5000)

    }

}




let getTouchedAccountsByEvmTx = serializedEVMTx => {

    let serializedEVMTxWithout0x = serializedEVMTx.slice(2) // delete 0x
        
    let txDeserialized = Transaction.fromSerializedTx(Buffer.from(serializedEVMTxWithout0x,'hex'))
    
    // Try to parse tx.data - maybe it contains additional data(for parallelization, AAv2, etc.), not only calldata
    
    let touchedAccounts = null
    
    try {
    
        let parsedDataField = JSON.parse(txDeserialized.data.toString())

        touchedAccounts = parsedDataField.touchedAccounts
            
    } catch {

        touchedAccounts = null

    }

    return touchedAccounts

}




let getPreparedTxsForParallelization = txsArray => {


    let numberOfAccountTouchesPerAccount = new Map() // account => number of touch based on all txs in current block

    let txIdToOrderMapping = {} // txid => transaction order in block

    let txCounter = 0


    for(let transaction of txsArray){

        txIdToOrderMapping[transaction.sig] = txCounter

        txCounter++

        let possibleTouchedAccounts = transaction?.payload?.touchedAccounts


        if(Array.isArray(possibleTouchedAccounts)){

            for(let touchedAccount of possibleTouchedAccounts){

                if(numberOfAccountTouchesPerAccount.has(touchedAccount)){
    
                    let number = numberOfAccountTouchesPerAccount.get(touchedAccount)
    
                    numberOfAccountTouchesPerAccount.set(touchedAccount,number+1)
    
                } else numberOfAccountTouchesPerAccount.set(touchedAccount,1) 
    
            }

        }

    }

    //____________ Now, all the txs where all accounts in <touchedAccount> has 1 point can be executed independently ____________

    let independentTransactions = new Set()

    let syncTransactions = new Set()

    for(let transaction of txsArray){

        let possibleTouchedAccounts = transaction?.payload?.touchedAccounts

        if(Array.isArray(possibleTouchedAccounts)){

            let eachTouchedAccountInTxHasOnePoint = possibleTouchedAccounts.every(account => numberOfAccountTouchesPerAccount.get(account) === 1)

            if(eachTouchedAccountInTxHasOnePoint){

                independentTransactions.add(transaction)

            } else syncTransactions.add(transaction)

        } else syncTransactions.add(transaction)

    }

    //____________ To increase speedup - start another iteration. Create independent groups where one account has >1 touched and all the rest has 1 touch ____________

    let independentGroups = new Map() // account => txs


    for(let transaction of syncTransactions){

        // Now iterate over array of touched accounts

        let numberOfAccountsTouchedMoreThanOnce = 0

        let accountThatChangesMoreThanOnce


        let possibleTouchedAccounts = transaction?.payload?.touchedAccounts


        if(Array.isArray(possibleTouchedAccounts)){

            for(let accountID of possibleTouchedAccounts){

                if(numberOfAccountTouchesPerAccount.get(accountID) > 1){
    
                    accountThatChangesMoreThanOnce = accountID
                
                    numberOfAccountsTouchedMoreThanOnce++
    
                }
    
                if(numberOfAccountsTouchedMoreThanOnce > 1) break
    
            }
    
            if(numberOfAccountsTouchedMoreThanOnce === 1){
    
                let threadForThisGroup = independentGroups.get(accountThatChangesMoreThanOnce) || []
    
                threadForThisGroup.push(transaction)
    
                syncTransactions.delete(transaction)
    
                independentGroups.set(accountThatChangesMoreThanOnce,threadForThisGroup)
    
            }    

        }

    }


    return {independentTransactions, independentGroups, syncTransactions, txIdToOrderMapping}


}




export let startVerificationThread=async()=>{


    let currentEpochIsFresh = epochStillFresh(WORKING_THREADS.VERIFICATION_THREAD)

    let vtEpochHandler = WORKING_THREADS.VERIFICATION_THREAD.EPOCH

    let vtEpochFullID = vtEpochHandler.hash+"#"+vtEpochHandler.id

    let vtEpochIndex = vtEpochHandler.id


    let shardsIdentifiers = vtEpochHandler.shardsRegistry

    let currentShardToCheck = shardsIdentifiers[0]

    

    let tempInfoAboutFinalBlocksByPreviousPoolsOnShard = WORKING_THREADS.VERIFICATION_THREAD.TEMP_INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS[vtEpochFullID]?.[currentShardToCheck] // {currentLeader,currentToVerify,infoAboutFinalBlocksInThisEpoch:{poolPubKey:{index,hash}}}


    if(WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS?.[currentShardToCheck]){
        
        
        /*
        
            In case we have .INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS - it's a signal that the new epoch on APPROVEMENT_THREAD has started
            In this case, in function TRY_TO_CHANGE_EPOCH_FOR_VERIFICATION_THREAD we update the epoch and add the .INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS which has the structure

            {
                shard:{

                    pool0:{index,hash},
                    ...
                    poolN:{index,hash}

                }
            }

            We just need to go through the .INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS[currentShardToCheck] and start the cycle over vtEpochHandler.leadersSequence[currentShardToCheck] and verify all the blocks

        */


        if(!GLOBAL_CACHES.STUFF_CACHE.has('SHARDS_READY_TO_NEW_EPOCH')) GLOBAL_CACHES.STUFF_CACHE.set('SHARDS_READY_TO_NEW_EPOCH',new Map())

        if(!GLOBAL_CACHES.STUFF_CACHE.has('CURRENT_TO_FINISH:'+currentShardToCheck)) GLOBAL_CACHES.STUFF_CACHE.set('CURRENT_TO_FINISH:'+currentShardToCheck,{indexOfCurrentPoolToVerify:0})


        let shardsReadyToNewEpoch = GLOBAL_CACHES.STUFF_CACHE.get('SHARDS_READY_TO_NEW_EPOCH') // Mapping(shardID=>boolean)
        
        let handlerWithIndexToVerify = GLOBAL_CACHES.STUFF_CACHE.get('CURRENT_TO_FINISH:'+currentShardToCheck) // {indexOfCurrentPoolToVerify:int}

        let infoFromAefpAboutLastBlocksByPoolsOnShards = WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS[currentShardToCheck] // {pool:{index,hash},...}

        let localVtMetadataForPool, metadataFromAefpForThisPool



        // eslint-disable-next-line no-constant-condition
        while(true){            

            let poolPubKey = vtEpochHandler.leadersSequence[currentShardToCheck][handlerWithIndexToVerify.indexOfCurrentPoolToVerify]

            localVtMetadataForPool = WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[poolPubKey]

            metadataFromAefpForThisPool = infoFromAefpAboutLastBlocksByPoolsOnShards[poolPubKey] || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'}


            let weFinishedToVerifyPool = localVtMetadataForPool.index === metadataFromAefpForThisPool.index


            if(weFinishedToVerifyPool){

                let itsTheLastPoolInSequence = vtEpochHandler.leadersSequence[currentShardToCheck].length === handlerWithIndexToVerify.indexOfCurrentPoolToVerify + 1


                if(itsTheLastPoolInSequence) {

                    GLOBAL_CACHES.STUFF_CACHE.delete('CURRENT_TO_FINISH:'+currentShardToCheck)

                    break

                }

                else {            

                    handlerWithIndexToVerify.indexOfCurrentPoolToVerify++

                    continue

                }

            }


            await checkConnectionWithPool(poolPubKey,vtEpochHandler)


            let tunnelHandler = GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolPubKey) // {url,hasUntilHeight,connection,cache(blockID=>block)}

            GLOBAL_CACHES.STUFF_CACHE.set('GET_FINAL_BLOCK:'+poolPubKey,infoFromAefpAboutLastBlocksByPoolsOnShards[poolPubKey])

            if(tunnelHandler){
            
                let biggestHeightInCache = tunnelHandler.hasUntilHeight

                let stepsForWhile = biggestHeightInCache - localVtMetadataForPool.index

                if(stepsForWhile <= 0){

                    // Break the outer <while> cycle to try to find blocks & finish this epoch on another shard

                    break

                }
                
                // Start the cycle to process all the blocks
                while(stepsForWhile > 0){

                    // Move to next one
                    if(metadataFromAefpForThisPool.index === localVtMetadataForPool.index) break
        

                    let blockIdToGet = vtEpochIndex+':'+poolPubKey+':'+(localVtMetadataForPool.index+1)
        
                    let block = tunnelHandler.cache.get(blockIdToGet)
        
        
                    if(block){
        
                        await verifyBlock(block,currentShardToCheck)

                        tunnelHandler.cache.delete(blockIdToGet)

                    }
                    
                    stepsForWhile--
            
                }

            } else {

                let batchOfBlocksFromAnotherSource = await getMultipleBlocks(vtEpochHandler,poolPubKey,localVtMetadataForPool.index+1)
    
                if(batchOfBlocksFromAnotherSource){
    
                    for(let block of batchOfBlocksFromAnotherSource){
    
                        if(block.index === localVtMetadataForPool.index+1){
    
                            await verifyBlock(block,currentShardToCheck)
    
                        }
    
                    }
    
                }
    
            }

        }


        let allBlocksWereVerifiedInPreviousEpoch = vtEpochHandler.leadersSequence[currentShardToCheck].length-1 === handlerWithIndexToVerify.indexOfCurrentPoolToVerify

        let finishedToVerifyTheLastPoolInSequence = localVtMetadataForPool.index === metadataFromAefpForThisPool.index

        let thisShardWasAccounted = shardsReadyToNewEpoch.has(currentShardToCheck)


        if(allBlocksWereVerifiedInPreviousEpoch && finishedToVerifyTheLastPoolInSequence && !thisShardWasAccounted){

            shardsReadyToNewEpoch.set(currentShardToCheck,true)

        }

        
    }else if(currentEpochIsFresh && tempInfoAboutFinalBlocksByPreviousPoolsOnShard){

        // Take the pool by it's position
        
        let poolToVerifyRightNow = vtEpochHandler.leadersSequence[currentShardToCheck][tempInfoAboutFinalBlocksByPreviousPoolsOnShard.currentToVerify]
        
        let verificationStatsOfThisPool = WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[poolToVerifyRightNow] // {index,hash}

        let infoAboutLastBlockByThisPool = tempInfoAboutFinalBlocksByPreviousPoolsOnShard.infoAboutFinalBlocksInThisEpoch[poolToVerifyRightNow] // {index,hash}

        
        if(infoAboutLastBlockByThisPool && verificationStatsOfThisPool.index === infoAboutLastBlockByThisPool.index){

            // Move to next one
            
            tempInfoAboutFinalBlocksByPreviousPoolsOnShard.currentToVerify++


            if(!currentEpochIsFresh){

                await tryToFinishCurrentEpochOnVerificationThread(vtEpochHandler)

            }
                    
        
            setImmediate(startVerificationThread)

            return

        }
        
        // Try check if we have established a WSS channel to fetch blocks

        await checkConnectionWithPool(poolToVerifyRightNow,vtEpochHandler)


        // Now, when we have connection with some entity which has an ability to give us blocks via WS(s) tunnel

        let tunnelHandler = GLOBAL_CACHES.STUFF_CACHE.get('TUNNEL:'+poolToVerifyRightNow) // {url,hasUntilHeight,connection,cache(blockID=>block)}

        // In this case we can grab the final block
        if(infoAboutLastBlockByThisPool) GLOBAL_CACHES.STUFF_CACHE.set('GET_FINAL_BLOCK:'+poolToVerifyRightNow,infoAboutLastBlockByThisPool)

        if(tunnelHandler){

            let biggestHeightInCache = tunnelHandler.hasUntilHeight

            let stepsForWhile = biggestHeightInCache - verificationStatsOfThisPool.index

            // Start the cycle to process all the blocks

            while(stepsForWhile > 0){

    
                let blockIdToGet = vtEpochIndex+':'+poolToVerifyRightNow+':'+(verificationStatsOfThisPool.index+1)
    
                let block = tunnelHandler.cache.get(blockIdToGet)
    
    
                if(block){
    
                    await verifyBlock(block,currentShardToCheck)

                    tunnelHandler.cache.delete(blockIdToGet)

                }
                
                stepsForWhile--
        
            }
    
        } else {

            let batchOfBlocksFromAnotherSource = await getMultipleBlocks(vtEpochHandler,poolToVerifyRightNow,verificationStatsOfThisPool.index+1)

            if(batchOfBlocksFromAnotherSource){

                for(let block of batchOfBlocksFromAnotherSource){

                    if(block.index === verificationStatsOfThisPool.index+1){

                        await verifyBlock(block,currentShardToCheck)

                    }

                }

            }

        }

    }


    if(!currentEpochIsFresh && !WORKING_THREADS.VERIFICATION_THREAD.INFO_ABOUT_LAST_BLOCKS_BY_PREVIOUS_POOLS?.[currentShardToCheck]){

        await tryToFinishCurrentEpochOnVerificationThread(vtEpochHandler)

    }


    if(GLOBAL_CACHES.STUFF_CACHE.has('SHARDS_READY_TO_NEW_EPOCH')){

        let mapOfShardsReadyToNextEpoch = GLOBAL_CACHES.STUFF_CACHE.get('SHARDS_READY_TO_NEW_EPOCH') // Mappping(shardID=>boolean)

        // We move to the next epoch (N+1) only in case we finish the verification on all the shards in this epoch (N)
        if(mapOfShardsReadyToNextEpoch.size === shardsIdentifiers.length) await setUpNewEpochForVerificationThread(vtEpochHandler)

    }
            
    setImmediate(startVerificationThread)

}




let distributeFeesAmongPoolAndStakers = async(totalFees,blockCreatorPubKey) => {

    /*

        _____________________Here we perform the following logic_____________________

        [*] totalFees - number of total fees received in this block

        1) Get the pool storage to extract list of stakers

        2) In this list (poolStorage.stakers) we have structure like:

            {
                poolCreatorPubkey:{kly,uno},
                ...
                stakerPubkey:{kly,uno}
                ...
            }

        3) Send <stakingPoolStorage.percentage * totalFees> to block creator:

            poolCreatorAccount.balance += stakingPoolStorage.percentage * totalFees

        2) Distribute the rest among other stakers

            For this, we should:

                2.1) Go through poolStorage.stakers

                2.2) Increase balance - stakerAccount.balance += totalStakerPowerPercentage * restOfFees
    
    */
    
    let blockRewardAsBigInt = getBlockReward()

    WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.coinsAllocations.mining += Number(blockRewardAsBigInt)

    let blockRewardAsBigIntInWei = blockRewardAsBigInt * BigInt(10) ** BigInt(18)

    totalFees += blockRewardAsBigIntInWei


    let blockCreatorContractStorage = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+blockCreatorPubKey+'(POOL)_STORAGE_POOL')

    let blockCreatorAccount = await getUserAccountFromState(BLOCKCHAIN_GENESIS.SHARD+':'+blockCreatorPubKey)

    let poolTotalPower = BigInt(blockCreatorContractStorage.totalStakedKly) + BigInt(blockCreatorContractStorage.totalStakedUno)

    // 1. Transfer part of fees to account with pubkey associated with block creator

    let rewardForBlockCreator = 0n

    if(blockCreatorContractStorage.percentage !== 0){

        rewardForBlockCreator = (BigInt(blockCreatorContractStorage.percentage) * totalFees) / BigInt(100)

        blockCreatorAccount.balance = BigInt(blockCreatorAccount.balance) + rewardForBlockCreator
        
    }

    // 2. Share the rest of fees among stakers due to their % part in total pool stake
    
    let feesToDistributeAmongStakers = totalFees - rewardForBlockCreator

    for(let stakerPubKey of Object.keys(blockCreatorContractStorage.stakers)){

        let stakerData = blockCreatorContractStorage.stakers[stakerPubKey]

        stakerData = {kly: BigInt(stakerData.kly), uno: BigInt(stakerData.uno)}

        let stakerTotalPower = stakerData.kly + stakerData.uno

        let rewardInWei = (stakerTotalPower * feesToDistributeAmongStakers) / poolTotalPower

        if(stakerPubKey.startsWith('0x') && stakerPubKey.length === 42){

            // Return the stake back tp EVM account

            let stakerEvmAccount = await KLY_EVM.getAccount(stakerPubKey)

            stakerEvmAccount.balance += rewardInWei

            await KLY_EVM.updateAccount(stakerPubKey,stakerEvmAccount)

        } else {

            let stakerAccount = await getUserAccountFromState(BLOCKCHAIN_GENESIS.SHARD+':'+stakerPubKey)

            stakerAccount.balance = BigInt(stakerAccount.balance) + rewardInWei

        }

    }
     
}




let executeTransaction = async (shardContext,currentBlockID,transaction,rewardsAndSuccessfulTxsCollector,atomicBatch,txIdToOrderMapping) => {

    if(VERIFIERS[transaction.type]){

        let txCopy = JSON.parse(JSON.stringify(transaction))

        let {isOk,reason,createdContractAddress,extraDataToReceipt} = await VERIFIERS[transaction.type](shardContext,txCopy,rewardsAndSuccessfulTxsCollector,atomicBatch).catch(err=>({isOk:false,reason:err}))

        // Set the receipt of tx(in case it's not EVM tx, because EVM automatically create receipt and we store it using KLY-EVM)
        if(reason!=='EVM' && reason!=='Replay: You need to increase the nonce'){

            let txid = blake3Hash(txCopy.sig) // txID is a BLAKE3 hash of event you sent to blockchain. You can recount it locally(will be used by wallets, SDKs, libs and so on)

            atomicBatch.put('TX:'+txid,{shard:shardContext,blockID:currentBlockID,order:txIdToOrderMapping[txCopy.sig],isOk,reason,createdContractAddress,extraDataToReceipt})

        }

        if(isOk) rewardsAndSuccessfulTxsCollector.successfulTxsCounter++
    
    }

}




let executeGroupOfTransaction = async (shardContext,currentBlockID,independentGroup,rewardsAndSuccessfulTxsCollector,atomicBatch,txIdToOrderMapping) => {

    for(let txFromIndependentGroup of independentGroup){

        if(VERIFIERS[txFromIndependentGroup.type]){

            let txCopy = JSON.parse(JSON.stringify(txFromIndependentGroup))
    
            let {isOk,reason,createdContractAddress,extraDataToReceipt} = await VERIFIERS[txFromIndependentGroup.type](shardContext,txCopy,rewardsAndSuccessfulTxsCollector,atomicBatch).catch(err=>({isOk:false,reason:err}))
    
            // Set the receipt of tx(in case it's not EVM tx, because EVM automatically create receipt and we store it using KLY-EVM)
            if(reason!=='EVM'){
    
                let txid = blake3Hash(txCopy.sig) // txID is a BLAKE3 hash of event you sent to blockchain. You can recount it locally(will be used by wallets, SDKs, libs and so on)
    
                atomicBatch.put('TX:'+txid,{shard:shardContext,blockID:currentBlockID,order:txIdToOrderMapping[txCopy.sig],isOk,reason,createdContractAddress,extraDataToReceipt})
    
            }

            if(isOk) rewardsAndSuccessfulTxsCollector.successfulTxsCounter++
        
        }
    
    }

}




let verifyBlock = async(block,shardContext) => {


    let blockHash = Block.genHash(block),

        overviewOk=
        
            block.transactions?.length<=WORKING_THREADS.VERIFICATION_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK
            &&
            WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[block.creator].hash === block.prevHash // it should be a chain




    if(overviewOk){

        GLOBAL_CACHES.STATE_CHANGES_CACHE = { put: {}, delete: {}, update: {} }

        GLOBAL_CACHES.STATE_CACHE.clear()

        // To calculate fees and split among pool-creator & stakers. Currently - general fees sum is 0. It will be increased each performed transaction
        
        let rewardsAndSuccessfulTxsCollector = {fees:0n, successfulTxsCounter:0}

        let currentEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id

        let currentBlockID = currentEpochIndex+':'+block.creator+':'+block.index


        GLOBAL_CACHES.STATE_CACHE.set('EVM_LOGS_MAP',{}) // (contractAddress => array of logs) to store logs created by KLY-EVM


        //_________________________________________PREPARE THE KLY-EVM STATE____________________________________________

        
        let klyEvmMetadata = WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_METADATA[shardContext] // {nextBlockIndex,parentHash,timestamp}

        // Set the next block's parameters
        KLY_EVM.setCurrentBlockParams(klyEvmMetadata.nextBlockIndex,klyEvmMetadata.timestamp,klyEvmMetadata.parentHash)


        trackStateChange('VERIFICATION_THREAD',WORKING_THREADS.VERIFICATION_THREAD,'update')


        // To change the state atomically
        let atomicBatch = BLOCKCHAIN_DATABASES.STATE.batch()


        if(block.transactions.length !== 0){


            //___________________________________________START TO EXECUTE TXS____________________________________________


            // First of all - split the transactions for groups that can be executed simultaneously

            let txsPreparedForParallelization = getPreparedTxsForParallelization(block.transactions)

            // Firstly - execute independent transactions in a parallel way

            let txsPromises = []
            

            //____________Add the independent transactions. 1 tx = 1 thread____________

            for(let independentTransaction of txsPreparedForParallelization.independentTransactions){

                txsPromises.push(executeTransaction(shardContext,currentBlockID,independentTransaction,rewardsAndSuccessfulTxsCollector,atomicBatch,txsPreparedForParallelization.txIdToOrderMapping))

            }

            //____________Add all the transactions from independent groups. 1 group(with many txs) = 1 thread____________

            for(let [,independentGroup] of txsPreparedForParallelization.independentGroups){

                // Groups might be executed in parallel, but all the txs in a single groups must be executed in a sync way
                
                txsPromises.push(

                    executeGroupOfTransaction(shardContext,currentBlockID,independentGroup,rewardsAndSuccessfulTxsCollector,atomicBatch,txsPreparedForParallelization.txIdToOrderMapping)

                )

            }

            await Promise.all(txsPromises)

            // Now, execute all the rest transactions that can't be executed in a async(parallel) way

            for(let sequentialTransaction of txsPreparedForParallelization.syncTransactions){

                await executeTransaction(shardContext,currentBlockID,sequentialTransaction,rewardsAndSuccessfulTxsCollector,atomicBatch,txsPreparedForParallelization.txIdToOrderMapping)

            }        


        }


        //_____________________________________SHARE FEES AMONG POOL OWNER AND STAKERS__________________________________
        
        /*
            
            Distribute fees among:

                [0] Block creator itself
                [1] Stakers of his pool

        */
        
        await distributeFeesAmongPoolAndStakers(rewardsAndSuccessfulTxsCollector.fees,block.creator)

            
        //________________________________________________COMMIT STATE__________________________________________________    
        
        
        GLOBAL_CACHES.STATE_CACHE.forEach((account,storageCellID)=>
        
            atomicBatch.put(storageCellID,account)
        
        )
        
        // Probably you would like to store only state or you just run another node via cloud module and want to store some range of blocks remotely
        if(CONFIGURATION.NODE_LEVEL.STORE_BLOCKS_IN_LOCAL_DATABASE){
            
            // No matter if we already have this block-resave it

            BLOCKCHAIN_DATABASES.BLOCKS.put(currentBlockID,block).catch(
                
                error => customLog(`Failed to store block ${block.index}\nError:${error}`,logColors.YELLOW)
                
            )

        }else if(block.creator !== CONFIGURATION.NODE_LEVEL.PUBLIC_KEY){

            // ...but if we shouldn't store and have it locally(received probably by range loading)-then delete

            BLOCKCHAIN_DATABASES.BLOCKS.del(currentBlockID).catch(
                
                error => customLog(`Failed to delete block ${currentBlockID}\nError:${error}`,logColors.YELLOW)
                
            )

        }


        let generalBlockIndexInShard = WORKING_THREADS.VERIFICATION_THREAD.SID_TRACKER[shardContext]

        atomicBatch.put(`SID:${shardContext}:${generalBlockIndexInShard}`,currentBlockID)

        trackStateChange(`SID:${shardContext}:${generalBlockIndexInShard}`,1,'put')


        WORKING_THREADS.VERIFICATION_THREAD.SID_TRACKER[shardContext]++


        // Try to set the pointer to the first block in epoch

        if(block.index === 0){

            // Structure is {firstBlockCreator,firstBlockHash}
            
            let handlerWithTheFirstBlockData = await BLOCKCHAIN_DATABASES.STATE.get(`FIRST_BLOCK:${currentEpochIndex}:${shardContext}`).catch(()=>false)

            // If no exists - it's obvious that it's the first block
            if(!handlerWithTheFirstBlockData){

                handlerWithTheFirstBlockData = { firstBlockCreator: block.creator, firstBlockHash: blockHash }

                atomicBatch.put(`FIRST_BLOCK:${currentEpochIndex}:${shardContext}`,handlerWithTheFirstBlockData)

                trackStateChange(`FIRST_BLOCK:${currentEpochIndex}:${shardContext}`,handlerWithTheFirstBlockData,'put')

            }

        }

  
        // Increase the total blocks & txs counters(for explorer & stats purposes)
        
        WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalBlocksNumber++

        WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalTxsNumber += block.transactions.length

        WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.successfulTxsNumber += rewardsAndSuccessfulTxsCollector.successfulTxsCounter

        // Do the same for stats per each API (useful for API, charts and statistics)

        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.totalBlocksNumber++

        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.totalTxsNumber += block.transactions.length        

        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.successfulTxsNumber += rewardsAndSuccessfulTxsCollector.successfulTxsCounter

        
        // Change metadata per validator's thread
        
        WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[block.creator].index = block.index

        WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[block.creator].hash = blockHash


        // Iterate over newly created EVM accounts inside EVM to create addtional data for CAs / EOAs and track stats (created contracts, new accounts, etc.)

        for (let lowerCaseEvmAddressWith0xPrefix of global.CREATED_EVM_ACCOUNTS) {

            let account = await KLY_EVM.getAccount(lowerCaseEvmAddressWith0xPrefix)

            let extendedInfo = await getFromState('EVM_ACCOUNT:'+lowerCaseEvmAddressWith0xPrefix)

            if(account && !extendedInfo){

                atomicBatch.put('EVM_ACCOUNT:'+lowerCaseEvmAddressWith0xPrefix,{gas:0})

                trackStateChange('EVM_ACCOUNT:'+lowerCaseEvmAddressWith0xPrefix,1,'put')

                if(account.codeHash.toString('hex') === 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'){

                    // It's EOA account
                
                    WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalUserAccountsNumber.evm++

                    WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newUserAccountsNumber.evm++


                } else {

                    // It's contract
                    
                    WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalSmartContractsNumber.evm++

                    WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newSmartContractsNumber.evm++

                    atomicBatch.put('EVM_CONTRACT_DATA:'+lowerCaseEvmAddressWith0xPrefix,{storageAbstractionLastPayment:currentEpochIndex})

                    trackStateChange('EVM_CONTRACT_DATA:'+lowerCaseEvmAddressWith0xPrefix,1,'put')

                }

            }

        }


        global.CREATED_EVM_ACCOUNTS.clear()


        //___________________ Update the KLY-EVM ___________________

        // Update stateRoot
        WORKING_THREADS.VERIFICATION_THREAD.KLY_EVM_STATE_ROOT = await KLY_EVM.getStateRoot()

        // Increase block index
        let nextIndex = BigInt(klyEvmMetadata.nextBlockIndex)+BigInt(1)

        klyEvmMetadata.nextBlockIndex = Web3.utils.toHex(nextIndex.toString())

        // Store previous hash
        let currentHash = KLY_EVM.getCurrentBlock().hash()
    
        klyEvmMetadata.parentHash = currentHash.toString('hex')
        

        // Imagine that it's 1 block per 1 second
        let nextTimestamp = klyEvmMetadata.timestamp+1
    
        klyEvmMetadata.timestamp = nextTimestamp
        

        // Finally, store the block

        let blockToStore = KLY_EVM.getBlockToStore(currentHash)


        atomicBatch.put(`${shardContext}:EVM_BLOCK:${blockToStore.number}`,blockToStore)

        trackStateChange(`${shardContext}:EVM_BLOCK:${blockToStore.number}`,1,'put')

        atomicBatch.put(`${shardContext}:EVM_INDEX:${blockToStore.hash}`,blockToStore.number)

        trackStateChange(`${shardContext}:EVM_INDEX:${blockToStore.hash}`,1,'put')

        atomicBatch.put(`${shardContext}:EVM_LOGS:${blockToStore.number}`,GLOBAL_CACHES.STATE_CACHE.get('EVM_LOGS_MAP'))

        trackStateChange(`${shardContext}:EVM_LOGS:${blockToStore.number}`,1,'put')

        atomicBatch.put(`${shardContext}:EVM_BLOCK_RECEIPT:${blockToStore.number}`,{klyBlock:currentBlockID})

        trackStateChange(`${shardContext}:EVM_BLOCK_RECEIPT:${blockToStore.number}`,1,'put')
 
        atomicBatch.put(`BLOCK_RECEIPT:${currentBlockID}`,{sid:generalBlockIndexInShard})
        
        trackStateChange(`BLOCK_RECEIPT:${currentBlockID}`,1,'put')
        
        //_________________________________Commit the state of VERIFICATION_THREAD_________________________________


        atomicBatch.put('VT',WORKING_THREADS.VERIFICATION_THREAD)

        await atomicBatch.write()

        vtStatsLog(block.epoch,shardContext,block.creator,block.index,blockHash,block.transactions.length)

        console.log('DEBUG: State changes => ',GLOBAL_CACHES.STATE_CHANGES_CACHE)
        

    }

}