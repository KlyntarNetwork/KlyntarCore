import {DefaultStateManager} from '@ethereumjs/statemanager'
import {Address,Account} from '@ethereumjs/util'
import {Transaction} from '@ethereumjs/tx'
import {Common} from '@ethereumjs/common'
import {Block} from '@ethereumjs/block'
import {Trie} from '@ethereumjs/trie'
import {LevelDB} from './LevelDB.js'
import rlp from '@ethereumjs/rlp'
import {VM} from '@ethereumjs/vm'
import {Level} from 'level'
import Web3 from 'web3'


import {CONFIGURATION} from '../../klyntar_core.js'



//_________________________________________________________ CONSTANTS POOL _________________________________________________________




// 'KLY_EVM' Contains state of EVM

// 'STATE' Contains metadata for KLY-EVM pseudochain (e.g. blocks, logs and so on)


const {

    name,
    networkId,
    chainId,
    coinbase, // this address will be set as a block creator, but all the fees will be automatically redirected to KLY env and distributed among pool stakers
    hardfork,
    gasLimitForBlock,
    gasPriceInWeiAndHex,
    protocolVersionInHex,
    clientVersion,
    maxAllowedGasAmountForSandboxExecution

} = CONFIGURATION.KLY_EVM

const common = Common.custom({name,networkId,chainId},{hardfork})

const web3 = new Web3()


// Need this object inside EVM

global.KLY_EVM_OPTIONS = {coinbase, gasPriceInWeiAndHex, protocolVersionInHex, chainId, clientVersion, networkId}


/*

Default block template for KLY-EVM

[+] Miner(block creator) value will be mutable
[+] Timestamp will be mutable & deterministic

P.S: BTW everything will be changable

*/
// const block = Block.fromBlockData({header:{miner:'0x0000000000000000000000000000000000000000',timestamp:133713371337}},{common})



class KLY_EVM_CLASS {


    constructor(pathToVMState){

        const trie = new Trie({
    
            db:new LevelDB(new Level(pathToVMState)) // use own implementation. See the sources
        
        })
        
        
        this.stateManager = new DefaultStateManager({trie})
        
        this.block = Block.fromBlockData({header:{gasLimit:gasLimitForBlock,miner:coinbase}},{common})


    }


    startEVM=async()=>{

        // Create our VM instance
        this.vm = await VM.create({common,stateManager:this.stateManager})

    }


    /**
     * ### Execute tx in KLY-EVM
     * 
     * @param {string} serializedEVMTxWith0x - EVM signed tx in hexadecimal to be executed in EVM in context of given block
     * 
     * @returns txResult 
     * 
     */
    callEVM = async serializedEVMTxWith0x => {
        
        let serializedEVMTxWithout0x = serializedEVMTxWith0x.slice(2) // delete 0x
        
        let tx = Transaction.fromSerializedTx(Buffer.from(serializedEVMTxWithout0x,'hex'),{freeze:false,common})

        // Try to parse tx.data - maybe it contains additional data(for parallelization, AAv2, etc.), not only calldata

        let accountAbstractionV2Data = null, pureEvmCalldata = null

        try {

            let parsedDataField = JSON.parse(tx.data.toString())

            if(parsedDataField){
    
                accountAbstractionV2Data = parsedDataField.accountAbstractionV2Data
    
                pureEvmCalldata = new Uint8Array(web3.utils.hexToBytes(parsedDataField.pureEvmCalldata)) || new Uint8Array(0)
    
            }
    
        } catch {

            pureEvmCalldata = tx.data

        }

        let evmCaller = tx.getSenderAddress()

        let block = this.block 


        tx.data = pureEvmCalldata

        
        let txResult = await this.vm.runTx({tx,block,evmCaller,accountAbstractionV2Data})


        // We'll need full result to store logs and so on
        if(!txResult.execResult.exceptionError) return txResult


    }

