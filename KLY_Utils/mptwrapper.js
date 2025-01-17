import {LevelDB} from './levelwrapper.js'

import {Trie} from '@ethereumjs/trie'

import {Level} from 'level-8'




export class MerklePatriciaWrapper {

    constructor(dbPath) {

        this.db = new LevelDB(new Level(dbPath))

        this.trie = new Trie({db:this.db})

    }

    async put(key, value) {

        const keyBuffer = Buffer.from(key,'utf8')

        const valueBuffer = Buffer.from(value,'utf8')

        await this.trie.put(keyBuffer, valueBuffer)

    }

    async get(key) {
        
        const keyBuffer = Buffer.from(key,'utf8')

        const valueBuffer = await this.trie.get(keyBuffer)

        return valueBuffer ? valueBuffer.toString('utf8') : null

    }

    async getStateRootHash() {

        let root = await this.trie.root()
    
        return root.toString('hex')
    
    }

    async rollbackToState(stateRootHex) {

        await this.trie.root(Buffer.from(stateRootHex,'hex'))
  
    }

    checkpoint(){

        this.trie.checkpoint()

    }

    async commit(){

        await this.trie.commit()

    }

}