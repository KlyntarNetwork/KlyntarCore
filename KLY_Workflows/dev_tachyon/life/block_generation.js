import {BLOCKCHAIN_DATABASES, EPOCH_METADATA_MAPPING, NODE_METADATA, WORKING_THREADS} from '../blockchain_preparation.js'

import {getQuorumMajority, getQuorumUrlsAndPubkeys} from '../common_functions/quorum_related.js'

import {verifyAggregatedEpochFinalizationProof} from '../common_functions/work_with_proofs.js'

import {getUserAccountFromState} from '../common_functions/state_interactions.js'

import {signEd25519} from '../../../KLY_Utils/utils.js'

import {blockLog} from '../common_functions/logging.js'

import {BLOCKCHAIN_GENESIS, CONFIGURATION} from '../../../klyn74r.js'

import {getAllKnownPeers} from '../utils.js'

import Block from '../structures/block.js'

import fetch from 'node-fetch'

import Web1337 from 'web1337'




let web1337 = new Web1337({

    chainID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    workflowVersion:0,
    nodeURL:'http://localhost:7332'
    
});




export let blocksGenerationProcess=async()=>{

    await generateBlocksPortion()

    setTimeout(blocksGenerationProcess,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.BLOCK_TIME)
 
}


let getTransactionsFromMempool = () => NODE_METADATA.MEMPOOL.splice(0,WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK)


let mockTestPairs = {

    // Ed25519 keypairs

    "9GQ46rqY238rk2neSwgidap9ww5zbAN4dyqyC7j5ZnBK": "MC4CAQAwBQYDK2VwBCIEILdhTMVYFz2GP8+uKUA+1FnZTEdN8eHFzbb8400cpEU9",
    "6XvZpuCDjdvSuot3eLr24C1wqzcf2w4QqeDh9BnDKsNE": "MC4CAQAwBQYDK2VwBCIEIJT7NA/u+Df874H2DFRbyg43LpJwlhcRsS3Bv8/FUIZN",
    "GUbYLN5NqmRocMBHqS183r2FQRoUjhx1p5nKyyUBpntQ": "MC4CAQAwBQYDK2VwBCIEILjvmDeOmyg1/VG2VKQTzsv6lkIizQpjmRsdfEEIHHU8",
    "3JAeBnsMedzxjCMNWQYcAXtwGVE9A5DBQyXgWBujtL9R": "MC4CAQAwBQYDK2VwBCIEIDteWfNev7NOlNmwP8Irwg5miWKoErYGV+UU5VrFgYev",
    "EGU4u3Anwahbtbx8F1ZZgFQSg2u49EkrkqMERT9r3q1o": "MC4CAQAwBQYDK2VwBCIEICVoiHLIICxjcuWQzq1vTLGJmaiU9fAOLEYKB9ZQR8TN",


    // BLS keypairs

    "0xb2ec32c9d7216163790ba3628a6a6b5a12db457c933b1f4627775b6dae468636233c6ad9931a8ef848a58353e60d33dd":"3981d303762bd2016644021e95052c50cb0916470a7eb36205bb12b97913523a",
    "0x8f079049121d5e2ae885bdc6581df9fb68eab94a7aa3ae54bfe1d1ac35aceefbb202f656b0c1b56d64583630612a9970":"53f9079e2bcda99737d1024564ff422a18fcaf931059a3da76646dbbba85874b",
};


