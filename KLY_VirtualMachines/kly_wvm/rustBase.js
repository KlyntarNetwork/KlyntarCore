import {CONFIGURATION} from '../../klyntar_core.js'

import loader from '@assemblyscript/loader'

import metering from 'wasm-metering'

import {TextDecoder} from 'util'



let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })

let {TYPE,FUNCTION_NAME,MODULE_NAME} = CONFIGURATION.KLY_WVM.METERING

let cachedTextEncoder = new TextEncoder('utf-8')



let encodeString = () => {

    if(typeof cachedTextEncoder.encodeInto === 'function'){

        return (arg,view) => cachedTextEncoder.encodeInto(arg, view)

    }else{

        return (arg,view) => {

            const buf = cachedTextEncoder.encode(arg)
            
            view.set(buf)
            
            return {
                
                read: arg.length,
                
                written: buf.length
            
            }

        }

    }

}


let isLikeNone = x => x === undefined || x === null




export default class ContractInstance {

    constructor(extraImports,bytecode){
    
        this.imports = {

            __wbindgen_placeholder__:{

                //_______________________________ Required _______________________________
                
                __wbindgen_is_undefined:this.__wbindgen_is_undefined,

                __wbg_stringify_029a979dfb73aa17:this.__wbg_stringify_e25465938f3f611f,

                __wbindgen_object_drop_ref:this.__wbindgen_object_drop_ref,

                __wbg_parse_3ac95b51fc312db8:this.__wbg_parse_670c19d4e984792e,

                __wbindgen_string_get:this.__wbindgen_string_get,
                
                __wbindgen_throw:this.__wbindgen_throw,

                //________________________________ Extra _________________________________

                ...extraImports

            }

        }

        this.heap = new Array(128).fill(undefined)
        this.wasm = bytecode
        this.WASM_VECTOR_LEN=0
        this.cachedUint8Memory0 = null
        this.cachedInt32Memory0 = null

        // Initial push
        this.heap.push(undefined, null, true, false)

        this.heap_next = this.heap.length 
    
    }



    setUpContract = async gasLimit => {


        //Modify contract to inject metering functions
        let prePreparedContractBytecode = metering.meterWASM(this.wasm,{
    
            meterType:TYPE,
            
            fieldStr:FUNCTION_NAME,
        
            moduleStr:MODULE_NAME,
        
            //And cost table to meter gas usage by opcodes price
            costTable:CONFIGURATION.KLY_WVM.GAS_TABLE,
        
        })


        //Prepare pointer to contract metadata to track changes in gas changes
        let contractGasHandler = {

            gasLimit,
            gasBurned:0

        }


        //Inject metering function
        let contractInstance = await loader.instantiate(prePreparedContractBytecode,{

            metering: {
                
                burnGas: gasAmount => {
                    
                    contractGasHandler.gasBurned += gasAmount
            
                    if (contractGasHandler.gasBurned > contractGasHandler.gasLimit) throw new Error(`No more gas => Limit:${contractGasHandler.gasLimit}        |       Burned:${contractGasHandler.gasBurned}`)
          
                }
            
            },

            ...this.imports
        
        }).then(contract=>contract.exports)

        
        this.wasm = contractInstance

        return {contractInstance,contractGasHandler}

    }

    getObject = idx => this.heap[idx]

    getUint8Memory0 = () => {

        if (this.cachedUint8Memory0 === null || this.cachedUint8Memory0.byteLength === 0) {
            
            this.cachedUint8Memory0 = new Uint8Array(this.wasm.memory.buffer)
        
        }

        return this.cachedUint8Memory0
    
    }

    getInt32Memory0 = () => {

        if (this.cachedInt32Memory0 === null || this.cachedInt32Memory0.byteLength === 0) {
    
            this.cachedInt32Memory0 = new Int32Array(this.wasm.memory.buffer)
    
        }
    
        return this.cachedInt32Memory0
   
    }
    
    passStringToWasm0 = (arg, malloc, realloc) => {

        if (realloc === undefined) {

            let buf = cachedTextEncoder.encode(arg),

                ptr = malloc(buf.length, 1) >>> 0

            this.getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf)

            this.WASM_VECTOR_LEN = buf.length

            return ptr
        
        }

        let len = arg.length, 

            ptr = malloc(len, 1) >>> 0,

            mem = this.getUint8Memory0(),

            offset = 0


        for (; offset < len; offset++) {

            const code = arg.charCodeAt(offset)

            if (code > 0x7F) break

            mem[ptr + offset] = code
        
        }

        if (offset !== len) {

            if (offset !== 0) arg = arg.slice(offset)

            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0

            let view = this.getUint8Memory0().subarray(ptr + offset, ptr + len), ret = encodeString(arg, view)

            offset += ret.written
        }

        this.WASM_VECTOR_LEN = offset

        return ptr

    }

    dropObject = idx => {

        if (idx < 132) return
    
        this.heap[idx] = this.heap_next
 
        this.heap_next = idx
    
    }


    takeObject = idx => {

        const ret = this.getObject(idx)
        
        this.dropObject(idx)
        
        return ret
    
    }

    getStringFromWasm0 = (ptr, len) => {

        ptr = ptr >>> 0

        return cachedTextDecoder.decode(this.getUint8Memory0().subarray(ptr, ptr + len))

    }

    addHeapObject = obj => {
        
        if (this.heap_next === this.heap.length) this.heap.push(this.heap.length + 1)
        
        const idx = this.heap_next
        
        this.heap_next = this.heap[idx]
    
        this.heap[idx] = obj

        return idx

    }

    handleError = (f, args) => {
        
        try {
    
            return f.apply(this,args);
    
        } catch (e) {
    
            this.wasm.__wbindgen_exn_store(this.addHeapObject(e))
    
        }
    
    }

    __wbg_parse_670c19d4e984792e=(...args)=>{
        
        return this.handleError((arg0, arg1)=>{
            
            const ret = JSON.parse(this.getStringFromWasm0(arg0,arg1))
            
            return this.addHeapObject(ret)
        
        
        },args)
    
    }

    __wbindgen_is_undefined = arg0 => {
    
        const ret = this.getObject(arg0) === undefined
    
        return ret
    
    }

    __wbg_stringify_e25465938f3f611f=(...args)=>{
        
        return this.handleError(arg0 => {
            
            const ret = JSON.stringify(this.getObject(arg0))
            
            return this.addHeapObject(ret)
    
        },args) 
    
    }


    __wbindgen_string_get=(arg0, arg1)=>{

        const obj = this.getObject(arg1)
        
        const ret = typeof(obj) === 'string' ? obj : undefined
        
        var ptr0 = isLikeNone(ret) ? 0 : this.passStringToWasm0(ret,this.wasm.__wbindgen_malloc,this.wasm.__wbindgen_realloc)

        var len0 = this.WASM_VECTOR_LEN
        
        this.getInt32Memory0()[arg0 / 4 + 1] = len0
        this.getInt32Memory0()[arg0 / 4 + 0] = ptr0
    
    }

    __wbindgen_object_drop_ref = arg0 => {

        this.takeObject(arg0)
    
    }

    __wbindgen_throw = (arg0, arg1) => {

        throw new Error(this.getStringFromWasm0(arg0,arg1))
    
    }



}