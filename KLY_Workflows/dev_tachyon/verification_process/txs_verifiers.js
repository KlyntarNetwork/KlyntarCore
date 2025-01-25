/* eslint-disable no-unused-vars */
import {getUserAccountFromState, getFromState, trackStateChange} from '../common_functions/state_interactions.js'

import * as functionsToInjectToVm from '../../../KLY_VirtualMachines/common_modules.js'

import {verifyQuorumMajoritySolution} from '../common_functions/work_with_proofs.js'

import {BLOCKCHAIN_DATABASES, GLOBAL_CACHES, WORKING_THREADS} from '../globals.js'

import {KLY_EVM} from '../../../KLY_VirtualMachines/kly_evm/vm.js'

import {WVM} from '../../../KLY_VirtualMachines/kly_wvm/vm.js'

import {SYSTEM_CONTRACTS} from '../system_contracts/root.js'

import {blake3Hash} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyn74r.js'

import {TXS_FILTERS} from './txs_filters.js'

import web3 from 'web3'






let getCostPerSignatureType = transaction => {

    if(transaction.sigType==='D') return 5000n
    
    if(transaction.sigType==='T') return 10000n

    if(transaction.sigType==='P/D') return 15000n

    if(transaction.sigType==='P/B') return 15000n

    if(transaction.sigType==='M') return 7000n + BigInt(transaction.payload.afk.length) * 1000n

    return 0n

}


// Load required functions and inject to smart contract

let getFunctionsToInject = (arrayOfImports,contractHandlerToBind) => {

    // function injected into contract should be injected from <klyntar> module

    let templateToReturn = { klyntar:{} }

    for(let funcName of arrayOfImports){

        templateToReturn.klyntar[funcName] = functionsToInjectToVm[funcName].bind(contractHandlerToBind) // need binding to increase gas counter from injected functions and for other purposes

    }

    return templateToReturn

}





let performStakingActionsForEVM = async (txCreator,transferValue,parsedData) => {


    /*
                        
        We should pass data like this:

        {

            contractID'system/staking',
                                
            method:'stake | unstake,

            poolPubKey:<Format is Ed25519_pubkey>,
                                
            amount:<amount in wei>,
                            
        }
                        
    */

    let {method,poolPubKey,amount} = parsedData


    if(method === 'stake'){

        if(typeof poolPubKey === 'string' && typeof amount === 'string' && amount === transferValue){
            
            // Now add it to delayed operations

            let overNextEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id+2

            let delayedTransactions = await getFromState(`DELAYED_TRANSACTIONS:${overNextEpochIndex}`) // should be array of delayed operations

            
            let templateToPush = { type:'stake', staker: txCreator, poolPubKey, amount }


            delayedTransactions.push(templateToPush)

            return {isOk:true,reason:'EVM'}

        } else return {isOk:false, reason: `EVM`}

    } else if(method === 'unstake') {

        if(typeof poolPubKey === 'string' && typeof amount === 'string'){

            // Now add it to delayed operations

            let overNextEpochIndex = WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id+2

            let delayedTransactions = await getFromState(`DELAYED_TRANSACTIONS:${overNextEpochIndex}`) // should be array of delayed operations

            
            let templateToPush = { type:'unstake', unstaker: txCreator, poolPubKey, amount }

            
            delayedTransactions.push(templateToPush)

            return {isOk:true,reason:'EVM'}

        } else return {isOk:false, reason: `EVM`}

    }

}




let trackTransactionsList=async(txid,txType,sigType,fee,touchedAccounts)=>{

    // Function to allow to fill the list of transaction per address

    let dataToPush = {txid,txType,sigType,fee}


    for(let account of touchedAccounts){

        let txsListForAccount = await BLOCKCHAIN_DATABASES.EXPLORER_DATA.get(`TXS_TRACKER:${account}`).catch(()=>[])

        txsListForAccount.push(dataToPush)

        // Limit only for last 200 txs

        if (txsListForAccount.length > 200) {

            txsListForAccount = txsListForAccount.slice(-200)

        }

        await BLOCKCHAIN_DATABASES.EXPLORER_DATA.put(`TXS_TRACKER:${account}`,txsListForAccount)        

    }

}




