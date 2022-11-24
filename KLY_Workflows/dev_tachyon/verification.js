import {GET_ACCOUNT_ON_SYMBIOTE,BLOCKLOG,VERIFY,GET_QUORUM,GET_FROM_STATE_FOR_QUORUM_THREAD,GET_FROM_STATE,GET_QUORUM_MEMBERS_URLS} from './utils.js'

import {LOG,SYMBIOTE_ALIAS,BLAKE3} from '../../KLY_Utils/utils.js'

import bls from '../../KLY_Utils/signatures/multisig/bls.js'

import OPERATIONS_VERIFIERS from './operationsVerifiers.js'

import Block from './essences/block.js'

import fetch from 'node-fetch'




//_____________________________________________________________EXPORT SECTION____________________________________________________________________




export let




//Make all advanced stuff here-check block locally or ask from "GET_BLOCKS_URL" node for new blocks
//If no answer - try to find blocks somewhere else

GET_BLOCK = async(blockCreator,index) => {

    let blockID=blockCreator+":"+index
    
    return SYMBIOTE_META.BLOCKS.get(blockID).catch(_=>

        fetch(CONFIG.SYMBIOTE.GET_BLOCKS_URL+`/block/`+blockCreator+":"+index)
    
        .then(r=>r.json()).then(block=>{
    
            let hash=Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash)
                
            if(typeof block.events==='object'&&typeof block.prevHash==='string'&&typeof block.sig==='string' && block.index===index && block.creator === blockCreator){
    
                BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m——│`,'S',hash,48,'\x1b[31m',block)

                SYMBIOTE_META.BLOCKS.put(blockID,block)
    
                return block
    
            }
    
        }).catch(async error=>{
    
            LOG(`No block \x1b[36;1m${blockCreator+":"+index}\u001b[38;5;3m for symbiote \x1b[36;1m${SYMBIOTE_ALIAS()}\u001b[38;5;3m ———> ${error}`,'W')
    
            LOG(`Going to ask for blocks from the other nodes(\x1b[32;1mGET_BLOCKS_URL\x1b[36;1m node is \x1b[31;1moffline\x1b[36;1m or another error occured)`,'I')
    

            //Combine all nodes we know about and try to find block there
            let allVisibleNodes=await GET_QUORUM_MEMBERS_URLS('QUORUM_THREAD')

    
            for(let url of allVisibleNodes){

                if(url===CONFIG.SYMBIOTE.MY_HOSTNAME) continue
                
                let itsProbablyBlock=await fetch(url+`/block/`+blockID).then(r=>r.json()).catch(_=>false)
                
                if(itsProbablyBlock){
    
                    let hash=Block.genHash(itsProbablyBlock.creator,itsProbablyBlock.time,itsProbablyBlock.events,itsProbablyBlock.index,itsProbablyBlock.prevHash)

                    let overviewIsOk =
                    
                        typeof itsProbablyBlock.events==='object'
                        &&
                        typeof itsProbablyBlock.prevHash==='string'
                        &&
                        typeof itsProbablyBlock.sig==='string'
                        &&
                        itsProbablyBlock.index===index
                        &&
                        itsProbablyBlock.creator===blockCreator
                

                    if(overviewIsOk){
    
                        BLOCKLOG(`New \x1b[36m\x1b[41;1mblock\x1b[0m\x1b[32m  fetched  \x1b[31m——│`,'S',hash,48,'\x1b[31m',itsProbablyBlock)

                        SYMBIOTE_META.BLOCKS.put(blockID,itsProbablyBlock).catch(_=>{})
    
                        return itsProbablyBlock
    
                    }
    
                }
    
            }
            
        })
    
    )

},




/*

<SUPER_FINALIZATION_PROOF> is an aggregated proof from 2/3N+1 validators from quorum that they each have 2/3N+1 commitments from other validators

Once some validator receive 2/3N+1 commitments for some block PubX:Y:H(block Y with hash H created by validator PubX) he generate signature

    [+] SIG(blockID+hash+"FINALIZATION")

This signature will be included to some object which called <FINALIZATION_PROOF>


Struture => {

    blockID:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta:0",

    hash:"0123456701234567012345670123456701234567012345670123456701234567",
    
    validator:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta", //creator of FINALIZATION_PROOF

    finalization_signa:SIG(blockID+hash+"FINALIZATION")

}

Then, validators from quorum exchange with these proofs and once you have 2/3N+1 you can build SUPER_FINALIZATION_PROOF using aggregation

Structure => {
    
    blockID:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta:0",

    hash:"0123456701234567012345670123456701234567012345670123456701234567",

    aggregatedPub:"7cBETvyWGSvnaVbc7ZhSfRPYXmsTzZzYmraKEgxQMng8UPEEexpvVSgTuo8iza73oP",

    aggregatedSigna:"kffamjvjEg4CMP8VsxTSfC/Gs3T/MgV1xHSbP5YXJI5eCINasivnw07f/lHmWdJjC4qsSrdxr+J8cItbWgbbqNaM+3W4HROq2ojiAhsNw6yCmSBXl73Yhgb44vl5Q8qD",

    afkValidators:[]

}

********************************************** ONLY AFTER VERIFICATION OF SUPER_FINALIZATION_PROOF YOU CAN PROCESS THE BLOCK **********************************************

Verification process:

    Saying, you need to get proofs to add some block 1337th generated by validator Andy with hash "cafe..."

    Once you find the candidate for SUPER_FINALIZATION_PROOF , you should verify

        [+] let shouldAccept = await VERIFY(aggregatedPub,aggregatedSigna,"Andy:1337"+":cafe:"+"FINALIZATION")

            Also, check if QUORUM_AGGREGATED_PUB === AGGREGATE(aggregatedPub,afkValidators)

    If this both conditions is ok - then you can accept block with 100% garantee of irreversibility

*/
GET_SUPER_FINALIZATION_PROOF = async (blockID,blockHash) => {


    /*
    
        Check local cache if SUPER_FINALIZATION_PROOF exists. Will be returned object 

        {
            aggregatedSignature:<>, // blockID+hash+"FINALIZATION"
            aggregatedPub:<>,
            afkValidators
        }

    
    */

    if(SYMBIOTE_META.SUPER_FINALIZATION_PROOFS.has(blockID+'/'+blockHash)) return true
    
    //Go through known hosts and find SUPER_FINALIZATION_PROOF. Call /get_super_finalization route
    
    let quorumMembersURLs = [CONFIG.SYMBIOTE.GET_SUPER_FINALIZATION_PROOF_URL,...await GET_QUORUM_MEMBERS_URLS('QUORUM_THREAD')]


    //if we're in quorum - start to grab commitments => finalization_proofs => super finalization_proofs
    if(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM.includes(CONFIG.SYMBIOTE.PUB)){



    }


    for(let memberURL of quorumMembersURLs){

        let itsProbablySuperFinalizationProof = await fetch(memberURL+'/get_super_finalization/'+blockID+':'+blockHash).then(r=>r.json()).catch(_=>false),

            generalAndTypeCheck =   itsProbablySuperFinalizationProof
                                    &&
                                    typeof itsProbablySuperFinalizationProof.aggregatedPub === 'string'
                                    &&
                                    typeof itsProbablySuperFinalizationProof.aggregatedSigna === 'string'
                                    &&
                                    Array.isArray(itsProbablySuperFinalizationProof.afkValidators)

         
        if(generalAndTypeCheck){

            //Verify it before return

            let aggregatedSignatureIsOk = await VERIFY(blockID+blockHash+"FINALIZATION",itsProbablySuperFinalizationProof.aggregatedSigna,itsProbablySuperFinalizationProof.aggregatedPub),

                rootQuorumKeyIsEqualToProposed = SYMBIOTE_META.STUFF_CACHE.get('QUORUM_AGGREGATED_PUB') === bls.aggregatePublicKeys([itsProbablySuperFinalizationProof.aggregatedPub,...itsProbablySuperFinalizationProof.afkValidators]),

                quorumSize = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.QUORUM.length,

                majority = Math.floor(quorumSize*(2/3)+1)

            
            majority = majority > quorumSize ? quorumSize : majority
            
            let majorityVotedForThis = quorumSize-itsProbablySuperFinalizationProof.afkValidators.length >= majority

            if(aggregatedSignatureIsOk && rootQuorumKeyIsEqualToProposed && majorityVotedForThis){

                return true

            }

        }

    }

    //If we can't find - try next time

    return false

},


//SYMBIOTE_META.VERSION shows the real software version of appropriate workflow
//We use this function on VERIFICATION_THREAD and QUORUM_THREAD to make sure we can continue to work
//If major version was changed and we still has an old version - we should stop node and update software
IS_MY_VERSION_STILL_OK = newMajorVersionFromSpecOps => SYMBIOTE_META.VERSION >= newMajorVersionFromSpecOps,




PROPOSE_TO_SKIP=(validator,metaDataToFreeze)=>{

    

},




CHECK_IF_THE_SAME_DAY=(timestamp1,timestamp2)=>{

    let date1 = new Date(timestamp1),
        
        date2 = new Date(timestamp2)
    
    return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth() && date1.getDate() === date2.getDate()

},




WAIT_SOME_TIME=async()=>

    new Promise(resolve=>

        setTimeout(()=>resolve(),CONFIG.SYMBIOTE.WAIT_IF_CANT_FIND_CHECKPOINT)

    )
,




DELETE_VALIDATOR_POOLS=async validatorPubKey=>{

    //Try to get storage "POOL" of appropriate pool

    let poolStorage = await GET_FROM_STATE(validatorPubKey+'(POOL)_STORAGE_POOL')


    poolStorage.isStopped=true

    poolStorage.stopCheckpointID=SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID

    poolStorage.storedMetadata=SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[validatorPubKey]


    //Remove from VALIDATORS array(to prevent be elected to quorum) and metadata

    SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.splice(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.indexOf(validatorPubKey),1)

    delete SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[validatorPubKey]

},




//Function to find,validate and process logic with new checkpoint
SET_UP_NEW_CHECKPOINT=async()=>{

    //When we reach the limits of current checkpoint - then we need to do extra logic

    //Add extra logic to remove/add new validators, assign/reassign account to some thread, set QUORUM and so on


    let currentTimestamp = new Date().getTime(),//due to UTC timestamp format

        checkpointIsFresh = CHECK_IF_THE_SAME_DAY(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP*1000,currentTimestamp)


    //If checkpoint is not fresh - find "fresh" one on hostchain

    if(!checkpointIsFresh){


        let nextCheckpoint = await HOSTCHAIN.MONITOR.GET_VALID_CHECKPOINT('VERIFICATION_THREAD').catch(e=>{

            console.log(e)

        })


        if(nextCheckpoint) {

            
            let operations = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.OPERATIONS


            //_____________________________To change it via operations___________________________

            let workflowOptionsTemplate = {...SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS}
            
            SYMBIOTE_META.STATE_CACHE.set('WORKFLOW_OPTIONS',workflowOptionsTemplate)

            //___________________Create array of delayed unstaking transactions__________________

            SYMBIOTE_META.STATE_CACHE.set('DELAYED_OPERATIONS',[])

            //___________________Create array of delayed unstaking transactions__________________

            SYMBIOTE_META.STATE_CACHE.set('SLASH_OBJECT',{})

            //But, initially, we should execute the SLASH_UNSTAKE operations because we need to prevent withdraw of stakes by rogue pool(s)/stakers
            for(let operation of operations){
            
                if(operation.type==='SLASH_UNSTAKE') await OPERATIONS_VERIFIERS.SLASH_UNSTAKE(operation.payload) //pass isFromRoute=undefined to make changes to state
            
            }


            //Here we have the filled(or empty) array of pools and delayed IDs to delete it from state
            
            
            //____________________Go through the SPEC_OPERATIONS and perform it__________________

            for(let operation of operations){
        
                if(operation.type==='SLASH_UNSTAKE') continue

                /*
                
                Perform changes here before move to the next checkpoint
                
                OPERATION in checkpoint has the following structure

                {
                    type:<TYPE> - type from './operationsVerifiers.js' to perform this operation
                    payload:<PAYLOAD> - operation body. More detailed about structure & verification process here => ./operationsVerifiers.js
                }
                

                */

                await OPERATIONS_VERIFIERS[operation.type](operation.payload) //pass isFromRoute=undefined to make changes to state
        
            }


            //_______________________Remove pools if lack of staking power_______________________


            let toRemovePools = [], promises = []

            for(let validator of SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS){

                let promise = GET_FROM_STATE(validator+'(POOL)_STORAGE_POOL').then(poolStorage=>{

                    if(poolStorage.totalPower<SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.VALIDATOR_STAKE) toRemovePools.push(validator)

                })

                promises.push(promise)

            }

            await Promise.all(promises.splice(0))

            //Now in toRemovePools we have IDs of pools which should be deleted from VALIDATORS

            let deleteValidatorsPoolsPromises=[]

            for(let address of toRemovePools){

                deleteValidatorsPoolsPromises.push(DELETE_VALIDATOR_POOLS(address))

            }

            await Promise.all(deleteValidatorsPoolsPromises.splice(0))


            //________________________________Remove rogue pools_________________________________

            // These operations must be atomic
            let atomicBatch = SYMBIOTE_META.STATE.batch()

            let slashObject = await GET_FROM_STATE('SLASH_OBJECT'), slashObjectKeys = Object.keys(slashObject)
            
            for(let poolIdentifier of slashObjectKeys){

                //slashObject has the structure like this <pool> => <{delayedIds,pool}>
                atomicBatch.del(poolIdentifier+'(POOL)_STORAGE_POOL')

                let arrayOfDelayed = slashObject[poolIdentifier].delayedIds

                //Take the delayed operations array, move to cache and delete operations where pool === poolIdentifier
                for(let id of arrayOfDelayed){

                    let delayedArray = await GET_FROM_STATE('DEL_OPER_'+id)

                    // Each object in delayedArray has the following structure {fromPool,to,amount,units}
                    let toDeleteArray = []

                    for(let i=0;i<delayedArray.length;i++){

                        if(delayedArray[i].fromPool===poolIdentifier) toDeleteArray.push(i)

                    }

                    // Here <toDeleteArray> contains id's of UNSTAKE operations that should be deleted

                    for(let txid of delayedArray) delayedArray.splice(txid,1) //remove single tx

                }


            }


            //______________Perform earlier delayed operations & add new operations______________

            let delayedTableOfIds = await GET_FROM_STATE('DELAYED_TABLE_OF_IDS')

            //If it's first checkpoints - add this array
            if(!delayedTableOfIds) delayedTableOfIds=[]

            
            let currentCheckpointID = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.HEADER.ID ,
            
                idsToDelete = []


            for(let i=0, lengthOfTable = delayedTableOfIds.length ; i < lengthOfTable ; i++){

                //Here we get the arrays of delayed operatins from state and perform those, which is old enough compared to WORKFLOW_OPTIONS.UNSTAKING_PERIOD

                if(delayedTableOfIds[i] + SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.UNSTAKING_PERIOD < currentCheckpointID){

                    let oldDelayOperations = await GET_FROM_STATE('DEL_OPER_'+delayedTableOfIds[i])

                    if(oldDelayOperations){

                        for(let delayedTX of oldDelayOperations){

                            /*

                                Get the accounts and add appropriate amount of KLY / UNO

                                delayedTX has the following structure

                                {
                                    fromPool:<id of pool that staker withdraw stake from>,

                                    to:<staker pubkey/address>,
                        
                                    amount:<number>,
                        
                                    units:< KLY | UNO >
                        
                                }
                            
                            */

                            let account = await GET_ACCOUNT_ON_SYMBIOTE(delayedTX.to)

                            //Return back staked KLY / UNO to the state of user's account
                            if(delayedTX.units==='KLY') account.balance += delayedTX.amount

                            else account.uno += delayedTX.amount
                            

                        }


                        //Remove ID (delayedID) from delayed table of IDs because we already used it
                        idsToDelete.push(i)

                    }

                }

            }

            //Remove "spent" ids
            for(let id of idsToDelete) delayedTableOfIds.splice(id,1)



            //Also, add the array of delayed operations from THIS checkpoint if it's not empty
            let currentArrayOfDelayedOperations = await GET_FROM_STATE('DELAYED_OPERATIONS')
            
            if(currentArrayOfDelayedOperations.length !== 0){

                delayedTableOfIds.push(currentCheckpointID)

                SYMBIOTE_META.STATE_CACHE.set('DEL_OPER_'+currentCheckpointID,currentArrayOfDelayedOperations)

            }

            //_______________________Commit changes after operations here________________________

            //Updated WORKFLOW_OPTIONS
            SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS={...workflowOptionsTemplate}

            //Set new checkpoint
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT=nextCheckpoint


            //Create new quorum based on new VALIDATORS_METADATA state
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.QUORUM = GET_QUORUM('VERIFICATION_THREAD')


            SYMBIOTE_META.STATE_CACHE.forEach(
                
                (value,recordID) => atomicBatch.put(recordID, value)
                
            )

            atomicBatch.put('VT',SYMBIOTE_META.VERIFICATION_THREAD)

            await atomicBatch.write()


        }

        else {

            //Even if we can't find new valid checkpoint and current checkpoint is non fresh - mark it as completed
            SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED=true

            LOG(`Going to wait for next checkpoint, because current is non-fresh and no new checkpoint found. No sense to spam. Wait ${CONFIG.SYMBIOTE.WAIT_IF_CANT_FIND_CHECKPOINT/1000} seconds ...`,'I')

            await WAIT_SOME_TIME()

        }
    
    }else{

        //If we reach the limits of checkpoint but it's still fresh - then mark it as "completed"
        SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED=true

    }

},




START_VERIFICATION_THREAD=async()=>{

    //This option will stop workflow of verification for each symbiote
    
    if(!SYSTEM_SIGNAL_ACCEPTED){

        THREADS_STILL_WORKS.VERIFICATION=true

        //_______________________________ Check if we reach checkpoint stats to find out next one and continue work on VT _______________________________

        let currentValidatorsMetadataHash = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA)),

            validatorsMetadataHashFromCheckpoint = BLAKE3(JSON.stringify(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.VALIDATORS_METADATA))


        //If we reach the limits of current checkpoint - find another one. In case there are no more checkpoints - mark current checkpoint as "completed"
        if(currentValidatorsMetadataHash === validatorsMetadataHashFromCheckpoint || SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED) await SET_UP_NEW_CHECKPOINT()



        //Updated checkpoint on previous step might be old or fresh,so we should update the variable state

        let updatedIsFreshCheckpoint = CHECK_IF_THE_SAME_DAY(SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.TIMESTAMP*1000,new Date().getTime())


        /*

            ! Glossary - SUPER_FINALIZATION_PROOF on high level is proof that for block Y created by validator PubX with hash H exists at least 2/3N+1 validators who has 2/3N+1 commitments for this block

                [+] If our current checkpoint are "too old", no sense to find SUPER_FINALIZATION_PROOF. Just find & process block
        
                [+] If latest checkpoint was created & published on hostchains(primary and other hostchains via HiveMind) we should find SUPER_FINALIZATION_PROOF to proceed the block
        

        */
        

        let prevValidatorWeChecked = SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR,

            validatorsPool=SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS,

            //take the next validator in a row. If it's end of validators pool - start from the first validator in array
            currentValidatorToCheck = validatorsPool[validatorsPool.indexOf(prevValidatorWeChecked)+1] || validatorsPool[0],

            //We receive {INDEX,HASH,ACTIVE} - it's data from previously checked blocks on this validators' track. We're going to verify next block(INDEX+1)
            currentSessionMetadata = SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[currentValidatorToCheck],

            blockID = currentValidatorToCheck+":"+(currentSessionMetadata.INDEX+1),

            //take the next validator in a row. If it's end of validators pool - start from the first validator
            nextValidatorToCheck=validatorsPool[validatorsPool.indexOf(currentValidatorToCheck)+1] || validatorsPool[0],

            nextBlock,//to verify next block ASAP if it's available

            shouldSkip = false


        //If current validator was marked as "offline" or AFK - skip his blocks till his activity signals
        //Change the state of validator activity only via checkpoints
        if(currentSessionMetadata.FREEZED){

            /*
            
                Here we do everything to skip this block and move to the next validator's block
                        
                If 2/3+1 validators have voted to "skip" block - we take the "NEXT+1" block and continue work in verification thread
                    
                Here we just need to change finalized pointer to imitate that "skipped" block was successfully checked and next validator's block should be verified(in the next iteration)

            */

                
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR=currentValidatorToCheck

            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                    
            SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'


        }else {

            //If block creator is active and produce blocks or it's non-fresh checkpoint - we can get block and process it

            let block = await GET_BLOCK(currentValidatorToCheck,currentSessionMetadata.INDEX+1),

                blockHash = block && Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash),

                quorumSolutionToVerifyBlock = false, //by default

                currentBlockPresentInCurrentCheckpoint = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.PAYLOAD.VALIDATORS_METADATA[currentValidatorToCheck].INDEX > currentSessionMetadata.INDEX,

                checkPointCompleted  = SYMBIOTE_META.VERIFICATION_THREAD.CHECKPOINT.COMPLETED
        
            
            //We can simplify this branch

            if(currentBlockPresentInCurrentCheckpoint) quorumSolutionToVerifyBlock = true
            
            else if(updatedIsFreshCheckpoint && checkPointCompleted && !currentBlockPresentInCurrentCheckpoint) quorumSolutionToVerifyBlock = await GET_SUPER_FINALIZATION_PROOF(blockID,blockHash)
        
            else if(!currentBlockPresentInCurrentCheckpoint && !checkPointCompleted) {

                //if no sush block in current uncompleted checkpoint - then we need to skip it.
                shouldSkip = true

            }

            let pointerThatVerificationWasSuccessful = currentSessionMetadata.INDEX+1 //if the id will be increased - then the block was verified and we can move on 

            //We skip the block if checkpoint is not completed and no such block in checkpoint
            //No matter if checkpoint is fresh or not
            if(shouldSkip){

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR=currentValidatorToCheck

                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=currentSessionMetadata.INDEX+1
                                        
                SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH='Sleep,the brother of Death @ Homer'

            }else if(block && quorumSolutionToVerifyBlock){

                await verifyBlock(block)
            
                //Signal that verification was successful
                if(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[currentValidatorToCheck].INDEX===pointerThatVerificationWasSuccessful){
                
                    nextBlock=await GET_BLOCK(nextValidatorToCheck,SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[nextValidatorToCheck].INDEX+1)
                
                }
                    
                // If verification failed - delete block. It will force to find another(valid) block from network
                // else SYMBIOTE_META.BLOCKS.del(currentValidatorToCheck+':'+(currentSessionMetadata.INDEX+1)).catch(e=>{})
                
            }

        }


        if(CONFIG.SYMBIOTE.STOP_VERIFY) return//step over initiation of another timeout and this way-stop the Verification Thread

        //If next block is available-instantly start perform.Otherwise-wait few seconds and repeat request
        setTimeout(START_VERIFICATION_THREAD,(nextBlock||shouldSkip||currentSessionMetadata.FREEZED)?0:CONFIG.SYMBIOTE.VERIFICATION_THREAD_POLLING_INTERVAL)

        
        //Probably no sense to stop polling via .clearTimeout()
        //UPD:Do it to provide dynamic functionality to start/stop Verification Thread
        
        THREADS_STILL_WORKS.VERIFICATION=false

    
    }else{

        LOG(`Polling for \x1b[32;1m${SYMBIOTE_ALIAS()}\x1b[36;1m was stopped`,'I',CONFIG.SYMBIOTE.SYMBIOTE_ID)

        SIG_PROCESS.VERIFY=true

    }

},




MAKE_SNAPSHOT=async()=>{

    let {SNAPSHOT,STATE,VERIFICATION_THREAD}=SYMBIOTE_META//get appropriate dbs & descriptors of symbiote


    //_____________________________________________________Now we can make snapshot_____________________________________________________

    LOG(`Start making snapshot for ${SYMBIOTE_ALIAS()}`,'I')

    
    //Init atomic descriptor
    let atomicBatch = SNAPSHOT.batch()

    //Check if we should do full or partial snapshot.See https://github.com/KLYN74R/CIIPs
    if(CONFIG.SYMBIOTE.SNAPSHOTS.ALL){
        
        await new Promise(
        
            resolve => STATE.createReadStream()
            
                            .on('data',data=>atomicBatch.put(data.key,data.value))//add state of each account to snapshot dbs
            
                            .on('close',resolve)
            
        ).catch(error=>{
    
                LOG(`Snapshot creation failed on state copying stage for ${SYMBIOTE_ALIAS()}\n${error}`,'W')
                
                process.emit('SIGINT',130)
    
            })

    }else{

        //Read only part of state to make snapshot for backups
        //Set your own policy of backups with your other nodes,infrastructure etc.
        let choosen=JSON.parse(process.env.SNAPSHOTS_PATH+`/separation/${CONFIG.SYMBIOTE.SYMBIOTE_ID}.json`),
        
            getPromises=[]


        choosen.forEach(
            
            recordId => getPromises.push(
                
                STATE.get(recordId).then(
                    
                    acc => atomicBatch.put(recordId,acc)
                    
                )
                
            )
            
        )

        await Promise.all(getPromises.splice(0)).catch( e => {
    
            LOG(`Snapshot creation failed on getting choosen records for ${SYMBIOTE_ALIAS()}\n${e}`,'W')
            
            process.emit('SIGINT',130)

        })
        

    }
    



    await atomicBatch.write()
    
        .then(()=>LOG(`Snapshot was successfully created for \x1b[36;1m${SYMBIOTE_ALIAS()}\x1b[32;1m on point \x1b[36;1m${VERIFICATION_THREAD.FINALIZED_POINTER.HASH} ### ${VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR}:${VERIFICATION_THREAD.FINALIZED_POINTER.INDEX}`,'S'))
        
        .catch(error=>{

            LOG(`Snapshot creation failed for ${SYMBIOTE_ALIAS()}\n${error}`,'W')
        
            process.emit('SIGINT',130)

        })


},




SHARE_FEES_AMONG_STAKERS=async(poolId,feeToPay)=>{

    let mainStorageOfPool = await GET_FROM_STATE_FOR_QUORUM_THREAD(poolId+'(POOL)_STORAGE_POOL')

    if(mainStorageOfPool.percentage!==0){

        //Get the pool percentage and send to appropriate BLS address
        let poolBindedBLSPubKey = await GET_ACCOUNT_ON_SYMBIOTE(poolId)

        poolBindedBLSPubKey.balance += mainStorageOfPool.percentage*feeToPay
        
    }

    let restOfFees = feeToPay - mainStorageOfPool.percentage*feeToPay

    //Iteration over the {KLY,UNO,REWARD}
    Object.values(mainStorageOfPool.STAKERS).forEach(stakerStats=>{

        let stakerTotalPower = stakerStats.UNO + stakerStats.KLY

        let totalStakerPowerPercent = stakerTotalPower/mainStorageOfPool.totalPower

        stakerStats.REWARD+=totalStakerPowerPercent*restOfFees

    })

},




//Function to distribute stakes among validators/blockCreator/staking pools
DISTRIBUTE_FEES=async(totalFees,blockCreator)=>{

    /*

        _____________________Here we perform the following logic_____________________

        [*] totalFees - number of total fees received in this block



        1) Take all the validators from SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS

        2) Send REWARD_PERCENTAGE_FOR_BLOCK_CREATOR * totalFees to block creator

        3) Distribute the rest among all the other validators(excluding block creator)

            For this, we should:

            3.1) Take the pool storage from state by id = validatorPubKey+'(POOL)_STORAGE_POOL'

            3.2) Run the cycle over the POOL.STAKERS(structure is STAKER_PUBKEY => {KLY,UNO,REWARD}) and increase reward by FEES_FOR_THIS_VALIDATOR * ( STAKER_POWER_IN_UNO / TOTAL_POOL_POWER )

    
    */

    let payToCreatorAndHisPool = totalFees * SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.REWARD_PERCENTAGE_FOR_BLOCK_CREATOR, //the bigger part is usually for block creator

        payToEachPool = Math.floor((totalFees - payToCreatorAndHisPool)/(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.length-1)), //and share the rest among other validators
    
        shareFeesPromises = []

          
    if(SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.length===1) payToEachPool = totalFees - payToCreatorAndHisPool


    //___________________________________________ BLOCK_CREATOR ___________________________________________

    shareFeesPromises.push(SHARE_FEES_AMONG_STAKERS(blockCreator,payToCreatorAndHisPool))

    //_____________________________________________ THE REST ______________________________________________

    SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.forEach(poolPubKey=>

        poolPubKey !== blockCreator && shareFeesPromises.push(SHARE_FEES_AMONG_STAKERS(poolPubKey,payToEachPool))
            
    )
     
    await Promise.all(shareFeesPromises.splice(0))

},




verifyBlock=async block=>{


    let blockHash=Block.genHash(block.creator,block.time,block.events,block.index,block.prevHash),


    overviewOk=
    
        block.events?.length<=SYMBIOTE_META.VERIFICATION_THREAD.WORKFLOW_OPTIONS.EVENTS_LIMIT_PER_BLOCK
        &&
        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[block.creator].HASH === block.prevHash//it should be a chain
        &&
        await VERIFY(blockHash,block.sig,block.creator)


    // if(block.i === CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT && blockHash !== CONFIG.SYMBIOTE.SYMBIOTE_CHECKPOINT.HEIGHT){

    //     LOG(`SYMBIOTE_CHECKPOINT verification failed. Delete the CHAINDATA/BLOCKS,CHAINDATA/METADATA,CHAINDATA/STATE and SNAPSHOTS. Resync node with the right blockchain or load the true snapshot`,'F')

    //     LOG('Going to stop...','W')

    //     process.emit('SIGINT')

    // }


    if(overviewOk){


        //To calculate fees and split between validators.Currently - general fees sum is 0. It will be increased each performed transaction
        let rewardBox={fees:0}


        //To change the state atomically
        let atomicBatch = SYMBIOTE_META.STATE.batch()

        //_________________________________________GET ACCOUNTS FROM STORAGE____________________________________________
        
        let sendersAccounts=[]
    
        //Push accounts of validators
        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS.forEach(pubKey=>sendersAccounts.push(GET_ACCOUNT_ON_SYMBIOTE(pubKey)))

        //Now cache has all accounts and ready for the next cycles
        await Promise.all(sendersAccounts.splice(0))


        //___________________________________________START TO PERFORM EVENTS____________________________________________

        for(let event of block.events){

            if(SYMBIOTE_META.VERIFIERS[event.type]) await SYMBIOTE_META.VERIFIERS[event.type](event,rewardBox,atomicBatch)

        }

        //__________________________________________SHARE FEES AMONG VALIDATORS_________________________________________
        
        await DISTRIBUTE_FEES(rewardBox.fees,block.creator)


        //Probably you would like to store only state or you just run another node via cloud module and want to store some range of blocks remotely
        if(CONFIG.SYMBIOTE.STORE_BLOCKS){
            
            //No matter if we already have this block-resave it

            SYMBIOTE_META.BLOCKS.put(block.creator+":"+block.index,block).catch(error=>LOG(`Failed to store block ${block.index} on ${SYMBIOTE_ALIAS()}\nError:${error}`,'W'))

        }else{

            //...but if we shouldn't store and have it locally(received probably by range loading)-then delete
            SYMBIOTE_META.BLOCKS.del(block.creator+":"+block.index).catch(
                
                e => LOG(`Failed to delete block ${block.index} on ${SYMBIOTE_ALIAS()}\nError:${e}`,'W')
                
            )

        }


        //________________________________________________COMMIT STATE__________________________________________________    


        SYMBIOTE_META.STATE_CACHE.forEach((account,addr)=>

            atomicBatch.put(addr,account)

        )
        
        if(SYMBIOTE_META.STATE_CACHE.size>=CONFIG.SYMBIOTE.BLOCK_TO_BLOCK_CACHE_SIZE) SYMBIOTE_META.STATE_CACHE.clear()//flush cache.NOTE-some kind of advanced upgrade soon



        //Change finalization pointer
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.VALIDATOR=block.creator

        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.INDEX=block.index
                
        SYMBIOTE_META.VERIFICATION_THREAD.FINALIZED_POINTER.HASH=blockHash

        
        //Change metadata per validator's thread
        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[block.creator].INDEX=block.index

        SYMBIOTE_META.VERIFICATION_THREAD.VALIDATORS_METADATA[block.creator].HASH=blockHash


        //Finally - decrease the counter to snapshot
        SYMBIOTE_META.VERIFICATION_THREAD.SNAPSHOT_COUNTER--

        let snapCounter=SYMBIOTE_META.VERIFICATION_THREAD.SNAPSHOT_COUNTER


        //Fix the state of VERIFICATION_THREAD
        atomicBatch.put('VT',SYMBIOTE_META.VERIFICATION_THREAD)

        await atomicBatch.write()
        

        //__________________________________________CREATE SNAPSHOT IF YOU NEED_________________________________________


        block.index!==0//no sense to snaphost if no blocks yet
        &&
        CONFIG.SYMBIOTE.SNAPSHOTS.ENABLE//probably you don't won't to make snapshot on this machine
        &&
        snapCounter===0//if it's time to make snapshot(e.g. next 200th block generated)
        &&
        await MAKE_SNAPSHOT()


    }

}