let postQuantumBlissKeypair = {

    pubKey: '0012d71baf1524047e13c5006d00cf0cc3123e0ffe00941dda123a1c1806b50d261b660da60414067b13220793131b1d87099d0571175e0884092512c80d4308ab074e090502220c3519001ac10aad1126085e1c270cf815dc10dc04b508931a870b6619e0067e10cf0a7f1c3b04841452174400fc08ed0507040d1d39176b025b06d317e90057145017090e3907201dd50818020e0e74003504400a1a182c14f609f6117902981367191104050add14bd0b031af10c3e02a1160003011a5b137d00c8167b04521c4b1b9016250aeb01b7038d10a818da144406c91bca1b33195e0fd20930193e0dfa11f20f340da50b1215b51d21197c11060de009eb0c8201fb14110be00ec503bd065207a70953132d1a38115b153507da0a3e01290c8016af1d2c18a417100c1508cc112f146a130c013b014704471dbc02c20038013415621985124419ae10a501170eb70e6d0b220ee405ef17ff1c9b0dce0a1f07a204cf1b7b18b9013a0bdc00af187d169e050e0c201b5915c709b011db11170b06159b1cbe03691d860d00028d187d0e61074a1673027a047f16281bac0cfd09a00a62050c07ee1058020e006407de0adc1036136b10b417eb1b12155919b105f60b1d0bde0a57127b0007087d150c11690b7800930f1e16ec19ac0b8d1d7e1b0f02321c90148d1a47075a091113c9159e051113b403b5063001d3186e13b211c70d20',
    privateKey: 'ba17dd98afb6dc1d13e4aed164d318d7921722f54e26496e1bc347213f0bd77230bf2b59676e7c346b155b660067ffb044a01dcc588ac2b6eb196bda8f981a70',
    address: '4218fb0aaace62c4bfafbdd9adb05b99a9bf1a33eeae074215a51cb644b9a85c'

}


let generateBatchOfMockTransactionsAndPushToMempool = async shardID => {

    const recipient = 'Cw4MjAsm5gRQh7JaiYXvJ9kzgt5xemhe1789kvcXY1Pz';


    for(let [pubKey,privateKey] of Object.entries(mockTestPairs)){

        const from = pubKey;

        const myPrivateKey = privateKey;

        let nonce = await getUserAccountFromState(shardID+':'+pubKey).then(acc=>{

            return acc.nonce

        })

        nonce++

        const fee = 0.03;

        const amountInKLY = 2;

        let signedTx

        let payload = {

            to: recipient,

            amount: amountInKLY,

            touchedAccounts: [pubKey, recipient]

        }

        if(pubKey.startsWith('0x')){

            payload.active = pubKey
            
            payload.afk = []
            
            let singleSig = web1337.signDataForMultisigTransaction(shardID,'TX',privateKey,nonce,fee,payload)

            let signature = singleSig

            signedTx = await web1337.createMultisigTransaction(from,'TX',signature,nonce,fee,payload)

        } else {

            signedTx = await web1337.createEd25519Transaction(shardID,'TX',from,myPrivateKey,nonce,fee,payload);

        }

        console.log(`TXID is => `,web1337.blake3(signedTx.sig))

        NODE_METADATA.MEMPOOL.push(signedTx)
    }

    // Also, for tests, create tx with PQC account

    const from = postQuantumBlissKeypair.address;

    const myPrivateKey = postQuantumBlissKeypair.privateKey;

    let nonce = await getUserAccountFromState(shardID+':'+from).then(acc=>{

        return acc.nonce

    })


    nonce++

    const fee = 0.03;

    const amountInKLY = 2;

    
    let payload = {

        to: recipient,

        amount: amountInKLY,

        touchedAccounts: [from, recipient]

    }

    let signedPqcTx = await web1337.createPostQuantumTransaction(shardID,'TX','bliss',from,myPrivateKey,nonce,fee,payload)

    console.log(`PQC TXID is => `,web1337.blake3(signedPqcTx.sig))

    NODE_METADATA.MEMPOOL.push(signedPqcTx)

}




