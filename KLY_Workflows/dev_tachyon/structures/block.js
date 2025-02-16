import {BLOCKCHAIN_GENESIS, CONFIGURATION} from '../../../klyntar_core.js'

import {blake3Hash, getUtcTimestamp} from '../../../KLY_Utils/utils.js'

import {WORKING_THREADS} from '../globals.js'




export default class Block{
    
    constructor(transactionsSet,extraData,epochFullID){
        
        this.creator = CONFIGURATION.NODE_LEVEL.PUBLIC_KEY // block creator(validator|pool) Example: 9GQ46rqY238rk2neSwgidap9ww5zbAN4dyqyC7j5ZnBK

        this.time = getUtcTimestamp() // (NOTE:in milliseconds)

        this.epoch = epochFullID

        this.transactions = transactionsSet // array of transactions,contract calls, services logic,etc.

        this.extraData = extraData || {} // extradata to be added to block. Used mostly to add ALRPs(aggregated leader rotation proofs) and delayed transactions

        this.index = WORKING_THREADS.GENERATION_THREAD.nextIndex // index of block in pool's own sequence
        
        this.prevHash = WORKING_THREADS.GENERATION_THREAD.prevHash // hash of previous block in pool's own sequence
        
        this.sig = '' // Ed25519 signature of block
    
    }
    
    static genHash = block => blake3Hash( block.creator + block.time + JSON.stringify(block.transactions) + BLOCKCHAIN_GENESIS.NETWORK_ID + block.epoch + block.index + block.prevHash)

}