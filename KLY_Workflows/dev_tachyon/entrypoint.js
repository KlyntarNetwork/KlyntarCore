// Main threads - main core logic

import {shareBlocksAndGetFinalizationProofs} from './life/share_block_and_grab_proofs.js'

import {findAefpsAndFirstBlocksForCurrentEpoch} from './life/find_new_epoch.js'

import {startVerificationThread} from './verification_process/verification.js'

import {checkIfItsTimeToStartNewEpoch} from './life/new_epoch_proposer.js'

import {CONFIGURATION, BLOCKCHAIN_GENESIS} from '../../klyntar_core.js'

import {blocksGenerationProcess} from './life/block_generation.js'

import {prepareBlockchain} from './blockchain_preparation.js'

import {customLog, logColors} from '../../KLY_Utils/utils.js'









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

    //✅5.Start to generate blocks
    blocksGenerationProcess()


    

    // Check if bootstrap nodes are alive

    for(let endpoint of CONFIGURATION.NODE_LEVEL.BOOTSTRAP_NODES){

        const controller = new AbortController()

        setTimeout(() => controller.abort(), 2000)

        fetch(endpoint+'/addpeer',{

            signal: controller.signal,
            
            method:'POST',
            
            body:JSON.stringify([BLOCKCHAIN_GENESIS.NETWORK_ID,CONFIGURATION.NODE_LEVEL.MY_HOSTNAME]),

            headers:{'contentType':'application/json'}
        
        })
            
            .then(res=>res.text())
            
            .then(val=>customLog(val==='OK'?`Received pingback from \x1b[32;1m${endpoint}\x1b[36;1m. Node is \x1b[32;1malive`:`\x1b[36;1mAnswer from bootstrap \x1b[32;1m${endpoint}\x1b[36;1m => \x1b[34;1m${val}`,logColors.CYAN))
            
            .catch(error=>customLog(`Bootstrap node \x1b[32;1m${endpoint}\x1b[31;1m send no response or some error occured \n${error}`,logColors.RED))


    }

}