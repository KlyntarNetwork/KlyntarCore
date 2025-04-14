// Main threads - main core logic

import {startBlocksSharingAndProofsGrabingThread} from './life/share_block_and_grab_proofs.js'

import {startVerificationThread} from './verification_process/verification.js'

import {startBlocksGenerationThread} from './life/block_generation.js'

import {startEpochRotationThread} from './life/find_new_epoch.js'

import {prepareBlockchain} from './blockchain_preparation.js'

import {startVotingThread} from './life/voting_thread.js'








export let runBlockchain=async()=>{


    await prepareBlockchain()


    //_________________________ RUN SEVERAL ASYNC THREADS _________________________

    //✅1.Start verification process - execute txs inside finalized blocks
    startVerificationThread()

    //✅2.Thread to find AEFPs and change the epoch for AT
    startEpochRotationThread()

    //✅3.Share our blocks within quorum members and get the finalization proofs
    startBlocksSharingAndProofsGrabingThread()

    //✅4.Start to generate blocks
    startBlocksGenerationThread()

    //✅5.Start to check requests for block voting
    startVotingThread()

}