import {getFromState, setToDelayedTransactions} from "../../common_functions/state_interactions.js"

import {verifyQuorumMajoritySolution} from "../../common_functions/work_with_proofs.js"




export let gasUsedByMethod=methodID=>{

    if(methodID==='changeUnobtaniumAmount') return 10000

}


export let CONTRACT = {


    changeUnobtaniumAmount:async transaction => {

        /*
        
            transaction.payload.params is 

            {

                targetPool: "PoolX",

                changesPerAccounts:{
                
                    "staker_1": -389,
                    "staker_2": 5894,
                    ...
                    "staker_N": -389

                }
                
                quorumAgreements:{

                    quorumMember1: SIG(`changeUnoAmount:${transaction.creator}:${transaction.nonce}:${targetPool}:${JSON.stringify(changesPerAccounts}`),
                    ...
                    quorumMemberPubKeyN: SIG(`changeUnoAmount:${transaction.creator}:${transaction.nonce}:${targetPool}:${JSON.stringify(changesPerAccounts}`)

                }

            }

        
        */

        let {targetPool, changesPerAccounts, quorumAgreements} = transaction.payload.params

        if(typeof targetPool === 'string' && typeof quorumAgreements === 'object' && typeof changesPerAccounts === 'object'){

            let dataThatShouldBeSigned = `changeUnoAmount:${transaction.creator}:${transaction.nonce}:${targetPool}:${JSON.stringify(changesPerAccounts)}`

            // Verify that majority approved this changes:

            let majorityApproved = verifyQuorumMajoritySolution(dataThatShouldBeSigned,quorumAgreements)

            let targetPoolExists = await getFromState(targetPool+'(POOL)_STORAGE_POOL').catch(()=>null)

            if(majorityApproved && targetPoolExists){

                // Now add it to delayed operations

                let templateToPush = {

                    type:'changeUnobtaniumAmount',

                    targetPool, changesPerAccounts

                }

                await setToDelayedTransactions(templateToPush)

                return {isOk:true}

            } else return {isOk:false, reason:'Target pool does not exists and/or majority verification failed'}

        } else return {isOk:false, reason: `Failed with input verification`}

    }

}