/*

Function to find the AGGREGATED_EPOCH_FINALIZATION_PROOFS for appropriate shard

Ask the network in special order:

    1) Special configured URL (it might be plugin's API)
    2) Quorum members
    3) Other known peers

*/
let getAggregatedEpochFinalizationProofForPreviousEpoch = async (shardID,epochHandler) => {


    let allKnownNodes = [CONFIGURATION.NODE_LEVEL.GET_PREVIOUS_EPOCH_AGGREGATED_FINALIZATION_PROOF_URL,...await getQuorumUrlsAndPubkeys(),...getAllKnownPeers()]

    let previousEpochIndex = epochHandler.id-1

    let legacyEpochHandler = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`EPOCH_HANDLER:${previousEpochIndex}`).catch(()=>null)

    let legacyEpochFullID = legacyEpochHandler.hash+"#"+legacyEpochHandler.id

    let legacyMajority = await getQuorumMajority(legacyEpochHandler)

    let legacyQuorum = legacyEpochHandler.quorum

    // First of all - try to find it locally

    let aefpProof = await BLOCKCHAIN_DATABASES.EPOCH_DATA.get(`AEFP:${previousEpochIndex}:${shardID}`).catch(()=>null)

    if(aefpProof) return aefpProof

    else {

        for(let nodeEndpoint of allKnownNodes){

            const controller = new AbortController()

            setTimeout(() => controller.abort(), 2000)

            let finalURL = `${nodeEndpoint}/aggregated_epoch_finalization_proof/${previousEpochIndex}/${shardID}`
    
            let itsProbablyAggregatedEpochFinalizationProof = await fetch(finalURL,{signal:controller.signal}).then(r=>r.json()).catch(()=>false)
    
            let aefpProof = itsProbablyAggregatedEpochFinalizationProof?.shard === shardID && await verifyAggregatedEpochFinalizationProof(
                
                itsProbablyAggregatedEpochFinalizationProof,
    
                legacyQuorum,
    
                legacyMajority,        
    
                legacyEpochFullID
            
            )
    
            if(aefpProof) return aefpProof
    
        }    

    }
    
}





