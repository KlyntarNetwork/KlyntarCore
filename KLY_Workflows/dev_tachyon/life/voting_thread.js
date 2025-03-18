import { GLOBAL_CACHES } from "../globals.js"



export let startVotingThread = async() => {

    await votingThreadIteration()

    setTimeout(startVotingThread,500)

}


let votingThreadIteration = async() => {

    let epochFinishPropositionAccepted = ''

    for (const [key, value] of GLOBAL_CACHES.VOTING_REQUESTS) {

        console.log(`Ключ: ${key}, Значение: ${value}`);
    
    }

    // BLOCKCHAIN_DATABASES.FINALIZATION_VOTING_STATS.put(epochIndex+':'+block.creator,futureVotingDataToStore).then(()=>{})

    // connection.sendUTF(JSON.stringify({voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,finalizationProof,tmbProof,votedForHash:proposedBlockHash}))

    // connection.sendUTF(JSON.stringify({type:'tmb',voter:CONFIGURATION.NODE_LEVEL.PUBLIC_KEY,finalizationProof,votedForHash:proposedBlockHash}))

}