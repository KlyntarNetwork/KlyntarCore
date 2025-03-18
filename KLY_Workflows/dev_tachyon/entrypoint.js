// Main threads - main core logic

import {shareBlocksAndGetFinalizationProofs} from './life/share_block_and_grab_proofs.js'

import {findAefpsAndFirstBlocksForCurrentEpoch} from './life/find_new_epoch.js'

import {startVerificationThread} from './verification_process/verification.js'

import {blocksGenerationProcess} from './life/block_generation.js'

import {prepareBlockchain} from './blockchain_preparation.js'

import {startVotingThread} from './life/voting_thread.js'








export let runBlockchain=async()=>{


    await prepareBlockchain()


    //_________________________ RUN SEVERAL ASYNC THREADS _________________________

    //✅1.Start verification process - process blocks and find new epoch step-by-step
    startVerificationThread()

    //✅2.Thread to find AEFPs and change the epoch for AT
    findAefpsAndFirstBlocksForCurrentEpoch()

    //✅3.Share our blocks within quorum members and get the finalization proofs
    shareBlocksAndGetFinalizationProofs()

    //✅4.Start to generate blocks
    blocksGenerationProcess()

    //✅5.Start to check requests for block voting
    startVotingThread()

}