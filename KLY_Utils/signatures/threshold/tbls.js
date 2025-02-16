// https://github.com/ameba23/dkg/blob/master/example.js


import * as dkg from './tbls_index.js'

import bls from 'bls-eth-wasm'


await bls.init(bls.BLS12_381)


export default {

    generateTBLS:(threshold,myPubId,pubKeysArr)=>{

        let signers=pubKeysArr.map(id => {

            const sk = new bls.SecretKey()
        
            sk.setHashOf(Buffer.from([id]))
        
            return {id:sk,recievedShares:[],arrId:id}
        
        })

        //Вот процесс генерации для участников - они могут это делать приватно у себя
        //Generation process - signers can do it privately on theirs machines
        const {verificationVector,secretKeyContribution} = dkg.generateContribution(bls,signers.map(x=>x.id),threshold)
      
        //To transfer over network in hex
        //Verification vector можем публиковать - для каждого в группе. Только запоминать порядок индексов
        let serializedVerificationVector=verificationVector.map(x=>x.serializeToHexStr())

        let serializedSecretKeyContribution=secretKeyContribution.map(x=>x.serializeToHexStr())

        let serializedId=signers[pubKeysArr.indexOf(myPubId)].id.serializeToHexStr()

        return JSON.stringify({
        
            verificationVector:serializedVerificationVector,
            secretShares:serializedSecretKeyContribution,
            id:serializedId
        
        })

    },

    
    verifyShareTBLS:(hexMyId,hexSomeSignerSecretKeyContribution,hexSomeSignerVerificationVector)=>{
        
        //Deserialize at first from hex
        let someSignerSecretKeyContribution=bls.deserializeHexStrToSecretKey(hexSomeSignerSecretKeyContribution)
        
        let someSignerVerificationVector=hexSomeSignerVerificationVector.map(x=>bls.deserializeHexStrToPublicKey(x))
        let myId = bls.deserializeHexStrToSecretKey(hexMyId)
    
        // Теперь когда нужный член групы получил этот secret sk,то он проверяет его по VSS с помощью verification vector of the sender и сохраняет его если всё ок
        const isVerified = dkg.verifyContributionShare(bls,myId,someSignerSecretKeyContribution,someSignerVerificationVector)
     
        return isVerified

    },    


    
    
    /**
     *   ## Derive public TBLS key from verification vectors of signers sides 
     *
     *   @param {Array<Array<string>>} hexVerificationVectors array of serialized verification vectors e.g. [ [hex1,hex2], [hex3,hex4], ...] where [hexA,hexB] - some verification vector 
     * 
     */
    deriveGroupPubTBLS:(hexVerificationVectors)=>{

        const groupVvec = dkg.addVerificationVectors(hexVerificationVectors.map(subArr=>

            subArr.map(x=>bls.deserializeHexStrToPublicKey(x))

        ))
        
        const groupPublicKey = groupVvec[0].serializeToHexStr()

        return groupPublicKey

    },



    /*

    На вход поступают данные вида

    {

        hexMyId - id из первоначального массива signers из generateTBLS
        sharedPayload:[
            {
                verificationVector://VV of signer1 - array of hex values
                secretKeyShare://share received from signer1 - hex value
            },
            {
                verificationVector://VV of signer2
                secretKeyShare://share received from signer2
            },
            ...,
            {
                verificationVector://VV of signerN
                secretKeyShare://share received from signerN

            }
        ]

    }

*/
    signTBLS:(hexMyId,sharedPayload,message)=>{

        //Derive group TBLS secret key for this signer
        let groupSecret=dkg.addContributionShares(

            sharedPayload

                .map(x=>x.secretKeyShare)//get only secretshare part
                .map(hexValue=>bls.deserializeHexStrToSecretKey(hexValue))

        )

        //The rest of t signers do the same with the same message

        return JSON.stringify({sigShare:groupSecret.sign(message).serializeToHexStr(),id:hexMyId})

    },


    
    /*

        signaturesArray - [ {sigShare:signedShareA,id:hexIdA}, {sigShare:signedShareB,id:hexIdB},... {sigShare:signedShareX,id:hexIdX} ]

    */
    buildSignature:signaturesArray=>{

        //Now join signatures by t signers
        const groupsSig = new bls.Signature()

        let sigs=[],signersIds=[]

        signaturesArray.forEach(x=>{

            sigs.push(bls.deserializeHexStrToSignature(x.sigShare))

            signersIds.push(bls.deserializeHexStrToSecretKey(x.id))

        })

        groupsSig.recover(sigs,signersIds)

        //blsA.deserializeHexStrToSignature(groupsSig.serializeToHexStr())

        return groupsSig.serializeToHexStr()

    },

    verifyTBLS:(hexGroupPubKey,hexSignature,signedMessage)=>{


        let groupPubKey=bls.deserializeHexStrToPublicKey(hexGroupPubKey),

            verified=groupPubKey.verify(bls.deserializeHexStrToSignature(hexSignature),signedMessage)


        return verified

    }

}