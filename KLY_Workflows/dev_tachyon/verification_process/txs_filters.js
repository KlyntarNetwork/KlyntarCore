/*

@Vlad@ Chernenko

*/


// You can also provide DDoS protection & WAFs & Caches & Advanced filters here

import {verifyTxSignatureAndVersion} from '../common_functions/work_with_proofs.js'

import {getUserAccountFromState} from '../common_functions/state_interactions.js'




let overviewToCheckIfTxIsOk = async(tx,originShard) => {

    let creatorAccount = await getUserAccountFromState(originShard+':'+tx.creator)

    let result = await verifyTxSignatureAndVersion('VERIFICATION_THREAD',tx,creatorAccount,originShard).catch(()=>false)

    
    if(result){

        if(tx.payload.amount) tx.payload.amount = BigInt(tx.payload.amount)
        
        return {
            
            v:tx.v,
            fee: BigInt(tx.fee),
            creator:tx.creator,
            type:tx.type,
            nonce:tx.nonce,
            payload:tx.payload,
            sigType:tx.sigType,
            sig:tx.sig
        
        }

    } else return false

}




export let TXS_FILTERS = {

    
    /*
    
    Payload

    {
        to:<address to send KLY to> default base58-ecoded ed25519 pubkey | base58 encoded BLS multisig | hex-encoded TBLS rootPub | hex-encoded pos-quantum Dilithium or BLISS address
        amount:<KLY to transfer(float)>
        
        Optional:

        rev_t:<if recipient is BLS address - then we need to give a reverse threshold(rev_t = number of members of msig who'se votes can be ignored)>
    }

    */
    TX:async (tx,originShard) => {

        return  typeof tx.payload?.amount==='string' && typeof tx.payload.to==='string' && BigInt(tx.payload.amount) > 0n && (!tx.payload.rev_t || typeof tx.payload.rev_t==='number')
                &&
                await overviewToCheckIfTxIsOk(tx,originShard)

    },

    /*
    
    Payload is

        {
            bytecode:<hexString>,
            lang:<Rust|AssemblyScript>,
            constructorParams:{}
        }

    */
    WVM_CONTRACT_DEPLOY:async (tx,originShard) => {

        return  typeof tx.payload?.bytecode==='string' && (tx.payload.lang==='Rust'||tx.payload.lang==='AssemblyScript') && tx.payload.constructorParams && typeof tx.payload.constructorParams === 'object'
                &&
                await overviewToCheckIfTxIsOk(tx,originShard)

    },

    /*
    
        Payload is

        {

            contractID:<BLAKE3 hashID of contract OR alias of contract>,
            method:<string method to call>,
            gasLimit:<maximum allowed in KLY to execute contract>,
            params:{} params to pass to function,
            imports:[] imports which should be included to contract instance to call. Example ['default.CROSS-CONTRACT','storage.GET_FROM_ARWEAVE']. As you understand, it's form like <MODULE_NAME>.<METHOD_TO_IMPORT>

        }

    */
    WVM_CALL:async (tx,originShard) => {

        return  typeof tx.payload?.contractID==='string' && tx.payload.contractID.length<=256 && typeof tx.payload.method==='string' && tx.payload.params && typeof tx.payload.params === 'object' && Array.isArray(tx.payload.imports)
                &&
                await overviewToCheckIfTxIsOk(tx,originShard)

    }

}

