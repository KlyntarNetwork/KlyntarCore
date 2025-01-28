import {logColors} from '../../../KLY_Utils/utils.js'

import {CONFIGURATION} from '../../../klyntar_core.js'

import {WORKING_THREADS} from '../globals.js'










// Function for pretty output the information about verification thread(VT)

export let vtStatsLog = (epochFullID,currentLeader,blockIndex,blockHash,txsNumber) => {

    console.log(logColors.TIME_COLOR,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,logColors.CYAN,'Local VERIFICATION_THREAD state is',logColors.CLEAR)
    
    console.log('\n')
    
    console.log(` \u001b[38;5;168m│\x1b[33m  Txs number:\x1b[36;1m`,txsNumber,logColors.CLEAR)

    console.log(` \u001b[38;5;168m│\x1b[33m  Epoch:\x1b[36;1m`,`${epochFullID}`,logColors.CLEAR)

    console.log(` \u001b[38;5;168m│\x1b[33m  SID:\x1b[36;1m`,`${(WORKING_THREADS.VERIFICATION_THREAD.SID_TRACKER-1)}`,logColors.CLEAR)

    console.log(` \u001b[38;5;168m│\x1b[33m  Current Leader:\x1b[36;1m`,currentLeader,logColors.CLEAR)

    console.log(` \u001b[38;5;168m│\x1b[33m  Block index and hash in current epoch:\x1b[36;1m`,blockIndex+' : '+blockHash,logColors.CLEAR)

    console.log('\n')

}




// Function just for pretty output about information on symbiotic chain

export let blockLog = (msg,hash,block,epochIndex) => {


    if(CONFIGURATION.NODE_LEVEL.DAEMON_LOGS){

        let preColor = msg.includes('accepted') ? '\x1b[31m' : '\x1b[32m'

        console.log(logColors.TIME_COLOR,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,logColors.CYAN,msg,logColors.CLEAR)

        console.log('\n')
        
        console.log(` ${preColor}│\x1b[33m  ID:\x1b[36;1m`,epochIndex+':'+block.creator+':'+block.index,logColors.CLEAR)

        console.log(` ${preColor}│\x1b[33m  Hash:\x1b[36;1m`,hash,logColors.CLEAR)

        console.log(` ${preColor}│\x1b[33m  Txs:\x1b[36;1m`,block.transactions.length,logColors.CLEAR)

        console.log(` ${preColor}│\x1b[33m  Time:\x1b[36;1m`,new Date(block.time).toString(),logColors.CLEAR)
    
        console.log('\n')

    }

}