    /**
     * ### Execute tx in KLY-EVM without state changes
     * 
     * @param {import('@ethereumjs/tx').TxData | string} txDataOrSerializedTxInHexWith0x - EVM signed tx(TxData like(see EVM docs)) or serialized tx to be executed in EVM in context of given block
     * 
     * @returns {string} result of executed contract / default tx
    */
    sandboxCall=async(txDataOrSerializedTxInHexWith0x,isJustCall)=>{

        // In case it's just KLY-EVM call to read from contract - then ok, otherwise(if isJustCall=false) we assume that it's attempt to add to mempool(so we need to verify signature and other stuff)

        let tx = isJustCall ? Transaction.fromTxData(txDataOrSerializedTxInHexWith0x,{freeze:false,common}) : Transaction.fromSerializedTx(Buffer.from(txDataOrSerializedTxInHexWith0x.slice(2),'hex'),{freeze:false,common})

        let block = this.block


        // Try to parse tx.data - maybe it contains additional data(for parallelization, AAv2, etc.), not only calldata

        let accountAbstractionV2Data = null, pureEvmCalldata = null

        try {

            let parsedDataField = JSON.parse(tx.data.toString())

            if(parsedDataField){
    
                accountAbstractionV2Data = parsedDataField.accountAbstractionV2Data


                if(parsedDataField.pureEvmCalldata){

                    pureEvmCalldata = new Uint8Array(web3.utils.hexToBytes(pureEvmCalldata))
                        
                } else pureEvmCalldata = new Uint8Array(0);
    
            }
    
        } catch {

            pureEvmCalldata = tx.data

        }
        

        if(isJustCall){

            let {to,data} = tx

            data = pureEvmCalldata

            let vmCopy = await this.vm.copy()

            // To prevent spam - set limit in configs for your RPC. This will protect your node from executing "intensive" logic

            let gasLimit = BigInt(maxAllowedGasAmountForSandboxExecution)

            let txResult = await vmCopy.evm.runCall({

                to, data,

                block, gasLimit,

                skipBalance:true, isSandboxExecution:true,

                accountAbstractionV2Data

            })

            return txResult.execResult.exceptionError || web3.utils.toHex(txResult.execResult.returnValue)

        } else {

            let vmCopy = await this.vm.copy()

            let origin = tx.getSenderAddress()

            let {to,value,gasLimit} = tx

            let caller = origin


            if(tx.validate() && tx.verifySignature()){

                let account = await vmCopy.stateManager.getAccount(origin)

                // To prevent spam - set limit in configs for your RPC. This will protect your node from executing "intensive" logic

                let gasLimitFromConfigsToPreventDdos = BigInt(maxAllowedGasAmountForSandboxExecution)

                gasLimit = gasLimit >= gasLimitFromConfigsToPreventDdos ? gasLimitFromConfigsToPreventDdos : gasLimit


                if(account.nonce === tx.nonce && account.balance >= value){

                    let txResult = await vmCopy.evm.runCall({

                        data:pureEvmCalldata,

                        origin, caller, to, gasLimit,

                        block,

                        isSandboxExecution:true,

                        accountAbstractionV2Data

                    })

                    return txResult.execResult.exceptionError || web3.utils.toHex(txResult.execResult.returnValue)

                } return {error:{msg:'Wrong nonce value or insufficient balance'}}

            } return {error:{msg:'Transaction validation failed. Make sure signature is ok and required amount of gas is set'}}

        }

    }
        
    

     /**
     * 
     * ### Add the account to storage
     * 
     * @param {string} address - EVM-compatible 20-bytes address
     * @param {number} balanceInEthKly - wished balance
     * @param {number} nonce - account nonce
     * 
     * 
     * @returns {Object} result - The execution status 
     * @returns {boolean} result.status
     * 
     */
    putAccount=async(address,balanceInEthKly,nonce=0)=>{

        let accountData = {
            
            nonce,
            
            balance: BigInt(balanceInEthKly) * (BigInt(10) ** BigInt(18)), // balanceInEthKly * 1 eth. So, if you want to set balance to X KLY on KLY-EVM - set parameter value to X
          
        }
        
        let status = await this.vm.stateManager.putAccount(Address.fromString(address),Account.fromAccountData(accountData)).then(()=>({status:true})).catch(()=>({status:false}))


        return status

    }



    updateAccount=async(address,account)=>{
        
        let status = await this.vm.stateManager.putAccount(Address.fromString(address),account).then(()=>({status:true})).catch(()=>({status:false}))

        return status

    }




