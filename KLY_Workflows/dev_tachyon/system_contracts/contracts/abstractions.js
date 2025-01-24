/* eslint-disable no-unused-vars */

import {verifyQuorumMajoritySolution} from "../../common_functions/work_with_proofs.js"

import {getFromState} from "../../common_functions/state_interactions.js"



export let gasUsedByMethod=methodID=>{

    if(methodID==='changeGasAmount') return 10000

    else if(methodID==='chargePaymentForStorageUsedByContract') return 10000

}




export let CONTRACT = {


    changeGasAmount:async transaction => {

        /*

            tx.payload.params format is:

            {

                targetAccount

                gasAmount:100000,

                action:'+' | '-',
                
                quorumAgreements:{

                    quorumMember1: SIG(`changeGasAmount:${targetAccount}:${gasAmount}:${action}:${transaction.creator}:${transaction.nonce}`),
                    ...

                }
                
            }
        
        */


        let {targetAccount, gasAmount, action, quorumAgreements} = transaction.payload.params

        if(typeof targetAccount === 'string' && typeof gasAmount === 'number' && typeof action === 'string' && quorumAgreements && typeof quorumAgreements === 'object'){

            let accountToModifyGasAmount = await getFromState(targetAccount)

            if(accountToModifyGasAmount){

                let dataThatShouldBeSigned = `changeGasAmount:${targetAccount}:${gasAmount}:${action}:${transaction.creator}:${transaction.nonce}` // with nonce + tx.creator to prevent replay

                if(action === '+' && verifyQuorumMajoritySolution(dataThatShouldBeSigned,quorumAgreements)) accountToModifyGasAmount.gas += gasAmount

                else if(accountToModifyGasAmount.gas - gasAmount >=0) accountToModifyGasAmount.gas -= gasAmount

                return {isOk:true}

            } else return {isOk:false, reason:'No such account'}

        } else return {isOk:false, reason:'Wrong datatypes or majority verification failed'}


    },

    
    chargePaymentForStorageUsedByContract:async(transaction,atomicBatch)=>{

        /*

            Method to charge some assets as a rent for storage used by contract. Once charge - update the .storageAbstractionLastPayment field to current value of epoch on VERIFICATION_THREAD        
        
            tx.payload.params format is:

            {

                contractID

            }
        
        */

    },

}