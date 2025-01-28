import {getCurrentEpochQuorum, getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {getFirstBlockInEpoch, verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {CONTRACT_FOR_DELAYED_TRANSACTIONS} from '../system_contracts/delayed_transactions/delayed_transactions.js'

import {BLOCKCHAIN_DATABASES, WORKING_THREADS, GLOBAL_CACHES, EPOCH_METADATA_MAPPING} from '../globals.js'

import {blake3Hash, logColors, customLog, pathResolve, gracefulStop} from '../../../KLY_Utils/utils.js'

import {getBlock} from '../verification_process/verification.js'

import {epochStillFresh, isMyCoreVersionOld} from '../utils.js'

import {setLeadersSequence} from './leaders_monitoring.js'

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

        let majority = getQuorumMajority(currentEpochHandler)

        let quorumNodesUrls = await getQuorumUrlsAndPubkeys()



        let aefpAndFirstBlockData = GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.get(`FIRST_BLOCKS_DATA_AND_AEFPS:${currentEpochFullID}`) || {} // {firstBlockCreator,firstBlockHash,aefp}

        let haveEverything = aefpAndFirstBlockData.aefp && aefpAndFirstBlockData.firstBlockHash


        if(!haveEverything){


            /*
        
                ███████╗██╗███╗   ██╗██████╗      █████╗ ███████╗███████╗██████╗ ███████╗
                ██╔════╝██║████╗  ██║██╔══██╗    ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝
                █████╗  ██║██╔██╗ ██║██║  ██║    ███████║█████╗  █████╗  ██████╔╝███████╗
                ██╔══╝  ██║██║╚██╗██║██║  ██║    ██╔══██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║
                ██║     ██║██║ ╚████║██████╔╝    ██║  ██║███████╗██║     ██║     ███████║
                ╚═╝     ╚═╝╚═╝  ╚═══╝╚═════╝     ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝     ╚══════╝

                
                Reminder: AEFP structure is

                    {
                        lastLeader:<index of ed25519 pubkey of some pool in sequence of pools in current epoch>,
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

            if(!aefpAndFirstBlockData.aefp){

                // Try to find locally

                let aefp = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${currentEpochHandler.id}`).catch(()=>null)

                if(aefp){

                    aefpAndFirstBlockData.aefp = aefp

                }else{

                    // Ask quorum for AEFP

                    for(let quorumMemberUrl of quorumNodesUrls){

                        const controller = new AbortController()

                        setTimeout(() => controller.abort(), 2000)
            
                        let itsProbablyAggregatedEpochFinalizationProof = await fetch(
                            
                            quorumMemberUrl+`/aggregated_epoch_finalization_proof/${currentEpochHandler.id}`,{signal:controller.signal}
                        
                        ).then(r=>r.json()).catch(()=>false)
                
                        
                        if(itsProbablyAggregatedEpochFinalizationProof){
                
                            let aefpPureObject = await verifyAggregatedEpochFinalizationProof(itsProbablyAggregatedEpochFinalizationProof,currentEpochHandler.quorum,majority,currentEpochFullID)
    
                            if(aefpPureObject){
    
                                aefpAndFirstBlockData.aefp = aefpPureObject

                                // Store locally

                                await BLOCKCHAIN_DATABASES.EPOCH_DATA.put(`AEFP:${currentEpochHandler.id}`,aefpPureObject).catch(()=>{})

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

            if(!aefpAndFirstBlockData.firstBlockHash){

                // Structure is {firstBlockCreator,firstBlockHash}
            
                let storedFirstBlockData = await BLOCKCHAIN_DATABASES.STATE.get(`FIRST_BLOCK:${currentEpochHandler.id}`).catch(()=>null)

                if(!storedFirstBlockData){

                    // Try to find via network requests

                    storedFirstBlockData = await getFirstBlockInEpoch('APPROVEMENT_THREAD',currentEpochHandler,getBlock)

                }

                if(storedFirstBlockData){

                    aefpAndFirstBlockData.firstBlockCreator = storedFirstBlockData.firstBlockCreator

                    aefpAndFirstBlockData.firstBlockHash = storedFirstBlockData.firstBlockHash

                }

            }

            if(!aefpAndFirstBlockData.firstBlockHash) aefpAndFirstBlockData = {}

        }
        
        // Save the changes(caching)

        GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.set(`FIRST_BLOCKS_DATA_AND_AEFPS:${currentEpochFullID}`,aefpAndFirstBlockData)


        //_____Now, when we've resolved all the first blocks & found all the AEFPs - get blocks, extract epoch edge transactions and set the new epoch____

        if(aefpAndFirstBlockData.firstBlockHash && aefpAndFirstBlockData.aefp){

            //_________________Get the delayed transactions from the first block in epoch_________________

            // 1. Fetch first block

            let firstBlock = await getBlock(currentEpochHandler.id,aefpAndFirstBlockData.firstBlockCreator,0)

            // 2. Compare hashes

            if(firstBlock && Block.genHash(firstBlock) === aefpAndFirstBlockData.firstBlockHash){

                let delayedTransactions = firstBlock.extraData.delayedTransactions || []

                let firstBlocksHashes = []

                firstBlocksHashes.push(aefpAndFirstBlockData.firstBlockHash)

                let epochMetadataAtomicBatch = BLOCKCHAIN_DATABASES.EPOCH_DATA.batch()

                // For API - store the whole epoch handler object by epoch numerical index

                epochMetadataAtomicBatch.put(`EPOCH_HANDLER:${currentEpochHandler.id}`,currentEpochHandler)


                let daoVotingContractCalls = [], slashingContractCalls = [], changeUnobtaniumAmountCalls = [], allTheRestContractCalls = []

                let atomicBatch = BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.batch()

                
                for(let delayedTransaction of delayedTransactions){

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
                epochMetadataAtomicBatch.put(`DELAYED_TRANSACTIONS:${currentEpochFullID}`,delayedTransactions)


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


                epochMetadataAtomicBatch.put(`EPOCH_HASH:${nextEpochId}`,nextEpochHash)


                // After execution - assign new sequence of leaders

                await setLeadersSequence(currentEpochHandler,nextEpochHash)

                
                epochMetadataAtomicBatch.put(`EPOCH_LEADERS_SEQUENCES:${nextEpochId}`,WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.leadersSequence)


                customLog(`\u001b[38;5;154mDelayed transactions were executed for epoch \u001b[38;5;93m${currentEpochFullID} (AT)\u001b[0m`,logColors.GREEN)


                //_______________________ Update the values for new epoch _______________________

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.startTimestamp = currentEpochHandler.startTimestamp + WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.EPOCH_TIME

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.id = nextEpochId

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.hash = nextEpochHash

                WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum = await getCurrentEpochQuorum(WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.poolsRegistry,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS,nextEpochHash)

                epochMetadataAtomicBatch.put(`EPOCH_QUORUM:${nextEpochId}`,WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum)
                
                // Create new temporary db for the next epoch

                let nextTempDB = level(process.env.CHAINDATA_PATH+`/${nextEpochFullID}`,{valueEncoding:'json'})

                // Commit changes

                atomicBatch.put('AT',WORKING_THREADS.APPROVEMENT_THREAD)


                await epochMetadataAtomicBatch.write()

                await atomicBatch.write()

                // Clean the cache

                GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.clear()


                // Create mappings & set for the next epoch
                let nextTemporaryObject = {

                    FINALIZATION_PROOFS:new Map(),

                    FINALIZATION_STATS:new Map(),

                    TEMP_CACHE:new Map(),

                    SYNCHRONIZER:new Map(),
            
                    CURRENT_LEADER_INFO:{index:0,pubKey:WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.leadersSequence[0]},
      
                    DATABASE:nextTempDB
            
                }

                customLog(`Epoch on approvement thread was updated => \x1b[34;1m${nextEpochHash}#${nextEpochId}`,logColors.GREEN)

                //_______________________Check the version required for the next epoch________________________


                if(isMyCoreVersionOld('APPROVEMENT_THREAD')){

                    customLog(`New version detected on APPROVEMENT_THREAD. Please, upgrade your node software`,logColors.YELLOW)

                    console.log('\n')
                    console.log(fs.readFileSync(pathResolve('images/events/update.txt')).toString())
        
                    // Stop the node to update the software
                    
                    gracefulStop()

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

            }

        }

        // Continue to find
        setImmediate(findAefpsAndFirstBlocksForCurrentEpoch)

    } else {

        setTimeout(findAefpsAndFirstBlocksForCurrentEpoch,3000)

    }

}