    putContract=async(address,balanceInEthKly,nonce,code,storage)=>{

        let accountData = {
            
            nonce,
            
            balance:BigInt(balanceInEthKly) * (BigInt(10) ** BigInt(18)), // balanceInEthKly * 1 eth. So, if you want to set balance to X KLY on KLY-EVM - set parameter value to X
          
        }

        address = Address.fromString(address)
    
        await this.vm.stateManager.putAccount(address,Account.fromAccountData(accountData))

        for (const [key,value] of Object.entries(storage)) {
        
            const storageKey = Buffer.from(key,'hex')
            const storageValue = Buffer.from(rlp.decode(`0x${value}`))
            
            await this.vm.stateManager.putContractStorage(address,storageKey,storageValue)
        
        }

        const codeBuffer = Buffer.from(code,'hex')
    
        await this.vm.stateManager.putContractCode(address,codeBuffer)
        
    }


    
    /**
     * 
     * ### Returns the state of account related to address
     * 
     * @param {string} address - EVM-compatible 20-bytes address
     * 
     * @returns {Object} account - The account from state 
     * 
     * @returns {BigInt} account.nonce
     * @returns {BigInt} account.balance
     * @returns {Buffer} account.storageRoot
     * @returns {Buffer} account.codeHash
     * @returns {boolean} account.virtual
     * 
     * 
     */
    getAccount = async address => this.vm.stateManager.getAccount(Address.fromString(address))

    /**
     * 
     * ### Returns the root of VM state
     * 
     * @returns {string} root of state of KLY-EVM in hexadecimal  
     * 
     */
    getStateRoot = async() => {

        let stateRoot = await this.vm.stateManager.getStateRoot()
        
        return stateRoot.toString('hex') //32-bytes hexadecimal form

    }


    /**
     * 
     * ### Set the root of VM state
     * 
     * @param {string} 32-bytes hexadecimal root of VM's state
     * 
     */
    setStateRoot = stateRootInHex => this.stateManager.setStateRoot(Buffer.from(stateRootInHex,'hex'))


    //____________________________________ Auxiliary functionality ____________________________________


    /**
     * 
     * ### Get the gas required for VM execution
     * 
     * @param {import('@ethereumjs/tx').TxData} txData - EVM-like transaction with fields like from,to,value,data,etc.
     * 
     *  
     * @returns {string} required number of gas to deploy contract or call method
     *  
    */
    estimateGasUsed = async txData => {


        txData.gasLimit = CONFIGURATION.KLY_EVM.maxAllowedGasAmountForSandboxExecution  // To prevent spam - limit the maximum allowed gas for free EVM calls

        txData.gasPrice = web3.utils.toHex(web3.utils.toWei('2','gwei'))

        if(!txData.nonce){

            let fromAccount = await this.getAccount(txData.from).catch(()=>false)

            if(fromAccount){

                let nonceInHex = web3.utils.toHex(fromAccount.nonce.toString())

                txData.nonce = nonceInHex
    
            }

        }

        let tx = Transaction.fromTxData(txData,{common,freeze:false})

        let evmCaller = Address.fromString(txData.from) || tx.isSigned() && tx.getSenderAddress()
    
        let vmCopy = await this.vm.copy()

        let block = this.block


        let txResult = await vmCopy.runTx({
            
            tx,block,
            
            skipBalance:true,
            isSandboxExecution:true,
            evmCaller
        
        })
    
        return txResult.execResult.exceptionError || web3.utils.toHex(txResult.totalGasSpent.toString()) // OR txResult.totalGasSpent.toString()
        
    }


    /**
     * 
     * @returns {Block} the current block that used on VT
     */
    getCurrentBlock=()=>this.block


    setCurrentBlockParams=(nextIndex,timestamp,parentHash)=>{

        this.block = Block.fromBlockData({
            
            header:{

                gasLimit:gasLimitForBlock,
                miner:coinbase,
                timestamp,
                parentHash:Buffer.from(parentHash,'hex'),
                number:nextIndex
            
            }
        
        },{common})

    }


