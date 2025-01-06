import level from 'level-8'


const ENCODING_OPTS = {keyEncoding: 'view', valueEncoding: 'view'}

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