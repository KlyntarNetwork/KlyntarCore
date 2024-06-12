// 7 main threads - main core logic

import {buildTemporarySequenceForVerificationThread} from './life/temp_vt_sequence_builder.js'

import {shareBlocksAndGetFinalizationProofs} from './life/share_block_and_grab_proofs.js'

import {startVerificationThread} from './verification_process/verification.js'

import {findAggregatedEpochFinalizationProofs} from './life/find_new_epoch.js'

import {shardsLeadersMonitoring} from './life/shards_leaders_monitoring.js'

import {checkIfItsTimeToStartNewEpoch} from './life/new_epoch_proposer.js'

import {blocksGenerationProcess} from './life/block_generation.js'

import {CONFIGURATION, BLOCKCHAIN_GENESIS} from '../../klyn74r.js'

import {prepareBlockchain} from './blockchain_preparation.js'

import {customLog, logColors} from '../../KLY_Utils/utils.js'









export let runBlockchain=async()=>{


    await prepareBlockchain()


    //_________________________ RUN SEVERAL ASYNC THREADS _________________________

    //✅0.Start verification process - process blocks and find new epoch step-by-step
    startVerificationThread()

    //✅1.Thread to find AEFPs and change the epoch for QT
    findAggregatedEpochFinalizationProofs()

    //✅2.Share our blocks within quorum members and get the finalization proofs
    shareBlocksAndGetFinalizationProofs()

    //✅3.Thread to propose AEFPs to move to next epoch
    checkIfItsTimeToStartNewEpoch()

    //✅4.Thread to track changes of leaders on shards
    shardsLeadersMonitoring()

    //✅5.Function to build the temporary sequence of blocks to verify them
    buildTemporarySequenceForVerificationThread()

    //✅6.Start to generate blocks
    blocksGenerationProcess()


    

    //Check if bootstrap nodes is alive
    CONFIGURATION.NODE_LEVEL.BOOTSTRAP_NODES.forEach(endpoint=>
                
        fetch(endpoint+'/addpeer',{
            
            method:'POST',
            
            body:JSON.stringify([BLOCKCHAIN_GENESIS.SYMBIOTE_ID,CONFIGURATION.NODE_LEVEL.MY_HOSTNAME]),

            headers:{'contentType':'application/json'}
        
        })
            
            .then(res=>res.text())
            
            .then(val=>customLog(val==='OK'?`Received pingback from \x1b[32;1m${endpoint}\x1b[36;1m. Node is \x1b[32;1malive`:`\x1b[36;1mAnswer from bootstrap \x1b[32;1m${endpoint}\x1b[36;1m => \x1b[34;1m${val}`,logColors.CYAN))
            
            .catch(error=>customLog(`Bootstrap node \x1b[32;1m${endpoint}\x1b[31;1m send no response or some error occured \n${error}`,logColors.RED))

    )

}