let calculateAmountToSpendAndGasToBurn = tx => {

    let amountToSpend = 0n

    let gasToSpend = 0n

    let transferAmount = tx.payload.amount || 0n


    if(tx.fee > 0n){

        // In this case creator pays fee in native KLY currency

        amountToSpend = getCostPerSignatureType(tx) + transferAmount + tx.fee

        if(tx.type === 'WVM_CONTRACT_DEPLOY'){

            amountToSpend += 2000n * BigInt(tx.payload.bytecode.length / 2) // 0.000002 KLY per byte

            amountToSpend += 2_000_000n * BigInt(JSON.stringify(tx.payload.constructorParams.initStorage).length)

        } else if(tx.type === 'WVM_CALL'){

            let totalSize = JSON.stringify(tx.payload).length

            amountToSpend += 2_000_000n * BigInt(totalSize)

            amountToSpend += BigInt(tx.payload.gasLimit)

        } // TODO: Add EVM_CALL type

    } else if(tx.fee === 0n && tx.payload.abstractionBoosts){

        // In this case creator pays using boosts. This should be signed by current quorum

        amountToSpend = transferAmount

        let dataThatShouldBeSignedForBoost = `BOOST:${tx.creator}:${tx.nonce}` // TODO: Fix data that should be signed - sign payload(mb +epoch) instead of just creator+nonce

        if(verifyQuorumMajoritySolution(dataThatShouldBeSignedForBoost,tx.payload.abstractionBoosts?.quorumAgreements)){

            gasToSpend = BigInt(tx.payload.abstractionBoosts.proposedGasToBurn)

        } return {errReason:`Majority verification failed in attempt to use boost`}

    } else {

        // Otherwise - it's AA 2.0 usage and we just should reduce the gas amount from account

        amountToSpend = transferAmount

        gasToSpend = getCostPerSignatureType(tx) * 2n

        if(tx.type === 'WVM_CONTRACT_DEPLOY'){

            gasToSpend += BigInt(tx.payload.bytecode.length/2)

        } else if(tx.type === 'WVM_CALL'){

            let totalSize = JSON.stringify(tx.payload)

            gasToSpend += BigInt(totalSize)

            gasToSpend += BigInt(tx.payload.gasLimit)

        } // TODO: Add EVM_CALL type

    }


    return {amountToSpend, gasToSpend}

}