    /**
     * ### Returns tx and its receipt in appropriate serialized form to store
     * 
     * 
     * @param {string} transactionInHex 
     * @param {import('@ethereumjs/vm').RunTxResult} evmResult 
     * @param {Object} logsMap storage {contractAddress=>logsArray} where logsArray contains all the logs by this contract in current block 
     * 
     * 
     * @returns {Object}
     */
    getTransactionWithReceiptToStore=(transactionInHex,evmResult,logsMap)=>{

        /*
            
            ________________________ WHAT WE NEED TO STORE TO STATE DB ________________________

            'TX:'+txHash - {tx,receipt} - tx and receipt by txHash

        */


        let tx = Transaction.fromSerializedTx(Buffer.from(transactionInHex.slice(2),'hex'),{common})
            
        if(tx){
        
        
            let transaction = tx.toJSON()
        
                        
            transaction.blockHash = '0x'+this.getCurrentBlock().hash().toString('hex')
        
            transaction.blockNumber = web3.utils.toHex(this.getCurrentBlock().header.number.toString())
        
            transaction.hash = '0x'+tx.hash().toString('hex')
        
            transaction.from ||= tx.getSenderAddress().toString()
        
            transaction.transactionIndex = 0
        
        
            //______________ Working with receipt ______________
        
            let receipt = evmResult.receipt
        
            /*
        
            ______________________Must return______________________
        
        
                ✅transactionHash : DATA, 32 Bytes - hash of the transaction.
                ✅transactionIndex: QUANTITY - integer of the transactions index position in the block.
                ✅blockHash: DATA, 32 Bytes - hash of the block where this transaction was in.
                ✅blockNumber: QUANTITY - block number where this transaction was in.
                ✅from: DATA, 20 Bytes - address of the sender.
                ✅to: DATA, 20 Bytes - address of the receiver. null when its a contract creation transaction.
                ✅cumulativeGasUsed : QUANTITY - The total amount of gas used when this transaction was executed in the block.
                ✅effectiveGasPrice : QUANTITY - The sum of the base fee and tip paid per unit of gas.
                ✅gasUsed : QUANTITY - The amount of gas used by this specific transaction alone.
                ✅contractAddress : DATA, 20 Bytes - The contract address created, if the transaction was a contract creation, otherwise null.
                ✅logs: Array - Array of log objects, which this transaction generated.
                ✅logsBloom: DATA, 256 Bytes - Bloom filter for light clients to quickly retrieve related logs.
                ✅type: DATA - integer of the transaction type, 0x00 for legacy transactions, 0x01 for access list types, 0x02 for dynamic fees. It also returns either :
                ⌛️root : DATA 32 bytes of post-transaction stateroot (pre Byzantium)
                ✅status: QUANTITY either 1 (success) or 0 (failure)
        
                        
            _____________________Add manually______________________
        
                transactionHash - '0x'+tx.hash().toString('hex')
                transactionIndex - '0x0'
                            
                blockHash - '0x'+block.hash().toString('hex')
                blockNumber - block.header.number (in hex)
                            
                from - tx.getSenderAddress().toString()
                to - tx.to
                cumulativeGasUsed - convert to hex
                effectiveGasPrice - take from tx gasPrice tx.gasPrice
                gasUsed - take from tx execution result (result.execResult.executionGasUsed.toString())
                type - tx.type (convert to hex)
                contractAddress - take from tx (vm.runTx({tx,block}).createdAddress). Otherwise - set as null
                logsBloom - '0x'+receipt.bitvector.toString('hex')
                        
                        
            */
        

            let {hash,blockHash,blockNumber,from,to,gasPrice} = transaction
        
            // Put in order logs
        
            let logsForReceipt = receipt.logs.map(singleLog=>{
        
                /* 
                            
                    Each single log is array with 3 objects
                                
                    [0] - contract address which forced event. Need to hex
                    [1] - array of topics. Need to hex them
                    [2] - pure data related to log. Need to hex
                            
                */
        
                let [contractAddressBuffer,topicsBuffers,pureData] = singleLog
        
                // Serialization
        
                let address = '0x'+Buffer.from(contractAddressBuffer).toString('hex')
            
                let topics = topicsBuffers.map(buffer=>'0x'+Buffer.from(buffer).toString('hex'))
        
                let data = '0x'+Buffer.from(pureData).toString('hex')
        
                            
                /*
        
                    Now we need to add some extra data to log
            
                    address - contract address
                    topics
                    data - pureHexLogs
                    blockNumber(bigint to hex)
                    txHash
                    txIndex
                    blockHash
                    logIndex - 0
                    removed - false
                    id- 'log_00000000'
                                                
                */
        
                let finalLogForm = {
                                
                    address,
                    topics,
                    data,
                    blockNumber,
                    transactionHash:hash,
                    transactionIndex:'0x0',
                    blockHash,
                    logIndex:'0x0',
                    removed:false
        
                }
        
                this.storeLog(logsMap,finalLogForm)

                return finalLogForm
                
            })
        
        
            let futureReceipt = {
                
                status:receipt.status,
                transactionHash:hash,
                transactionIndex:'0x0',
                blockHash,
                blockNumber,
                from,
                cumulativeGasUsed:web3.utils.toHex(receipt.cumulativeBlockGasUsed.toString()),
                effectiveGasPrice:gasPrice,
                gasUsed:web3.utils.toHex(evmResult.execResult.executionGasUsed.toString()),
                type:web3.utils.toHex(tx.type),
                logsBloom:'0x'+receipt.bitvector.toString('hex'),
                logs:logsForReceipt
            
            }
                        
        
            if(to) futureReceipt.to = to
        
                        
            if(evmResult.createdAddress) futureReceipt.contractAddress = evmResult.createdAddress.toString()
                        
            else futureReceipt.contractAddress = null
    

            return {tx:transaction,receipt:futureReceipt}
    
        }


    }


