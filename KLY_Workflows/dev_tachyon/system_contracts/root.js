export const SYSTEM_CONTRACTS = new Map()


let systemContractsNames = ['abstractions','cross_shards_messaging','dao_voting','multistaking','rwx_contract','staking']


for(let name of systemContractsNames){

    SYSTEM_CONTRACTS.set(name,true)

}