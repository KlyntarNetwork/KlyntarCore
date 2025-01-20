/* eslint-disable no-unused-vars */

import { getFromState, getUserAccountFromState, trackStateChange } from "../../common_functions/state_interactions.js"

import { getFromApprovementThreadState } from "../../common_functions/approvement_thread_related.js"

import { BLOCKCHAIN_DATABASES, GLOBAL_CACHES, WORKING_THREADS } from "../../globals.js"

import { KLY_EVM } from "../../../../KLY_VirtualMachines/kly_evm/vm.js"

import { BLOCKCHAIN_GENESIS } from "../../../../klyn74r.js"



export let CONTRACT_FOR_DELAYED_TRANSACTIONS = {


    /*
    

    delayedTransaction is:

    {
        type:'createStakingPool',
        
        creator: transaction.creator,

        originShard, percentage, poolURL, wssPoolURL
    }
    
    
    */
    createStakingPool:async (threadContext,delayedTransaction) => {

        let {creator,originShard,percentage,poolURL,wssPoolURL} = delayedTransaction

        let typeCheckIsOk = typeof poolURL === 'string' && typeof wssPoolURL === 'string'

        let percentageIsOk = Number.isInteger(percentage) && percentage >= 0 && percentage <= 100

        if(typeCheckIsOk && percentageIsOk){

            let contractMetadataTemplate = {

                type:'contract',
                lang:'system/staking/sub',
                balance:'0',
                gas:0,
                storages:['POOL'],
                storageAbstractionLastPayment:0

            }

            let onlyOnePossibleStorageForStakingContract = {

                activated: true,
                
                percentage,

                totalStakedKly: '0',

                totalStakedUno: '0',

                shard: originShard,

                stakers:{}, // Pubkey => {kly,uno}

                poolURL,

                wssPoolURL

            }

            // Add the pool creator to stakers, but with zero amount of assets => {kly:0,uno:0}

            onlyOnePossibleStorageForStakingContract.stakers[creator] = {kly:'0',uno:'0'}

            if(threadContext === 'APPROVEMENT_THREAD'){

                let poolAlreadyExists = await BLOCKCHAIN_DATABASES.APPROVEMENT_THREAD_METADATA.get(creator+'(POOL)_STORAGE_POOL').catch(()=>null)

                if(!poolAlreadyExists){

                    // Put storage
                    // NOTE: We just need a simple storage with ID="POOL"
                
                    GLOBAL_CACHES.APPROVEMENT_THREAD_CACHE.set(creator+'(POOL)_STORAGE_POOL',onlyOnePossibleStorageForStakingContract)

                } else return {isOk:false}

            } else {

                let poolAlreadyExists = await BLOCKCHAIN_DATABASES.STATE.get(originShard+':'+creator+'(POOL)').catch(()=>null)

                if(!poolAlreadyExists){

                    // Put metadata and default storage
                    
                    GLOBAL_CACHES.STATE_CACHE.set(originShard+':'+creator+'(POOL)',contractMetadataTemplate)

                    GLOBAL_CACHES.STATE_CACHE.set(originShard+':'+creator+'(POOL)_STORAGE_POOL',onlyOnePossibleStorageForStakingContract)


                    trackStateChange(originShard+':'+creator+'(POOL)',1,'put')

                    trackStateChange(originShard+':'+creator+'(POOL)_STORAGE_POOL',1,'put')


                } else return {isOk:false}

            }

            return {isOk:true}

        } else return {isOk:false}

    },



    /*
    

    delayedTransaction is:

    {
        type:'updateStakingPool',
        
        creator: transaction.creator,

        originShard, activated, percentage, poolURL, wssPoolURL
    }
    
    */
    updateStakingPool:async (threadContext,delayedTransaction) => {

        let {creator,activated,percentage,poolURL,wssPoolURL} = delayedTransaction

        let typeCheckIsOk = typeof poolURL === 'string' && typeof wssPoolURL === 'string' && typeof activated === 'boolean'

        let percentageIsOk = Number.isInteger(percentage) && percentage >= 0 && percentage <= 100

        if(typeCheckIsOk && percentageIsOk){

            let poolStorage

            if(threadContext === 'APPROVEMENT_THREAD'){

                poolStorage = await getFromApprovementThreadState(creator+'(POOL)_STORAGE_POOL').catch(()=>null)

                if(poolStorage){

                    // Update values

                    poolStorage.activated = activated

                    poolStorage.percentage = percentage

                    poolStorage.poolURL = poolURL

                    poolStorage.wssPoolURL = wssPoolURL


                } else return {isOk:false}

            } else {

                poolStorage = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+creator+'(POOL)_STORAGE_POOL').catch(()=>null)

                if(poolStorage){

                    poolStorage.activated = activated

                    poolStorage.percentage = percentage

                    poolStorage.poolURL = poolURL

                    poolStorage.wssPoolURL = wssPoolURL

                } else return {isOk:false}

            }

            let threadById = threadContext === 'APPROVEMENT_THREAD' ? WORKING_THREADS.APPROVEMENT_THREAD : WORKING_THREADS.VERIFICATION_THREAD

            if(poolStorage){

                if(poolStorage.activated){

                    // Check if pool has enough power to be added to pools registry

                    let enoughToBeValidator = BigInt(poolStorage.totalStakedKly) >= BigInt(threadById.NETWORK_PARAMETERS.VALIDATOR_STAKE)

                    if(enoughToBeValidator && !threadById.EPOCH.poolsRegistry.includes(creator)){

                        threadById.EPOCH.poolsRegistry.push(creator)

                    }

                } else {

                    // Just remove the pool from registry

                    if(threadById.EPOCH.poolsRegistry.includes(creator)){

                        let indexOfPool = threadById.EPOCH.poolsRegistry.indexOf(creator)

                        threadById.EPOCH.poolsRegistry.splice(indexOfPool, 1)

                    }

                }

                return {isOk:true}
                
            } else return {isOk:false,reason:'No such pool'}

        } else return {isOk:false}

    },
    

    /*
    
    delayedTransaction is:

    {
        type:'stake',

        staker: transaction.creator,

        poolPubKey, amount
    }
    
    */
    stake:async(threadContext,delayedTransaction) => {

        let {staker,poolPubKey,amount} = delayedTransaction

        let poolStorage

        if(threadContext === 'APPROVEMENT_THREAD'){

            poolStorage = await getFromApprovementThreadState(poolPubKey+'(POOL)_STORAGE_POOL')

        } else {
        
            poolStorage = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+poolPubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        }

        let threadById = threadContext === 'APPROVEMENT_THREAD' ? WORKING_THREADS.APPROVEMENT_THREAD : WORKING_THREADS.VERIFICATION_THREAD

        let toReturn

        if(poolStorage){

            poolStorage.totalStakedKly = BigInt(poolStorage.totalStakedKly)

            amount = BigInt(amount)

            let amountIsBiggerThanMinimalStake = amount >= BigInt(threadById.NETWORK_PARAMETERS.MINIMAL_STAKE_PER_ENTITY)

            // Here we also need to check if pool is still not fullfilled

            if(amountIsBiggerThanMinimalStake){

                if(!poolStorage.stakers[staker]) poolStorage.stakers[staker] = {kly:0n, uno:0n}

                
                poolStorage.stakers[staker].kly = BigInt(poolStorage.stakers[staker].kly) + amount

                poolStorage.totalStakedKly += amount

                // Check if pool has enough power to be added to pools registry

                let hasEnoughPower = poolStorage.totalStakedKly >= BigInt(threadById.NETWORK_PARAMETERS.VALIDATOR_STAKE)

                if(poolStorage.activated && hasEnoughPower && !threadById.EPOCH.poolsRegistry.includes(poolPubKey)){

                    threadById.EPOCH.poolsRegistry.push(poolPubKey)

                }

                let amountAsNumber = Number(amount / (BigInt(10)**BigInt(18)))

                WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalKlyStaked += amountAsNumber
                        
                WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.totalKlyStaked += amountAsNumber

                toReturn = {isOk:true}

            } else toReturn = {isOk:false,reason:'Overview failed'}

        } else toReturn = {isOk:false,reason:'No such pool'}


        if(!toReturn.isOk){

            // Return the stake 

            if(staker.startsWith('0x') && staker.length === 42){

                // Return the stake back tp EVM account

                let recipientAccount = await KLY_EVM.getAccount(staker)

                recipientAccount.balance += amount

                await KLY_EVM.updateAccount(staker,recipientAccount)


            } else {

                let txCreatorAccount = await getUserAccountFromState(BLOCKCHAIN_GENESIS.SHARD+':'+staker)

                if(txCreatorAccount){
        
                    txCreatorAccount.balance += amount
    
                }    

            }

        }

        return toReturn

    },


    /*
    
    delayedTransaction is:

    {
        type:'unstake',

        unstaker: transaction.creator,

        poolPubKey, amount
    }
    
    */
    unstake:async (threadContext,delayedTransaction) => {

        let {unstaker,poolPubKey,amount} = delayedTransaction

        let poolStorage


        if(threadContext === 'APPROVEMENT_THREAD'){

            poolStorage = await getFromApprovementThreadState(poolPubKey+'(POOL)_STORAGE_POOL')

        } else {

            poolStorage = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+poolPubKey+'(POOL)_STORAGE_POOL').catch(()=>null)

        }

        if(poolStorage){

            let unstakerAccount = poolStorage.stakers[unstaker]

            if(unstakerAccount){

                unstakerAccount.kly = BigInt(unstakerAccount.kly)

                amount = BigInt(amount)

                poolStorage.totalStakedKly = BigInt(poolStorage.totalStakedKly)


                let threadById = threadContext === 'APPROVEMENT_THREAD' ? WORKING_THREADS.APPROVEMENT_THREAD : WORKING_THREADS.VERIFICATION_THREAD

                if(unstakerAccount.kly >= amount){

                    unstakerAccount.kly -= amount

                    poolStorage.totalStakedKly -= amount

                    if(unstakerAccount.kly === 0n && BigInt(unstakerAccount.uno) === 0){

                        delete poolStorage.stakers[unstaker] // just to make pool storage more clear

                    }

                    if(threadContext === 'VERIFICATION_THREAD'){

                        // Pay back to staker

                        if(unstaker.startsWith('0x') && unstaker.length === 42){

                            // Return the stake back tp EVM account
            
                            let unstakerEvmAccount = await KLY_EVM.getAccount(unstaker)
            
                            unstakerEvmAccount.balance += BigInt(amount)
            
                            await KLY_EVM.updateAccount(unstaker,unstakerEvmAccount)
            
            
                        } else {

                            let unstakerAccount = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+unstaker)
    
                            if(unstakerAccount){
    
                                unstakerAccount.balance += amount
            
                            }    

                        }

                        let amountAsNumber = Number(amount / (BigInt(10)**BigInt(18)))

                        WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalKlyStaked -= amountAsNumber
                        
                        WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.totalKlyStaked -= amountAsNumber
    
                    }

                }

                // Check if pool has not enough power to be at pools registry

                if(poolStorage.totalStakedKly < BigInt(threadById.NETWORK_PARAMETERS.VALIDATOR_STAKE) && threadById.EPOCH.poolsRegistry.includes(poolPubKey)){

                    // Remove from registry

                    let indexOfThisPool = threadById.EPOCH.poolsRegistry.indexOf(poolPubKey)

                    threadById.EPOCH.poolsRegistry.splice(indexOfThisPool, 1)

                }

            } else return {isOk:false,reason:`Impossbile to unstake because tx.creator not a staker`}

        } else return {isOk:false,reason:'No such pool'}

    },


    /*
    

    delayedTransaction is:
    
    {

        type:'changeUnobtaniumAmount',

        targetPool, changesPerAccounts

    }
    
    
    */
    changeUnobtaniumAmount:async (threadContext,delayedTransaction)=>{

        let {targetPool,changesPerAccounts} = delayedTransaction

        let poolStorage


        if(threadContext === 'APPROVEMENT_THREAD'){

            poolStorage = await getFromApprovementThreadState(targetPool+'(POOL)_STORAGE_POOL')

        } else {
        
            poolStorage = await getFromState(BLOCKCHAIN_GENESIS.SHARD+':'+targetPool+'(POOL)_STORAGE_POOL').catch(()=>null)

        }

        if(poolStorage){

            let generalUnoChange = 0n

            poolStorage.totalStakedUno = BigInt(poolStorage.totalStakedUno)

            for(let [staker,valueOfUnoWei] of Object.entries(changesPerAccounts)){

                let bigIntUnoWei = BigInt(valueOfUnoWei)

                if(!poolStorage.stakers[staker]) poolStorage.stakers[staker] = {kly:0, uno:0}
                
                poolStorage.stakers[staker] = {

                    kly:BigInt(poolStorage.stakers[staker].kly),
                    uno:BigInt(poolStorage.stakers[staker].uno)

                }

                poolStorage.stakers[staker].uno += bigIntUnoWei

                if(poolStorage.stakers[staker].uno < 0n) poolStorage.stakers[staker].uno = 0n

                if(poolStorage.stakers[staker].kly === 0n && poolStorage.stakers[staker].uno === 0n){

                    delete poolStorage.stakers[staker] // just to make pool storage more clear

                }
                
                generalUnoChange += bigIntUnoWei

            }

            // Finally modify the general UNO amount for pool

            poolStorage.totalStakedUno += generalUnoChange

            let generalUnoChangeAsNumber = Number(generalUnoChange / (BigInt(10)**BigInt(18)))
            
            WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalUnoStaked += generalUnoChangeAsNumber
                        
            WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.totalUnoStaked += generalUnoChangeAsNumber

            
            return {isOk:true}

        } else return {isOk:false,reason:'No such pool'}

    }

}