    getBlockToStore = currentHash => {

                /*

                        Now, we need to store block

        ______________________Block must have______________________
    
        ✅number: QUANTITY - the block number. null when its pending block.
        ⌛️hash: DATA, 32 Bytes - hash of the block. null when its pending block.
        ✅parentHash: DATA, 32 Bytes - hash of the parent block.
        ✅nonce: DATA, 8 Bytes - hash of the generated proof-of-work. null when its pending block.
        ✅sha3Uncles: DATA, 32 Bytes - SHA3 of the uncles data in the block.
        ✅transactionsRoot: DATA, 32 Bytes - the root of the transaction trie of the block.
        ✅stateRoot: DATA, 32 Bytes - the root of the final state trie of the block.
        ✅receiptsRoot: DATA, 32 Bytes - the root of the receipts trie of the block.
        ✅miner: DATA, 20 Bytes - the address of the beneficiary to whom the mining rewards were given.
        ✅difficulty: QUANTITY - integer of the difficulty for this block.
        ✅totalDifficulty: QUANTITY - integer of the total difficulty of the chain until this block.
        ✅extraData: DATA - the "extra data" field of this block.
        ✅logsBloom: DATA, 256 Bytes - the bloom filter for the logs of the block. null when its pending block.
        ✅gasLimit: QUANTITY - the maximum gas allowed in this block.
        ✅gasUsed: QUANTITY - the total used gas by all transactions in this block.
        ✅timestamp: QUANTITY - the unix timestamp for when the block was collated.
        ✅transactions: Array - Array of transaction objects, or 32 Bytes transaction hashes depending on the last given parameter.
        ✅uncles: Array - Array of uncle hashes.
        ✅size: QUANTITY - integer the size of this block in bytes.
        

        ________________________Current________________________
        
        {
            header: {
                parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
                coinbase: '0x0000000000000000000000000000000000000000',
                stateRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
                transactionsTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
                receiptTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
                logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                difficulty: '0x0',
                number: '0x0',
                gasLimit: '0xffffffffffffff',
                gasUsed: '0x0',
                timestamp: '0x1f21f020c9',
                extraData: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                nonce: '0x0000000000000000'
            },

            transactions: [],
            uncleHeaders: []
        }


        _________________________TODO__________________________

        ✅hash - '0x'+block.hash.toString('hex')
        ✅uncleHash => sha3Uncles
        ✅transactionsTrie => transactionsRoot
        ✅receiptTrie => receiptsRoot
        ✅coinbase => miner
        ✅totalDifficulty - '0x0'
        ✅size - '0x0'
        ✅transactions - push the hashes of txs runned in this block
        ✅uncleHeaders => uncles[]


    */
            

        let currentBlock = this.getCurrentBlock()

        let {number,parentHash,nonce,uncleHash,transactionsTrie,receiptTrie,coinbase,stateRoot,difficulty,logsBloom,gasLimit,gasUsed,mixHash,extraData,timestamp} = currentBlock.header


        let blockTemplate = {

            number:Web3.utils.toHex(number.toString()),
            hash:'0x'+currentHash.toString('hex'),
            
            parentHash:'0x'+parentHash.toString('hex'),
            nonce:'0x'+nonce.toString('hex'),

            extraData:'0x'+extraData.toString('hex'),
            
            sha3Uncles:'0x'+uncleHash.toString('hex'),
            transactionsRoot:'0x'+transactionsTrie.toString('hex'),
            receiptsRoot:'0x'+receiptTrie.toString('hex'),
            stateRoot:'0x'+stateRoot.toString('hex'),
            
            miner:coinbase.toString(),
            timestamp:Web3.utils.toHex(timestamp.toString()),

            size:'0x0',
            
            gasLimit:Web3.utils.toHex(gasLimit.toString()),
            gasUsage:Web3.utils.toHex(gasUsed.toString()),
            
            logsBloom:'0x'+logsBloom.toString('hex'),
            
            totalDifficulty:'0x0',
            difficulty:Web3.utils.toHex(difficulty.toString()),

            mixHash:'0x'+mixHash.toString('hex'),

            transactions:[],
            uncleHeaders:[]

        }

        return blockTemplate

    }


