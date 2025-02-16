import {verifyQuorumMajoritySolution} from "../../common_functions/work_with_proofs.js"

import {WORKING_THREADS} from "../../globals.js"




export let CONTRACT = {


    /*
    
        {

            votingType:'version' | 'parameters'

            payload:{

                newMajorVersion: <uint> (?)

                OR

                updateField: 'Field name from network params',
                newValue:''

            }

            quorumAgreements:{

                quorumMemberPubKey1: Signature(`votingAccept:${epochFullID}:${votingType}:${JSON.stringify(payload)}`),
                ...
                quorumMemberPubKeyN: Signature(`votingAccept:${epochFullID}:${votingType}:${JSON.stringify(payload)}`)

            }
        }

    
    */
    votingAccept:async(threadContext, transaction)=>{

        let {votingType, payload, quorumAgreements} = transaction.payload.params

        let threadById = threadContext === 'APPROVEMENT_THREAD' ? WORKING_THREADS.APPROVEMENT_THREAD : WORKING_THREADS.VERIFICATION_THREAD

        let epochFullID = threadById.EPOCH.hash+'#'+threadById.EPOCH.hash

        // Verify the majority's proof

        let dataThatShouldBeSignedByQuorum = `votingAccept:${epochFullID}:${votingType}:${JSON.stringify(payload)}`

        let majorityProofIsOk = verifyQuorumMajoritySolution(dataThatShouldBeSignedByQuorum,quorumAgreements)


        if(majorityProofIsOk){

            if(votingType === 'version') threadById.CORE_MAJOR_VERSION = payload.newMajorVersion

            else if (votingType === 'parameters') threadById.NETWORK_PARAMETERS[payload.updateField] = payload.newValue

            return {isOk:true}

        } else return {isOk:false,reason:'Majority proof verification failed'}

    }

}