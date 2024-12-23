/*

██╗  ██╗██╗  ██╗   ██╗███╗   ██╗████████╗ █████╗ ██████╗     ██╗    ██╗██╗   ██╗███╗   ███╗
██║ ██╔╝██║  ╚██╗ ██╔╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗    ██║    ██║██║   ██║████╗ ████║
█████╔╝ ██║   ╚████╔╝ ██╔██╗ ██║   ██║   ███████║██████╔╝    ██║ █╗ ██║██║   ██║██╔████╔██║
██╔═██╗ ██║    ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██║██╔══██╗    ██║███╗██║╚██╗ ██╔╝██║╚██╔╝██║
██║  ██╗███████╗██║   ██║ ╚████║   ██║   ██║  ██║██║  ██║    ╚███╔███╔╝ ╚████╔╝ ██║ ╚═╝ ██║
╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝     ╚══╝╚══╝   ╚═══╝  ╚═╝     ╚═╝
                                                                                 

Here will be the implementation of WASM-VM for KLYNTAR to allow workflows to import it and use in code

*/




import {CONFIGURATION} from '../../klyn74r.js'

import ContractInstance from './rustBase.js'

import loader from '@assemblyscript/loader'

import metering from 'wasm-metering'



let {TYPE,FUNCTION_NAME,MODULE_NAME} = CONFIGURATION.KLY_WVM.METERING



export let WVM = {

    //Function to create a contract instance from WASM bytecode with injected metering function

    bytesToMeteredContract:async(contractBytecodeAsBuffer,gasLimit,contractLang,extraModules)=>{

        if(contractLang === 'AssemblyScript'){

            // Modify contract bytes to inject metering functionality

            let prePreparedContractBytecode = metering.meterWASM(contractBytecodeAsBuffer,{
    
                meterType:TYPE,
            
                fieldStr:FUNCTION_NAME,
        
                moduleStr:MODULE_NAME,
        
                //And cost table to meter gas usage by opcodes price
                costTable:CONFIGURATION.KLY_WVM.GAS_TABLE,
        
            })


            let contractGasHandler = {gasLimit, gasBurned:0n}


            //Inject metering function
            let contractInstance = await loader.instantiate(prePreparedContractBytecode,{

                metering: {
                
                    burnGas: gasAmount => {
                    
                        contractGasHandler.gasBurned += gasAmount
            
                        if (contractGasHandler.gasBurned > contractGasHandler.gasLimit) throw new Error(`No more gas => Limit:${contractGasHandler.gasLimit}        |       Burned:${contractGasHandler.gasBurned}`)
          
                    }
            
                },

                // ... and inject extra modules

                ...extraModules
        
            }).then(contract=>contract.exports)

            return {contractInstance,contractGasHandler}

        } else {

            let contract = new ContractInstance(extraModules,contractBytecodeAsBuffer)

            let contractInstanceWithGasHandler = await contract.setUpContract(gasLimit) // return instance and pointer to metadata to track gas changes => {contractInstance,contractGasHandler}
    
            return contractInstanceWithGasHandler    

        }
        
    },


    /**
     * 
     *  
     * @param {*} contractInstance - WASM contract instance with injected modules e.g. "metering" and another extra functionality 
     * @param {*} contractGasHandler - handler for gas used metering
     * @param {Object} params - object that we should pass to contract
     * @param {*} functionName - function name of contract that we should call
     * @param {'Rust'|'AssemblyScript'} contractLang
     * @returns 
     */
    callContract:(contractInstance,contractGasHandler,params,functionName,contractLang)=>{

        let result

        if(contractLang==='Rust'){

            result = contractInstance[functionName](params);

        }else if(contractLang==='AssemblyScript'){

            let pointerToParamsObject = contractInstance.__newString(JSON.stringify(params));

            contractInstance[functionName](pointerToParamsObject)

            result = contractInstance.__getString(contractInstance[functionName](pointerToParamsObject));

        }

        // Returns result as JSON

        return {result,contractGasHandler}

    },

}