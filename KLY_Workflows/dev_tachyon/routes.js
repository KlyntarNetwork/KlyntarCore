// Just import all needed modules with routes

let modules = [
    
    'api/block_data.js',
    'api/epoch_data.js',
    'api/misc.js',
    'api/state_data.js',
    
    'internal_logic/epoch_changing.js',
    'internal_logic/websocket.js',
    
    'kly_evm_json_rpc.js'

]


for(let modPath of modules) await import(`./routes/${modPath}`)