let getAggregatedLeaderRotationProof = (epochHandler,pubKeyOfOneOfPreviousLeader,hisIndexInLeadersSequence,shardID) => {

    /*
        This function is used once you become shard leader and you need to get the ALRPs for all the previous leaders
        on this shard till the pool which created at least one block
    */

    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)

    if(!currentEpochMetadata) return


    // Try to return immediately
    
    let aggregatedLeaderRotationMetadata = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`)

    let quorumMajority = getQuorumMajority(epochHandler)

    if(aggregatedLeaderRotationMetadata && Object.keys(aggregatedLeaderRotationMetadata.proofs).length >= quorumMajority){

        let {afpForFirstBlock,skipIndex,skipHash,proofs} = aggregatedLeaderRotationMetadata

        let dataToReturn = {

            firstBlockHash: afpForFirstBlock.blockHash,

            skipIndex, skipHash, proofs

        }

        return dataToReturn

    }


    // Prepare the template that we're going to send to quorum to get the ALRP

    // Create the cache to store LRPs for appropriate previous leader

    if(!currentEpochMetadata.TEMP_CACHE.has(`LRPS:${pubKeyOfOneOfPreviousLeader}`)){

        let templateToStore = {

            afpForFirstBlock:{blockHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'},

            skipIndex:-1,

            skipHash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

            skipAfp:{},

            proofs:{} // quorumMemberPubkey => SIG(`LEADER_ROTATION_PROOF:${pubKeyOfOneOfPreviousLeader}:${afpForFirstBlock.blockHash}:${skipIndex}:${skipHash}:${epochFullID}`)

        }

        currentEpochMetadata.TEMP_CACHE.set(`LRPS:${pubKeyOfOneOfPreviousLeader}`,templateToStore)
    
    }

    let futureAlrpMetadata = currentEpochMetadata.TEMP_CACHE.get(`LRPS:${pubKeyOfOneOfPreviousLeader}`)

    let messageToSend = JSON.stringify({

        route:'get_leader_rotation_proof',
     
        shard:shardID,

        afpForFirstBlock: futureAlrpMetadata.afpForFirstBlock,

        poolPubKey:pubKeyOfOneOfPreviousLeader,

        hisIndexInLeadersSequence,
        
        skipData:{

            index: futureAlrpMetadata.skipIndex,

            hash: futureAlrpMetadata.skipHash,

            afp: futureAlrpMetadata.skipAfp

        }
    
    })


    for(let pubKeyOfQuorumMember of epochHandler.quorum){
    
        // No sense to get finalization proof again if we already have

        if(futureAlrpMetadata.proofs[pubKeyOfQuorumMember]) continue

        let connection = currentEpochMetadata.TEMP_CACHE.get('WS:'+pubKeyOfQuorumMember)

        if(connection) connection.sendUTF(messageToSend)

    }

}




let generateBlocksPortion = async() => {

    let epochHandler = WORKING_THREADS.APPROVEMENT_THREAD.EPOCH
    
    let epochFullID = epochHandler.hash+"#"+epochHandler.id

    let epochIndex = epochHandler.id

    let currentEpochMetadata = EPOCH_METADATA_MAPPING.get(epochFullID)


    if(!currentEpochMetadata) return


    //_________________ No sense to generate blocks more in case we haven't approved the previous ones _________________

    let proofsGrabber = currentEpochMetadata.TEMP_CACHE.get('PROOFS_GRABBER')

    if(proofsGrabber && WORKING_THREADS.GENERATION_THREAD.epochFullId === epochFullID && WORKING_THREADS.GENERATION_THREAD.nextIndex > proofsGrabber.acceptedIndex+1) return


    // Must be string value

    let canGenerateBlocksNow = currentEpochMetadata.SHARDS_LEADERS_HANDLERS.get(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)

    // Safe "if" branch to prevent unnecessary blocks generation
    
    if(typeof canGenerateBlocksNow === 'string'){

        generateBatchOfMockTransactionsAndPushToMempool(BLOCKCHAIN_GENESIS.SHARD)

        // Check if <epochFullID> is the same in APPROVEMENT_THREAD and in GENERATION_THREAD

        if(WORKING_THREADS.GENERATION_THREAD.epochFullId !== epochFullID){

            // If new epoch - add the aggregated proof of previous epoch finalization

            if(epochIndex !== 0){

                let aefpForPreviousEpoch = await getAggregatedEpochFinalizationProofForPreviousEpoch(BLOCKCHAIN_GENESIS.SHARD,epochHandler)

                // If we can't find a proof - try to do it later
                // Only in case it's initial epoch(index is -1) - no sense to push it
                if(!aefpForPreviousEpoch) return

                WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch = aefpForPreviousEpoch

            }

            // Update the index & hash of epoch

            WORKING_THREADS.GENERATION_THREAD.epochFullId = epochFullID

            WORKING_THREADS.GENERATION_THREAD.epochIndex = epochIndex

            // Recount new values

            WORKING_THREADS.GENERATION_THREAD.quorum = epochHandler.quorum

            WORKING_THREADS.GENERATION_THREAD.majority = getQuorumMajority(epochHandler)


            // And nullish the index & hash in generation thread for new epoch

            WORKING_THREADS.GENERATION_THREAD.prevHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
 
            WORKING_THREADS.GENERATION_THREAD.nextIndex = 0
    
        }

        let extraData = {}

        //___________________ Add the AEFP to the first block of epoch ___________________

        if(WORKING_THREADS.GENERATION_THREAD.epochIndex > 0 && WORKING_THREADS.GENERATION_THREAD.nextIndex === 0){

            // Add the AEFP for previous epoch

            extraData.aefpForPreviousEpoch = WORKING_THREADS.GENERATION_THREAD.aefpForPreviousEpoch

            if(!extraData.aefpForPreviousEpoch) return


        }

        // Do it only for the first block in epoch(with index 0)

        if(WORKING_THREADS.GENERATION_THREAD.nextIndex === 0){

            // Build the template to insert to the extraData of block. Structure is {pool0:ALRP,...,poolN:ALRP}

            let leadersSequenceForShard = epochHandler.leadersSequence[BLOCKCHAIN_GENESIS.SHARD]
    
            let myIndexInLeadersSequenceForShard = leadersSequenceForShard.indexOf(CONFIGURATION.NODE_LEVEL.PUBLIC_KEY)
    

            // Get all previous pools - from zero to <my_position>

            let pubKeysOfAllThePreviousPools = leadersSequenceForShard.slice(0,myIndexInLeadersSequenceForShard).reverse()

            let indexOfPreviousLeaderInSequence = myIndexInLeadersSequenceForShard-1

            let previousLeaderPubkey = leadersSequenceForShard[indexOfPreviousLeaderInSequence]


            //_____________________ Fill the extraData.aggregatedLeadersRotationProofs _____________________


            extraData.aggregatedLeadersRotationProofs = {}

            /*

                Here we need to fill the object with aggregated leader rotation proofs (ALRPs) for all the previous pools till the pool which was rotated on not-zero height
            
                If we can't find all the required ALRPs - skip this iteration to try again later

            */

            // Add the ALRP for the previous pools in leaders sequence

            for(let leaderPubKey of pubKeysOfAllThePreviousPools){

                let vtStatsPerPool = WORKING_THREADS.VERIFICATION_THREAD.VERIFICATION_STATS_PER_POOL[leaderPubKey] || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

                let votingFinalizationPerPool = currentEpochMetadata.FINALIZATION_STATS.get(leaderPubKey) || {index:-1,hash:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',afp:{}}

                let proofThatAtLeastFirstBlockWasCreated = vtStatsPerPool.index !== 0 || votingFinalizationPerPool.index !== 0

                // We 100% need ALRP for previous pool
                // But no need in pools who created at least one block in epoch and it's not our previous pool
                
                if(leaderPubKey !== previousLeaderPubkey && proofThatAtLeastFirstBlockWasCreated) break


                let aggregatedLeaderRotationProof = getAggregatedLeaderRotationProof(epochHandler,leaderPubKey,indexOfPreviousLeaderInSequence,BLOCKCHAIN_GENESIS.SHARD)
                
                if(aggregatedLeaderRotationProof){                    

                    extraData.aggregatedLeadersRotationProofs[leaderPubKey] = aggregatedLeaderRotationProof

                    if(aggregatedLeaderRotationProof.skipIndex >= 0) break // if we hit the ALRP with non-null index(at least index >= 0) it's a 100% that sequence is not broken, so no sense to push ALRPs for previous pools 

                    indexOfPreviousLeaderInSequence--

                } else return

            }

        }

        /*

        _________________________________________GENERATE PORTION OF BLOCKS___________________________________________
    
        Here we check how many transactions(events) we have locally and generate as many blocks as it's possible
    
        */

        let numberOfBlocksToGenerate = Math.ceil(NODE_METADATA.MEMPOOL.length / WORKING_THREADS.APPROVEMENT_THREAD.NETWORK_PARAMETERS.TXS_LIMIT_PER_BLOCK)


        //_______________________________________FILL THE BLOCK WITH EXTRA DATA_________________________________________

        // 0. Add the extra data to block from configs(it might be your note, for instance)

        extraData.rest = {...CONFIGURATION.NODE_LEVEL.EXTRA_DATA_TO_BLOCK}


        if(numberOfBlocksToGenerate===0) numberOfBlocksToGenerate++

        let atomicBatch = BLOCKCHAIN_DATABASES.BLOCKS.batch()

        for(let i=0;i<numberOfBlocksToGenerate;i++){


            let blockCandidate = new Block(getTransactionsFromMempool(),extraData,WORKING_THREADS.GENERATION_THREAD.epochFullId)
                            
            let hash = Block.genHash(blockCandidate)
    
    
            blockCandidate.sig = await signEd25519(hash,CONFIGURATION.NODE_LEVEL.PRIVATE_KEY)
                
            blockLog(`New block generated`,hash,blockCandidate,WORKING_THREADS.GENERATION_THREAD.epochIndex)
    
    
            WORKING_THREADS.GENERATION_THREAD.prevHash = hash
     
            WORKING_THREADS.GENERATION_THREAD.nextIndex++
        
            // BlockID has the following format => epochID(epochIndex):Ed25519_Pubkey:IndexOfBlockInCurrentEpoch
            let blockID = WORKING_THREADS.GENERATION_THREAD.epochIndex+':'+CONFIGURATION.NODE_LEVEL.PUBLIC_KEY+':'+blockCandidate.index
    
            // Store block locally
            atomicBatch.put(blockID,blockCandidate)
               
        }
    
        // Update the GENERATION_THREAD after all
        atomicBatch.put('GT',WORKING_THREADS.GENERATION_THREAD)
    
        await atomicBatch.write()
    
    }

}