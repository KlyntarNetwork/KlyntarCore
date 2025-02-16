import {FASTIFY_SERVER} from '../klyntar_core.js'

import cryptoModule from 'crypto'

import {hash} from 'blake3-wasm'

import Base58 from 'base-58'

import fs from 'fs'




process.env.KLY_MODE||='mainnet'




//_____________________________________________________________EXPORT SECTION____________________________________________________________________




export const logColors = {
    
    CLEAR:'\x1b[0m',
    TIME_COLOR:`\u001b[38;5;${process.env.KLY_MODE==='mainnet'?'23':'202'}m`, // for time view
    
    RED:'\x1b[31;1m', // red(error,no collapse,problems with sequence,etc.)
    GREEN:'\x1b[32;1m', // green(new block, exported something, something important, etc.)
    YELLOW:'\u001b[38;5;3m', // yellow(non critical warnings)
    CYAN:'\x1b[36;1m', // cyan(default messages useful to grasp the events)
    
    CD:`\u001b[38;5;50m`,//Canary died
    CON:`\u001b[38;5;168m`//CONFIGS

}




export let pathResolve=path=>__dirname+'/'+path // path is relative to this root scope */KLYNTARCORE

export let blake3Hash=(input,length)=>hash(input,{length}).toString('hex')

export let getUtcTimestamp=()=>new Date().getTime()


/**
 * Verifies the signature of given data using an Ed25519 public key.
 * 
 * @param {string} data - UTF-8 encoded data (usually BLAKE3 hashes).
 * @param {string} signature - Base64 encoded signature.
 * @param {string} pubKey - Ed25519 public key in RFC8410 format.
 * @returns {Promise<boolean>} Promise that resolves to true if the signature is valid, and false otherwise.
 */
export let verifyEd25519 = (data, signature, pubKey) => {
    
    return new Promise((resolve, reject) => {

        // Decode public key from Base58 and encode to hex , add  

        let pubInHex = Buffer.from(Base58.decode(pubKey)).toString('hex')

        // Now add ASN.1 prefix

        let pubWithAsnPrefix = '302a300506032b6570032100'+pubInHex

        // Encode to Base64

        let pubAsBase64 = Buffer.from(pubWithAsnPrefix,'hex').toString('base64')

        // Finally, add required prefix and postfix

        let finalPubKey = `-----BEGIN PUBLIC KEY-----\n${pubAsBase64}\n-----END PUBLIC KEY-----`

        cryptoModule.verify(null, data, finalPubKey, Buffer.from(signature, 'base64'), (err, isVerified) => 

            err ? reject(false) : resolve(isVerified)

        )


    }).catch(() => false)

}




/**
 * Verifies the signature of given data using an Ed25519 public key.
 * 
 * @param {string} data - UTF-8 encoded data (usually BLAKE3 hashes).
 * @param {string} signature - Base64 encoded signature.
 * @param {string} pubKey - Ed25519 public key in RFC8410 format.
 * @returns {boolean} True if the signature is valid, and false otherwise.
 */
export let verifyEd25519Sync = (data, signature, pubKey) => {
        
    // Decode public key from Base58 and encode to hex
    let pubInHex = Buffer.from(Base58.decode(pubKey)).toString('hex');

    // Now add ASN.1 prefix
    let pubWithAsnPrefix = '302a300506032b6570032100' + pubInHex;

    // Encode to Base64
    let pubAsBase64 = Buffer.from(pubWithAsnPrefix, 'hex').toString('base64');

    // Finally, add required prefix and postfix
    let finalPubKey = `-----BEGIN PUBLIC KEY-----\n${pubAsBase64}\n-----END PUBLIC KEY-----`;

    return cryptoModule.verify(null, data, finalPubKey, Buffer.from(signature, 'base64'))


}




/*

***********************************************FIRST BYTES OF EACH KEYPAIR ED25519***********************************************
*                                                                                                                               *
*    30 2a 30 05 06 03 2b 65 70 03 21 00              -> 44-12(these)=32 bytes pubkey                                           *
*    30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20  -> 48-16(these)=32 bytes private key entropy                              *
*                                                                                                                               *
*********************************************************************************************************************************

*/




/**
 * Signs the provided data using an Ed25519 private key and returns the signature.
 * 
 * @param {string} data - UTF-8 encoded data (usually BLAKE3 hashes).
 * @param {string} prv - Ed25519 private key in RFC8410 format.
 * @returns {Promise<string>} Promise that resolves to the Base64 encoded Ed25519 signature, or an empty string on failure.
 */
export let signEd25519 = (data, prv) => {

    return new Promise((resolve, reject) => {

        const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${prv}\n-----END PRIVATE KEY-----`

        cryptoModule.sign(null, Buffer.from(data), privateKeyPem, (error, signature) => {

            error ? reject('') : resolve(signature.toString('base64'))

        })

    }).catch(() => '')

}




export let customLog=(msg,msgColor)=>{

    console.log(logColors.TIME_COLOR,`[${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}]\u001b[38;5;99m(pid:${process.pid})`,msgColor,msg,logColors.CLEAR)

}



export let gracefulStop = async() => {

    console.log('\n')

    customLog('\x1b[31;1mKLYNTAR\x1b[36;1m stop has been initiated.Keep waiting...',logColors.CYAN)
    
    customLog(fs.readFileSync(pathResolve('images/events/termination.txt')).toString(),logColors.YELLOW)

    console.log('\n')

    customLog('Closing server connections...',logColors.CYAN)

    await FASTIFY_SERVER.close()

    customLog('Node was gracefully stopped',logColors.CYAN)
        
    process.exit(0)

}

process.on('SIGTERM',gracefulStop)
process.on('SIGINT',gracefulStop)
process.on('SIGHUP',gracefulStop)