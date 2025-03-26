// LevelDB from https://github.com/ethereumjs/ethereumjs-monorepo/blob/ac053e1f9a364f8ae489159fecb79a3d0ddd7053/packages/trie/src/db.ts
// My implementation https://gist.github.com/VladChernenko/e4fca3622aa4a7c0cd1885b91f7977ac

import level from 'level'


const ENCODING_OPTS = { keyEncoding: 'buffer', valueEncoding: 'buffer' }

export class LevelDB {

    _leveldb

    constructor(leveldb) {
        
        this._leveldb = leveldb ?? level()
    
    }

    async get(key) {
    
        let value = null
    
        try {
        
            value = await this._leveldb.get(key,ENCODING_OPTS)
        
        } 
        catch (error) {
      
            if (error.notFound) {
        
                // not found, returning null
        
            }else { throw error }
        
        }
    
        return value
  
    }

    async put(key, val) {
        
        await this._leveldb.put(key, val, ENCODING_OPTS)
    
    }

    async del(key) {
    
        await this._leveldb.del(key, ENCODING_OPTS)
    
    }

    async batch(opStack) {
        
        await this._leveldb.batch(opStack, ENCODING_OPTS)
    }

    copy() {
        
        return new LevelDB(this._leveldb)
    }

}