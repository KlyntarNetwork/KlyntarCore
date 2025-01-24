import {BLOCKCHAIN_GENESIS, CONFIGURATION, FASTIFY_SERVER} from '../../../../klyn74r.js'

import {getFromState} from '../../common_functions/state_interactions.js'

import {BLOCKCHAIN_DATABASES, WORKING_THREADS} from '../../globals.js'

import {KLY_EVM} from '../../../../KLY_VirtualMachines/kly_evm/vm.js'

import {SYSTEM_CONTRACTS} from '../../system_contracts/root.js'




/**## Returns the data directrly from state
 * 
 * 
 * ### Info
 * 
 *  This GET route returns data from state - it might be account, contract metadata, contract storage, KLY-EVM address binding and so on!
 * 
 * 
 * ### Params
 * 
 *  + 0 - cellID - identifier of what you want to get - contract ID, account address(Base58 ed25519,BLS,LRS,PQC,TSIG, and so on), etc.
 * 
 * 
 * ### Returns
 * 
 *  + JSON'ed value
 * 
 *  
 * */
FASTIFY_SERVER.get('/state/:cellID',async(request,response)=>{


    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.FROM_STATE){

        let data = await BLOCKCHAIN_DATABASES.STATE.get(request.params.cellID).catch(()=>null)

        response

            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.FROM_STATE)
        
            .send(data)
    
    }else response.send({err:'Trigger is off'})

})


// 0 - txid
FASTIFY_SERVER.get('/tx_receipt/:txID',(request,response)=>{

    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.TX_RECEIPT){

        response
        
            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control',`max-age=${CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.TX_RECEIPT}`)
            

        BLOCKCHAIN_DATABASES.STATE.get('TX:'+request.params.txID).then(

            async txReceipt => {

                if(request.params.txID.startsWith('0x')){

                    let blockIdWithThisTx = await BLOCKCHAIN_DATABASES.STATE.get(`EVM_BLOCK_RECEIPT:${txReceipt.receipt.blockNumber}`).then(pointer=>pointer.klyBlock).catch(err=>err)

                    let formatCompatibleReceipt = {

                        shard: BLOCKCHAIN_GENESIS.SHARD,

                        blockID: blockIdWithThisTx,

                        order:0,

                        isOk: txReceipt.receipt.status === 1,

                        createdContractAddress: txReceipt.receipt.contractAddress

                    }

                    response.send(formatCompatibleReceipt)

                } else response.send(txReceipt)

            }

        ).catch(err=>response.send({err}))


    }else response.send({err:'Route is off'})

})





FASTIFY_SERVER.get('/txs_list/:accountID',async(request,response)=>{


    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.FROM_STATE){

        let accountID = request.params.accountID

        let txsList = await BLOCKCHAIN_DATABASES.EXPLORER_DATA.get(`TXS_TRACKER:${accountID}`).catch(()=>([]))


        response

            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.FROM_STATE)

            .send(txsList)


    } else response.send({err:'Trigger is off'})

})




FASTIFY_SERVER.get('/pool_stats/:poolID',async(request,response)=>{


    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.POOL_STATS){

        // Take the info related to pool based on data in VT(verification thread) and AT(approvement thread)

        let poolOriginShard = BLOCKCHAIN_GENESIS.SHARD

        let poolMetadata = await getFromState(`${request.params.poolID}`)

        let poolStorage = await getFromState(`${request.params.poolID}_STORAGE_POOL`)

        let poolPubKey = request.params.poolID.split('(')[0]

        let isActiveValidator = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.poolsRegistry.includes(poolPubKey)

        let isCurrentQuorumMember = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH.quorum.includes(poolPubKey)

        response

            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.POOL_STATS)
        
            .send({isActiveValidator,isCurrentQuorumMember,poolOriginShard,poolMetadata,poolStorage})

            
    }else response.send({err:'Trigger is off'})

})




FASTIFY_SERVER.get('/account/:accountID',async(request,response)=>{


    if(CONFIGURATION.NODE_LEVEL.ROUTE_TRIGGERS.API.FROM_STATE){

        let accountID = request.params.accountID

        let data

        // First - check if request for system smart contract

        if(SYSTEM_CONTRACTS.has(accountID)){

            data = {
                        
                type:"contract", lang:`system/${accountID}`,  balance:'0', gas:0,
                
                storages:[],
                
                storageAbstractionLastPayment: 0
            
            }

        } else if(accountID.startsWith('0x') && accountID.length === 42){

            let account = await KLY_EVM.getAccount(accountID).catch(()=>null)

            let accountEvmDataFromNativeKlyEnv = await BLOCKCHAIN_DATABASES.STATE.get(`EVM_ACCOUNT:${accountID.toLowerCase()}`).catch(()=>null)

            let contractData = await BLOCKCHAIN_DATABASES.STATE.get(`EVM_CONTRACT_DATA:${accountID.toLowerCase()}`).catch(()=>null)

            if(account){

                let balanceInWei = account.balance.toString()

                let nonce = Number(account.nonce)

                let gas = accountEvmDataFromNativeKlyEnv?.gas || 0

                if(contractData){

                    data = {
                        
                        type:"contract", lang:"Solidity", balance: balanceInWei, gas,
                        
                        storages:['DEFAULT'],
                        
                        storageAbstractionLastPayment: contractData.storageAbstractionLastPayment
                    
                    }

                } else {

                    data = { type:"eoa", balance:balanceInWei, nonce, gas}
    
                }

            } else data = {}

        } else data = await BLOCKCHAIN_DATABASES.STATE.get(accountID).catch(()=>({err:'Not found'}))
 

        response

            .header('Access-Control-Allow-Origin','*')
            .header('Cache-Control','max-age='+CONFIGURATION.NODE_LEVEL.ROUTE_TTL.API.FROM_STATE)
        
            .send(data)
    
    }else response.send({err:'Trigger is off'})

})