    //
    storeLog = (logsMap,logInstance) => {

        
    /*

        ____________________Filter options are____________________
        

        fromBlock:QUANTITY|TAG - (optional, default: "latest") Integer block number, or "latest" for the last mined block or "pending", "earliest" for not yet mined transactions.
        toBlock:QUANTITY|TAG - (optional, default: "latest") Integer block number, or "latest" for the last mined block or "pending", "earliest" for not yet mined transactions.
        address:DATA|Array, 20 Bytes - (optional) Contract address or a list of addresses from which logs should originate.
        topics:Array of DATA, - (optional) Array of 32 Bytes DATA topics. Topics are order-dependent. Each topic can also be an array of DATA with "or" options.
        blockhash:DATA, 32 Bytes - (optional, future) With the addition of EIP-234, blockHash will be a new filter option which restricts the logs returned to the single block with the 32-byte hash blockHash. Using blockHash is equivalent to fromBlock = toBlock = the block number with hash blockHash. If blockHash is present in the filter criteria, then neither fromBlock nor toBlock are allowed.
    

        ___________________Example of response____________________

    [
        {
            ✅address: '0x15ecf34ECDb72bAfd3DbA990D01E20338681f6dE',
            ✅blockNumber: 18776,
            ✅transactionHash: '0x42b4c699f613045f09a7201fe328a9a91843c0fafdb0bd1f5a22d13b964522bb',
            ✅transactionIndex: 0,
            ✅blockHash: '0xce26fb2518f4c79228c188132c996dea311c93da73cf934d630dd696e3f70181',
            ✅logIndex: 0,
            ✅removed: false,
            ✅id: 'log_b8492241',
            ⌛️returnValues: Result {
                '0': 'Hello as argument',
                '1': '1672832828',
                payload: 'Hello as argument',
                blocktime: '1672832828'
            },

            ⌛️event:'Checkpoint',
            ⌛️signature: '0x5d882878f6c50530e63829854e64755332e385dbf9dd9c2798e07d9c88c67e40',
            ⌛️raw: {
                data: '0x00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000063b5673c000000000000000000000000000000000000000000000000000000000000001148656c6c6f20617320617267756d656e74000000000000000000000000000000',
                topics: [Array]
            }
        },

        ...(next logs)

    ]


        _____________________Add manually______________________

        address - '0x'+result.receipt.logs[0][0].toString('hex') (NOTE: The first(0) element in each arrays in <logs> array is the appropriate contract address logs related to)

        Example: 

        logs:[
            [<address0>,<topics0>,<logs0>],
            [<address1>,<topics1>,<logs1>],
            ...
        ]

        blockNumber - block.number
        transactionHash - '0x'+tx.hash().toString('hex')
        transactionIndex - set manually(in hex)
        blockHash - '0x'+block.hash().toString('hex')
        logIndex - take from logs received from tx.receipt
        removed - false(no chain reorganization )
        id - 'log_00000000'
        returnValues - take from web3.eth.abi.decodeLog(JSON.parse(ABI),logsInHex,topicsArrayInHex)
        event - take from query
        signature - event signature hash (topics[0])

        raw: {
        
            data:'0x'+logsInHex,
            topics:topicsArrayInHex
        
        }

        ______________Function parameters______________
        
        [+] Logsmap - {contractAddress=>[logInstance0,logInstance1,...]}
        
        [+] LogInstance has the following structure

            {
                                
                address,
                topics,
                data,
                blockNumber,
                transactionHash:hash,
                transactionIndex:'0x0',
                blockHash,
                logIndex:'0x0',
                removed:false,
                id:'log_00000000'
        
            }
     

    */

        if(!Array.isArray(logsMap[logInstance.address])) logsMap[logInstance.address]=[]


        logsMap[logInstance.address].push(logInstance)

    }

}




//_________________________________________________ External usage _________________________________________________


let KLY_EVM_INSTANCE = new KLY_EVM_CLASS(process.env.CHAINDATA_PATH+'/KLY_EVM')

await KLY_EVM_INSTANCE.startEVM()

// Need for // 0x40: BLOCKHASH. See functions.js
global.KLY_EVM = KLY_EVM_INSTANCE

export {KLY_EVM_INSTANCE as KLY_EVM}