import {findTemporaryInfoAboutFinalBlocksByPreviousPools} from './life/temp_vt_sequence_builder.js'

import {shareBlocksAndGetFinalizationProofs} from './life/share_block_and_grab_proofs.js'

import {findAefpsAndFirstBlocksForCurrentEpoch} from './life/find_new_epoch.js'

import {startVerificationThread} from './verification_process/verification.js'

import {checkIfItsTimeToStartNewEpoch} from './life/new_epoch_proposer.js'

import {leadersSequenceMonitoring} from './life/leaders_monitoring.js'

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

    //✅4.Thread to propose AEFPs to move to next epoch
    checkIfItsTimeToStartNewEpoch()

    //✅5.Thread to track changes of leaders rotation
    leadersSequenceMonitoring()

    //✅6.Function to build the temporary sequence of blocks to verify them
    findTemporaryInfoAboutFinalBlocksByPreviousPools()

    //✅7.Start to generate blocks
    blocksGenerationProcess()

    //✅8.Start a separate thread to work with voting for blocks in a sync way (for security)
    startVotingThread()

}