export let VERIFIERS = {



    /*

    Default transaction
    
    Structure of payload
    
    {
        to:<address to send KLY to>
        amount:<KLY to transfer>
        rev_t:<if recipient is BLS address - then we need to give a reverse threshold(rev_t = number of members of msig whose votes can be ignored)>
    }

    ----------------- In case of usage AA / boosts -----------------

    You may add to payload:

    abstractionBoosts: {
        
        proposedGasToBurn:<amount>,

        quorumAgreements:{

            quorumMember1:SIG(),
            ...
            quorumMemberN:SIG()

        }

    }

    touchedAccounts:[acc0, acc1, acc2, ... , accN]

    
    */

    TX:async(tx,rewardsAndSuccessfulTxsCollector,_atomicBatch)=>{

        let senderAccount = await getUserAccountFromState(tx.creator)
        
        let recipientAccount = await getFromState(tx.payload.to)

        
        tx = await TXS_FILTERS.TX(tx) // pass through the filter
        

        if(tx && tx.fee >= 0n && Number.isInteger(tx.nonce) && senderAccount.type==='eoa'){

            if(senderAccount.nonce >= tx.nonce) return {isOk:false,reason:'Replay: You need to increase the nonce'}            

            if(Array.isArray(tx.payload.touchedAccounts)){

                if(tx.payload.touchedAccounts.length === 2){

                    let includesAll = tx.payload.touchedAccounts.includes(tx.creator) && tx.payload.touchedAccounts.includes(tx.payload.to)

                    if(!includesAll) return {isOk:false,reason:'Wrong accounts in .touchedAccounts'}    

                } else return {isOk:false,reason:`.touchedAccounts should contain only 2 accounts - for sender and recipient`}

            }

            if(tx.payload.to.startsWith('0x') && tx.payload.to.length === 42){

                // It's transfer from native env to EVM

                recipientAccount = await KLY_EVM.getAccount(tx.payload.to)

            } else if(!recipientAccount){
    
                // Create default empty account.Note-here without NonceSet and NonceDuplicates,coz it's only recipient,not spender.If it was spender,we've noticed it on sift process
                
                recipientAccount = { type:'eoa', balance:'0', nonce:0, gas:0 }
                
                // In case recipient is BLS multisig, we need to add one more field - "rev_t" (reverse threshold to account to allow to spend even in case REV_T number of pubkeys don't want to sign)

                if(typeof tx.payload.rev_t === 'number') recipientAccount.rev_t = tx.payload.rev_t

                else if(tx.payload.pqcPub) recipientAccount.pqcPub = tx.payload.pqcPub

                GLOBAL_CACHES.STATE_CACHE.set(tx.payload.to,recipientAccount) // add to cache to collapse after all events in block

                trackStateChange(tx.payload.to,1,'put')

                WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalUserAccountsNumber.native++

                WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newUserAccountsNumber.native++
            
            }

            // Convert balances of sender / recipient from string to BigInt

            senderAccount.balance = BigInt(senderAccount.balance)

            recipientAccount.balance = BigInt(recipientAccount.balance)


            let spendData = calculateAmountToSpendAndGasToBurn(tx)

            
            if(!spendData.errReason){

                if(senderAccount.balance - spendData.amountToSpend >= 0n && BigInt(senderAccount.gas) - spendData.gasToSpend >= 0n){
                            
                    senderAccount.balance -= spendData.amountToSpend


                    let touchedAccounts = [tx.creator,tx.payload.to]

                    let amountForRecipientInWei = BigInt(tx.payload.amount)


                    if(tx.payload.to.startsWith('0x') && tx.payload.to.length === 42){

                        let lowerCaseAddressAsStringWithout0x = tx.payload.to.slice(2).toLowerCase()

                        let evmAccountMetadata = await getFromState(`EVM_ACCOUNT:${lowerCaseAddressAsStringWithout0x}`)

                        if(!evmAccountMetadata){

                            global.CREATED_EVM_ACCOUNTS.add('0x'+lowerCaseAddressAsStringWithout0x)

                        }

                        recipientAccount.balance += amountForRecipientInWei

                        await KLY_EVM.updateAccount(tx.payload.to,recipientAccount)

                    } else {

                        recipientAccount.balance += amountForRecipientInWei

                    }
    
                    senderAccount.gas -= Number(spendData.gasToSpend)
                
                    senderAccount.nonce = tx.nonce
                    
                    rewardsAndSuccessfulTxsCollector.fees += tx.fee

                    trackTransactionsList(blake3Hash(tx.sig),tx.type,tx.sigType,tx.fee,touchedAccounts)
        
                    return {isOk:true}        

                } else return {isOk:false,reason:`Not enough native currency or gas to execute transaction`}

            } else return {isOk:false,reason:spendData.errReason}
            
        } else return {isOk:false,reason:`Default verification process failed. Make sure input is ok`}
        
    },




    /*

    Method to deploy onchain contract to VM. You can use any payment method you want
    
    Payload is

        {
            bytecode:<hexString>,
            lang:<Rust|AssemblyScript>,
            constructorParams:{}
        }

    In constructorParams you can pre-set the initial values to storage. E.g. some bool flags, initial balances of tokens, contract multisig authority etc.

        constructorParams:{

            initStorage:{

                boolFlag: true,

                tokenOwners:{
                    acc1:1337,
                    acc2:1500,
                    ...
                }

            }

        }

    */

    WVM_CONTRACT_DEPLOY:async (tx,rewardsAndSuccessfulTxsCollector,atomicBatch)=>{

        if(tx) return {isOk:false,reason:`Contract deployment to WASM vm disabled for a while`}

        let senderAccount = await getUserAccountFromState(tx.creator)

        tx = await TXS_FILTERS.WVM_CONTRACT_DEPLOY(tx) // pass through the filter


        if(tx && tx.fee >= 0n && Number.isInteger(tx.nonce) && senderAccount.type==='eoa'){

            if(senderAccount.nonce >= tx.nonce) return {isOk:false,reason:'Replay: You need to increase the nonce'}

            if(Array.isArray(tx.payload.touchedAccounts) && tx.payload.touchedAccounts.includes(tx.creator)){

                if(!tx.payload.touchedAccounts.includes(tx.creator)) return {isOk:false,reason:'Wrong accounts in .touchedAccounts'}

            }

            let spendData = calculateAmountToSpendAndGasToBurn(tx)

            if(!spendData.errReason){

                if(senderAccount.balance - spendData.amountToSpend >= 0n && BigInt(senderAccount.gas) - spendData.gasToSpend >= 0n){

                    let contractID = `0x${blake3Hash(tx.creator+tx.nonce)}`

                    let contractMetadataTemplate = {
        
                        type:'contract',
                        lang:tx.payload.lang,
                        balance:'0',
                        gas:0,
                        storages:['DEFAULT'],
                        storageAbstractionLastPayment:WORKING_THREADS.VERIFICATION_THREAD.EPOCH.id
        
                    }
                
                    atomicBatch.put(contractID,contractMetadataTemplate)

                    trackStateChange(contractID,1,'put')

                    atomicBatch.put(contractID+'_BYTECODE',tx.payload.bytecode)

                    trackStateChange(contractID+'_BYTECODE',1,'put')
    
                    atomicBatch.put(contractID+'_STORAGE_DEFAULT',tx.payload.constructorParams.initStorage) // autocreate the default storage for contract

                    trackStateChange(contractID+'_STORAGE_DEFAULT',1,'put')


                    WORKING_THREADS.VERIFICATION_THREAD.TOTAL_STATS.totalSmartContractsNumber.native++

                    WORKING_THREADS.VERIFICATION_THREAD.STATS_PER_EPOCH.newSmartContractsNumber.native++


                    senderAccount.balance -= spendData.amountToSpend


                    senderAccount.gas -= Number(spendData.gasToSpend)
            
                    senderAccount.nonce = tx.nonce
                    
                    rewardsAndSuccessfulTxsCollector.fees += tx.fee

                    trackTransactionsList(blake3Hash(tx.sig),tx.type,tx.sigType,tx.fee,[tx.creator,contractID])

                    return {isOk:true, createdContractAddress: contractID}

                } else return {isOk:false,reason:`Not enough native currency or gas to execute transaction`}

            } else return {isOk:false,reason:spendData.errReason}

        } else return {isOk:false,reason:`Can't get filtered value of tx`}

    },


    /*

        Method to call contract
    
        Payload is

        {

            contractID:<BLAKE3 hashID of contract OR alias of contract(for example, system contracts)>,
            method:<string method to call>,
            gasLimit:<maximum allowed in KLY to execute contract>
            params:{} params to pass to function
            imports:[] imports which should be included to contract instance to call. Example ['default.CROSS-CONTRACT','storage.GET_FROM_ARWEAVE']. As you understand, it's form like <MODULE_NAME>.<METHOD_TO_IMPORT>
        
        }


    */
    WVM_CALL:async(tx,rewardsAndSuccessfulTxsCollector,atomicBatch)=>{


        let senderAccount = await getUserAccountFromState(tx.creator)

        tx = await TXS_FILTERS.WVM_CALL(tx) // pass through the filter
       

        if(tx && tx.fee >= 0n && Number.isInteger(tx.nonce) && senderAccount.type==='eoa'){

            if(senderAccount.nonce >= tx.nonce) return {isOk:false,reason:'Replay: You need to increase the nonce'}

            if(Array.isArray(tx.payload.touchedAccounts)){

                let includesAll = tx.payload.touchedAccounts.includes(tx.creator) && tx.payload.touchedAccounts.includes(tx.payload.contractID) && tx.payload.touchedAccounts.includes(tx.payload.to)

                if(!includesAll) return {isOk:false,reason:'Wrong accounts in .touchedAccounts'}

            }

            if(tx.payload.contractID?.startsWith('system/') && Array.isArray(tx.payload.touchedAccounts)) return {isOk:false,reason:'Parallelization of system smart contracts are disabled for a while'}

            
            let goingToSpend = calculateAmountToSpendAndGasToBurn(tx)

            if(!goingToSpend.errReason){

                if(senderAccount.balance - goingToSpend.amountToSpend >= 0n && BigInt(senderAccount.gas) - goingToSpend.gasToSpend >= 0n){

                    let execResultWithStatusAndReason

                    if(tx.payload.contractID?.startsWith('system/')){

                        // Call system smart-contract
        
                        let systemContractName = tx.payload.contractID.split('/')[1]
        
                        if(SYSTEM_CONTRACTS.has(systemContractName)){
        
                            let systemContract = SYSTEM_CONTRACTS.get(systemContractName)
                            
                            execResultWithStatusAndReason = await systemContract[tx.payload.method](tx,atomicBatch) // result is {isOk:true/false, reason:''}
        
                        } else execResultWithStatusAndReason = {isOk:false,reason:`No such type of system contract`}
                
                    } else {

                        if(tx) return {isOk:false,reason:`Custom contract calls in WASM vm disabled for a while`}
        
                        // Otherwise it's attempt to call custom contract
        
                        let contractMetadata = await getFromState(tx.payload.contractID)

                        let contractBytecode = await getFromState(tx.payload.contractID+'_BYTECODE')
        
                        if(contractMetadata){
        
                            // Prepare the contract handler
        
                            let gasLimit = BigInt(tx.payload.gasLimit)

                            if(contractMetadata.lang === 'AssemblyScript') gasLimit *= 10n
        
 
                            let methodToCall = tx.payload.method
        
                            let paramsToPass = tx.payload.params
        
                            // Before call - get the contract default storage from state DB
        
                            let contractStorage = await getFromState(tx.payload.contractID+'_STORAGE_DEFAULT')

                            
                            
                            // Start building the handler with all required data

                            let contractHandler = { 
                                
                                contractStorage,

                                contractAccount:  contractMetadata,

                                recipientAccount: await getFromState(tx.payload.to) // in case you plan to call <transferNativeCoins> function - you need to get account of recipient first

                            }

                            let {contractInstance,contractGasHandler} = await WVM.bytesToMeteredContract(Buffer.from(contractBytecode,'hex'), gasLimit, contractMetadata.lang, getFunctionsToInject(tx.payload.imports,contractHandler))
        
                            contractHandler.contractInstance = contractInstance

                            contractHandler.contractGasHandler = contractGasHandler

                            // In case contract call have zk verificaiton requirement - verify it because since it's async - impossible to do it from contract

                            if(tx.payload.zkVerifyRequest){

                                let {protoName,publicInputs,proof} = tx.payload.zkVerifyRequest

                                // Extract vKey from contract storage

                                let verificationKey = contractStorage.vKey

                                contractGasHandler.gasBurned += BigInt(60000);

                                let zkProofIsOk = await functionsToInjectToVm.zkSNARK(protoName,verificationKey,publicInputs,proof)

                                // Pass the zk verification to payload to read it from contract logic

                                paramsToPass.zkProofIsOk = zkProofIsOk

                            }

                            // Call contract
        
                            let resultAsJson = WVM.callContract(contractInstance,contractGasHandler,paramsToPass,methodToCall, contractMetadata.lang)
                           
                            let extraDataToReceipt = resultAsJson.result ? JSON.parse(resultAsJson.result) : ''

                            execResultWithStatusAndReason = {isOk:true,extraDataToReceipt} // TODO: Limit the size of <extraDataToReceipt> field
        
                        } else execResultWithStatusAndReason = {isOk:false,reason:`No metadata for contract`}
        
                    }

                    senderAccount.balance -= goingToSpend.amountToSpend

                    senderAccount.gas -= Number(goingToSpend.gasToSpend)
            
                    senderAccount.nonce = tx.nonce
                    
                    rewardsAndSuccessfulTxsCollector.fees += tx.fee

                    trackTransactionsList(blake3Hash(tx.sig),tx.type,tx.sigType,tx.fee,[tx.creator,tx.payload.contractID])

                    return execResultWithStatusAndReason

                } else return {isOk:false,reason:`Not enough native currency or gas to execute transaction`}

            } else return {isOk:false,reason:goingToSpend.errReason}

        } else return {isOk:false,reason:`Can't get filtered value of tx`}

    },


    /*

        To interact with EVM

        [+] Payload is hexadecimal evm bytecode with 0x prefix(important reminder not to omit tx)

    */
    EVM_CALL:async(txWithPayload,rewardsAndSuccessfulTxsCollector,atomicBatch)=>{

        let evmResult = await KLY_EVM.callEVM(txWithPayload.payload)

        if(evmResult && !evmResult.execResult.exceptionError){
          
            let totalSpentForFeesInWei = evmResult.amountSpent // BigInt value

            let totalSpentForFeesInKLY = Number(web3.utils.fromWei(totalSpentForFeesInWei.toString(),'ether'))
          
            // Add appropriate value to rewardbox to distribute among KLY pools

            rewardsAndSuccessfulTxsCollector.fees += totalSpentForFeesInKLY


            let possibleReceipt = KLY_EVM.getTransactionWithReceiptToStore(
                
                txWithPayload.payload,
            
                evmResult,
            
                GLOBAL_CACHES.STATE_CACHE.get('EVM_LOGS_MAP')
            
            )

            if(possibleReceipt){

                let {tx,receipt} = possibleReceipt

                let returnToReceipt

                atomicBatch.put('TX:'+tx.hash,{tx,receipt})

                trackStateChange('TX:'+tx.hash,1,'put')

                let propsedFee = Number(web3.utils.fromWei((tx.gasLimit * tx.gasPrice).toString(),'ether'))
                                
                let touchedAccounts = [tx.from, tx.to]


                if(receipt.contractAddress){

                    touchedAccounts.push(receipt.contractAddress)
                    
                }

                // In case it was tx to account of connector address (0xdead) - it's special transaction, maybe transfer from EVM to native env

                if(tx.to === CONFIGURATION.KLY_EVM.connectorAddress){

                    let parsedData = JSON.parse(web3.utils.hexToAscii(tx.data))
                    
                    // In case it's staking/unstaking

                    let transferValueInWei = web3.utils.fromWei(tx.value,'ether')

                    if(parsedData.contractID === 'system/staking'){

                        /*
                        
                            We should pass data like this:

                            {

                                contractID'system/staking',
                                
                                method:'stake | unstake,

                                poolPubKey:<Format is Ed25519_pubkey>,
                                
                                amount:<amount in KLY>
                            
                            }
                        
                        */
                        
                        returnToReceipt = await performStakingActionsForEVM(tx.from,transferValueInWei,parsedData)

                    
                    } else if(parsedData.to){

                        if(Array.isArray(parsedData.touchedAccounts) && !parsedData.touchedAccounts.includes(parsedData.to)) return {isOk:false,reason:'EVM'}


                        let accountToTransfer = await getUserAccountFromState(parsedData.to)

                        // Transfer coins

                        if(!accountToTransfer){

                            accountToTransfer = {
                
                                type:'eoa', balance:0n, nonce:0, gas:0
                            
                            }
                            
                            // In case recipient is BLS multisig, we need to add one more field - "rev_t" (reverse threshold to account to allow to spend even in case REV_T number of pubkeys don't want to sign)
            
                            if(typeof parsedData.rev_t === 'number') accountToTransfer.rev_t = tx.payload.rev_t
            
                            else if(parsedData.pqcPub) accountToTransfer.pqcPub = tx.payload.pqcPub
                
                            GLOBAL_CACHES.STATE_CACHE.set(parsedData.to,accountToTransfer) // add to cache to collapse after all events in block
                        
                        }

                        let transferValue = BigInt(web3.utils.fromWei(tx.value,'ether')) * (BigInt(10) ** BigInt(18))

                        accountToTransfer.balance += transferValue
                        
                        touchedAccounts.push(parsedData.to)

                    }

                }

                trackTransactionsList(tx.hash,'EVM_CALL','ECDSA',propsedFee,touchedAccounts)

                return returnToReceipt || {isOk:true,reason:'EVM'}

            }else return {isOk:false,reason:'EVM'}

        } return {isOk:false,reason:'EVM'}

    }

}