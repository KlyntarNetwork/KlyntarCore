import {GRACEFUL_STOP, BLOCKCHAIN_DATABASES, WORKING_THREADS, GLOBAL_CACHES, EPOCH_METADATA_MAPPING} from '../blockchain_preparation.js'

import {getCurrentEpochQuorum, getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {CONTRACT_FOR_DELAYED_TRANSACTIONS} from '../system_contracts/delayed_transactions/delayed_transactions.js'

import {getFirstBlockOnEpochOnSpecificShard, verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {blake3Hash, logColors, customLog, pathResolve} from '../../../KLY_Utils/utils.js'

import {setLeadersSequenceForShards} from './shards_leaders_monitoring.js'

import {getFromState} from '../common_functions/state_interactions.js'

import {getBlock} from '../verification_process/verification.js'

import {epochStillFresh, isMyCoreVersionOld} from '../utils.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import Block from '../structures/block.js'

import level from 'level'

import fs from 'fs'






export let executeDelayedTransaction = async(threadID,delayedTransaction) => {

    /*

        Reminder: Each delayed transaction has the <type> field

        Using this field - get the handler for appropriate function and pass the tx body inside

    */

    
    let functionHandler = CONTRACT_FOR_DELAYED_TRANSACTIONS[delayedTransaction.type]


    if(functionHandler){

        await functionHandler(threadID,delayedTransaction).catch(()=>{})

    }

}





export let findAefpsAndFirstBlocksForCurrentEpoch=async()=>{

    
    if(!epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD)){

        let verificationThreadEpochHandler = WORKING_THREADS.VERIFICATION_THREAD.EPOCH

        let currentEpochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH

        if(currentEpochHandler.id - verificationThreadEpochHandler.id >= 2){

            setTimeout(findAefpsAndFirstBlocksForCurrentEpoch,3000)
    
            return

        }

        let currentEpochFullID = currentEpochHandler.hash+"#"+currentEpochHandler.id
    
        let temporaryObject = EPOCH_METADATA_MAPPING.get(currentEpochFullID)
    
        if(!temporaryObject){
    
            setTimeout(findAefpsAndFirstBlocksForCurrentEpoch,3000)
    
            return
    
        }


        let totalNumberOfShards = 0

        let totalNumberOfReadyShards = 0

        let leadersSequence = currentEpochHandler.leadersSequence

        let majority = getQuorumMajority(currentEpochHandler)

        let quorumNodesUrls = await getQuorumUrlsAndPubkeys()



        let aefpAndFirstBlockData = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`FIRST_BLOCKS_DATA_AND_AEFPS:${currentEpochFullID}`).catch(()=>({})) // {shardID:{firstBlockCreator,firstBlockHash,aefp}}

        let entries = Object.entries(leadersSequence)

        //____________________Ask the quorum for AEFP for shard___________________
        
        for(let [shardID] of entries){
        
            totalNumberOfShards++
        
            if(!aefpAndFirstBlockData[shardID]) aefpAndFirstBlockData[shardID] = {}

            if(aefpAndFirstBlockData[shardID].aefp && aefpAndFirstBlockData[shardID].firstBlockHash){

                totalNumberOfReadyShards++

                // No more sense to find AEFPs or first block for this shard. Just continue

                continue

            }

            /*
        
                ███████╗██╗███╗   ██╗██████╗      █████╗ ███████╗███████╗██████╗ ███████╗
                ██╔════╝██║████╗  ██║██╔══██╗    ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝
                █████╗  ██║██╔██╗ ██║██║  ██║    ███████║█████╗  █████╗  ██████╔╝███████╗
                ██╔══╝  ██║██║╚██╗██║██║  ██║    ██╔══██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║
                ██║     ██║██║ ╚████║██████╔╝    ██║  ██║███████╗██║     ██║     ███████║
                ╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝     ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝     ╚══════╝

                
                Reminder: AEFP structure is

                    {
                        shard:<ID of shard>,
                        lastLeader:<index of ed25519 pubkey of some pool in sequence of pool for this shard in current epoch>,
                        lastIndex:<index of his block in previous epoch>,
                        lastHash:<hash of this block>,
                        hashOfFirstBlockByLastLeader,
                        
                        proofs:{

                            ed25519PubKey0:ed25519Signa0,
                            ...
                            ed25519PubKeyN:ed25519SignaN
                         
                        }
    
                    }

            */

            
            if(!aefpAndFirstBlockData[shardID].aefp){

                // Try to find locally

                let aefp = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${currentEpochHandler.id}:${shardID}`).catch(()=>false)

                if(aefp){

                    aefpAndFirstBlockData[shardID].aefp = aefp

                }else{

                    // Ask quorum for AEFP
                    for(let quorumMemberUrl of quorumNodesUrls){

                        const controller = new AbortController()

                        setTimeout(() => controller.abort(), 2000)
            
                        let itsProbablyAggregatedEpochFinalizationProof = await fetch(
                            
                            quorumMemberUrl+`/aggregated_epoch_finalization_proof/${currentEpochHandler.id}/${shardID}`,{signal:controller.signal}
                        
                        ).then(r=>r.json()).catch(()=>false)
                
                        
                        if(itsProbablyAggregatedEpochFinalizationProof){
                
                            let aefpPureObject = await verifyAggregatedEpochFinalizationProof(itsProbablyAggregatedEpochFinalizationProof,currentEpochHandler.quorum,majority,currentEpochFullID)
    
                            if(aefpPureObject && aefpPureObject.shard === shardID){
    
                                aefpAndFirstBlockData[shardID].aefp = aefpPureObject

                                // Store locally

                                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`AEFP:${currentEpochHandler.id}:${shardID}`,aefpPureObject).catch(()=>{})

                                // No sense to find more

                                break
    
                            }
                                        
                        }
                
                    }

                }

            }
            


            /*
        
                ███████╗██╗███╗   ██╗██████╗     ███████╗██╗██████╗ ███████╗████████╗    ██████╗ ██╗      ██████╗  ██████╗██╗  ██╗███████╗
                ██╔════╝██║████╗  ██║██╔══██╗    ██╔════╝██║██╔══██╗██╔════╝╚══██╔══╝    ██╔══██╗██║     ██╔═══██╗██╔════╝██║ ██╔╝██╔════╝
                █████╗  ██║██╔██╗ ██║██║  ██║    █████╗  ██║██████╔╝███████╗   ██║       ██████╔╝██║     ██║   ██║██║     █████╔╝ ███████╗
                ██╔══╝  ██║██║╚██╗██║██║  ██║    ██╔══╝  ██║██╔══██╗╚════██║   ██║       ██╔══██╗██║     ██║   ██║██║     ██╔═██╗ ╚════██║
                ██║     ██║██║ ╚████║██████╔╝    ██║     ██║██║  ██║███████║   ██║       ██████╔╝███████╗╚██████╔╝╚██████╗██║  ██╗███████║
                ╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝       ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝
    
            */

            if(!aefpAndFirstBlockData[shardID].firstBlockHash){

                // Structure is {firstBlockCreator,firstBlockHash}
            
                let storedFirstBlockData = await BLOCKCHAIN_DATABASES.STATE.get(`FIRST_BLOCK:${currentEpochHandler.id}:${shardID}`).catch(()=>null)

                if(!storedFirstBlockData){

                    // Try to find via network requests

                    storedFirstBlockData = await getFirstBlockOnEpochOnSpecificShard('APPROVEMENT_THREAD',currentEpochHandler,shardID,getBlock)

                }

                if(storedFirstBlockData){

                    aefpAndFirstBlockData[shardID].firstBlockCreator = storedFirstBlockData.firstBlockCreator

                    aefpAndFirstBlockData[shardID].firstBlockHash = storedFirstBlockData.firstBlockHash

                }

            }

        
            if(aefpAndFirstBlockData[shardID].firstBlockHash && aefpAndFirstBlockData[shardID].aefp) totalNumberOfReadyShards++

            if(!aefpAndFirstBlockData[shardID].firstBlockHash) aefpAndFirstBlockData[shardID] = {}
    
        
        }

        // Save the changes(caching)

        await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`FIRST_BLOCKS_DATA_AND_AEFPS:${currentEpochFullID}`,aefpAndFirstBlockData).catch(()=>{})


        //_____Now, when we've resolved all the first blocks & found all the AEFPs - get blocks, extract epoch edge transactions and set the new epoch____


        if(totalNumberOfShards === totalNumberOfReadyShards){

            let delayedTransactionsFromAllShards = []

            let firstBlocksHashes = []

            let cycleWasBreak = false

            let overPreviousEpochHandler = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HANDLER:${currentEpochHandler.id-2}`).catch(()=>null)

            if(overPreviousEpochHandler) {

                for(let shardID of overPreviousEpochHandler.shardsRegistry){

                    let delayedTxs = await getFromState(`DELAYED_TRANSACTIONS:${currentEpochHandler.id}:${shardID}`)

                    if(delayedTxs){

                        delayedTransactionsFromAllShards.push(...delayedTxs)

                    }

                }

            }

            for(let [shardID] of entries){

                // Try to get the epoch edge transactions from the first blocks

                let firstBlockOnThisShard = await getBlock(currentEpochHandler.id,aefpAndFirstBlockData[shardID].firstBlockCreator,0)

                if(firstBlockOnThisShard && Block.genHash(firstBlockOnThisShard) === aefpAndFirstBlockData[shardID].firstBlockHash){

                    firstBlocksHashes.push(aefpAndFirstBlockData[shardID].firstBlockHash)

                }else{

                    cycleWasBreak = true

                    break

                }

            }

            if(!cycleWasBreak){

                // For API - store the whole epoch handler object by epoch numerical index

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_HANDLER:${currentEpochHandler.id}`,currentEpochHandler).catch(()=>{})


                let daoVotingContractCalls = [], slashingContractCalls = [], changeUnobtaniumAmountCalls = [], allTheRestContractCalls = []

                let atomicBatch = BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.batch()

                
                for(let delayedTransaction of delayedTransactionsFromAllShards){

                    let itsDaoVoting = delayedTransaction.type === 'votingAccept'

                    let itsSlashing = delayedTransaction.type === 'slashing'

                    let itsUnoChangingTx = delayedTransaction.type === 'changeUnobtaniumAmount'


                    if(itsDaoVoting) daoVotingContractCalls.push(delayedTransaction)

                    else if(itsSlashing) slashingContractCalls.push(delayedTransaction)

                    else if(itsUnoChangingTx) changeUnobtaniumAmountCalls.push(delayedTransaction)

                    else allTheRestContractCalls.push(delayedTransaction)

                }


                let delayedTransactionsOrderByPriority = daoVotingContractCalls.concat(slashingContractCalls).concat(changeUnobtaniumAmountCalls).concat(allTheRestContractCalls)


                // Store the delayed transactions locally because we'll need it later(to change the epoch on VT - Verification Thread)
                // So, no sense to grab it twice(on AT and later on VT). On VT we just get it from DB and execute these transactions(already in priority order)
                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`DELAYED_TRANSACTIONS:${currentEpochFullID}`,delayedTransactionsFromAllShards).catch(()=>false)


                for(let delayedTransaction of delayedTransactionsOrderByPriority){
        
                    await executeDelayedTransaction('APPROVEMENT_THREAD',delayedTransaction).catch(()=>{})
                
                }
                
                // After all ops - commit state and make changes in databases
            
                GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.forEach((value,storageCellID)=>{
            
                    if(storageCellID.includes('(POOL)_STORAGE_POOL')){

                        atomicBatch.put(storageCellID,value)

                    }
            
                })

               
                // Now, after the execution we can change the epoch id and get the new hash + prepare new temporary object
                
                let nextEpochId = currentEpochHandler.id + 1

                let nextEpochHash = blake3Hash(JSON.stringify(firstBlocksHashes))

                let nextEpochFullID = nextEpochHash+'#'+nextEpochId


                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_HASH:${nextEpochId}`,nextEpochHash).catch(()=>{})


                // After execution - assign pools(validators) to shards

                await setLeadersSequenceForShards(currentEpochHandler,nextEpochHash)

                
                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_LEADERS_SEQUENCES:${nextEpochId}`,WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.leadersSequence).catch(()=>{})


                customLog(`\u001b[38;5;154mDelayed transactions were executed for epoch \u001b[38;5;93m${currentEpochFullID} (AT)\u001b[0m`,logColors.GREEN)


                //_______________________ Update the values for new epoch _______________________

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.startTimestamp = currentEpochHandler.startTimestamp + WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.EPOCH_TIME

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.id = nextEpochId

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.hash = nextEpochHash

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum = await getCurrentEpochQuorum(WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.poolsRegistry,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS,nextEpochHash)

                // WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.LEADERSHIP_TIMEFRAME = Math.floor(WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.EPOCH_TIME/WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum.length)

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`EPOCH_QUORUM:${nextEpochId}`,WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum).catch(()=>{})
                
                // Create new temporary db for the next epoch

                let nextTempDB = level(process.env.CHAINDATA_PATH+`/${nextEpochFullID}`,{valueEncoding:'json'})

                // Commit changes

                atomicBatch.put('AT',WORKING_THREADS.APPROVEMENT_THREAD)

                await atomicBatch.write()

                // Clean the cache
                GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.clear()


                // Create mappings & set for the next epoch
                let nextTemporaryObject = {

                    FINALIZATION_PROOFS:new Map(),

                    FINALIZATION_STATS:new Map(),

                    TEMP_CACHE:new Map(),

                    SYNCHRONIZER:new Map(),
            
                    SHARDS_LEADERS_HANDLERS:new Map(),
      
                    DATABASE:nextTempDB
            
                }

                customLog(`Epoch on approvement thread was updated => \x1b[34;1m${nextEpochHash}#${nextEpochId}`,logColors.GREEN)

                //_______________________Check the version required for the next epoch________________________


                if(isMyCoreVersionOld('APPROVEMENT_THREAD')){

                    customLog(`New version detected on APPROVEMENT_THREAD. Please, upgrade your node software`,logColors.YELLOW)

                    console.log('\n')
                    console.log(fs.readFileSync(pathResolve('images/events/update.txt')).toString())
        
                    // Stop the node to update the software
                    GRACEFUL_STOP()

                }


                // Close & delete the old temporary db
            
                await EPOCH_METADATA_MAPPING.get(currentEpochFullID).DATABASE.close()
        
                fs.rm(process.env.CHAINDATA_PATH+`/${currentEpochFullID}`,{recursive:true},()=>{})
        
                EPOCH_METADATA_MAPPING.delete(currentEpochFullID)

                
                
                //________________________________ If it's fresh epoch and we present there as a member of quorum - then continue the logic ________________________________


                let iAmInTheQuorum = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum.includes(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)


                if(epochStillFresh(WORKING_THREADS.APPROVEMENT_THREAD) && iAmInTheQuorum){

                    // Fill with the null-data

                    let currentEpochManager = nextTemporaryObject.FINALIZATION_STATS

                    WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.poolsRegistry.forEach(poolPubKey=>

                        currentEpochManager.set(poolPubKey,{index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}})

                    )

                }

                // Set next temporary object by ID

                EPOCH_METADATA_MAPPING.set(nextEpochFullID,nextTemporaryObject)

                // Delete the cache that we don't need more

                await BLOCKCHAIN_DATABASES.EPOCH_DATA.del(`FIRST_BLOCKS_DATA_AND_AEFPS:${currentEpochFullID}`).catch(()=>{})


            }

        }

        // Continue to find
        setImmediate(findAefpsAndFirstBlocksForCurrentEpoch)

    }else{

        setTimeout(findAefpsAndFirstBlocksForCurrentEpoch,3000)

    }

}