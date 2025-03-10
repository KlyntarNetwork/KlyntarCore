"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTxReceipt = exports.runTx = void 0;
const block_1 = require("@ethereumjs/block");
const common_1 = require("@ethereumjs/common");
const tx_1 = require("@ethereumjs/tx");
const util_1 = require("@ethereumjs/util");
const debug_1 = require("debug");
const bloom_1 = require("./bloom");
const debug = (0, debug_1.debug)('vm:tx');
const debugGas = (0, debug_1.debug)('vm:tx:gas');
/**
 * Returns the hardfork excluding the merge hf which has
 * no effect on the vm execution capabilities.
 *
 * This is particularly useful in executing/evaluating the transaction
 * when chain td is not available at many places to correctly set the
 * hardfork in for e.g. vm or txs or when the chain is not fully synced yet.
 *
 * @returns Hardfork name
 */
function execHardfork(hardfork, preMergeHf) {
    return hardfork !== common_1.Hardfork.Merge ? hardfork : preMergeHf;
}
/**
 * @ignore
 */
async function runTx(opts) {

    // KLY-EVM extra data
    
    this.eei.isSandboxExecution = opts.isSandboxExecution
    this.eei.accountAbstractionV2Data = opts.accountAbstractionV2Data

    // create a reasonable default if no block is given
    opts.block = opts.block ?? block_1.Block.fromBlockData({}, { common: this._common });
    if (opts.skipHardForkValidation !== true) {
        // Find and set preMerge hf for easy access later
        const hfs = this._common.hardforks();
        const preMergeIndex = hfs.findIndex((hf) => hf.ttd !== null && hf.ttd !== undefined) - 1;
        // If no pre merge hf found, set it to first hf even if its merge
        const preMergeHf = preMergeIndex >= 0 ? hfs[preMergeIndex].name : hfs[0].name;
        // If block and tx don't have a same hardfork, set tx hardfork to block
        if (execHardfork(opts.tx.common.hardfork(), preMergeHf) !==
            execHardfork(opts.block._common.hardfork(), preMergeHf)) {
            opts.tx.common.setHardfork(opts.block._common.hardfork());
        }
        if (execHardfork(opts.block._common.hardfork(), preMergeHf) !==
            execHardfork(this._common.hardfork(), preMergeHf)) {
            // Block and VM's hardfork should match as well
            const msg = _errorMsg('block has a different hardfork than the vm', this, opts.block, opts.tx);
            throw new Error(msg);
        }
    }
    if (opts.skipBlockGasLimitValidation !== true && opts.block.header.gasLimit < opts.tx.gasLimit) {
        const msg = _errorMsg('tx has a higher gas limit than the block', this, opts.block, opts.tx);
        throw new Error(msg);
    }
    const state = this.eei;
    if (opts.reportAccessList === true && !('generateAccessList' in state)) {
        const msg = _errorMsg('reportAccessList needs a StateManager implementing the generateAccessList() method', this, opts.block, opts.tx);
        throw new Error(msg);
    }
    // Ensure we start with a clear warmed accounts Map
    if (this._common.isActivatedEIP(2929) === true) {
        state.clearWarmedAccounts();
    }
    await state.checkpoint();
    if (this.DEBUG) {
        debug('-'.repeat(100));
        debug(`tx checkpoint`);
    }
    // Typed transaction specific setup tasks
    if (opts.tx.supports(tx_1.Capability.EIP2718TypedTransaction) &&
        this._common.isActivatedEIP(2718) === true) {
        // Is it an Access List transaction?
        if (this._common.isActivatedEIP(2930) === false) {
            await state.revert();
            const msg = _errorMsg('Cannot run transaction: EIP 2930 is not activated.', this, opts.block, opts.tx);
            throw new Error(msg);
        }
        if (opts.reportAccessList === true && !('generateAccessList' in state)) {
            await state.revert();
            const msg = _errorMsg('StateManager needs to implement generateAccessList() when running with reportAccessList option', this, opts.block, opts.tx);
            throw new Error(msg);
        }
        if (opts.tx.supports(tx_1.Capability.EIP1559FeeMarket) &&
            this._common.isActivatedEIP(1559) === false) {
            await state.revert();
            const msg = _errorMsg('Cannot run transaction: EIP 1559 is not activated.', this, opts.block, opts.tx);
            throw new Error(msg);
        }
        const castedTx = opts.tx;
        for (const accessListItem of castedTx.AccessListJSON) {
            const address = (0, util_1.toBuffer)(accessListItem.address);
            state.addWarmedAddress(address);
            for (const storageKey of accessListItem.storageKeys) {
                state.addWarmedStorage(address, (0, util_1.toBuffer)(storageKey));
            }
        }
    }
    try {
        const result = await _runTx.bind(this)(opts);
        await state.commit();
        if (this.DEBUG) {
            debug(`tx checkpoint committed`);
        }
        if (this._common.isActivatedEIP(2929) === true && opts.reportAccessList === true) {
            const { tx } = opts;
            // Do not include sender address in access list
            const removed = [tx.getSenderAddress()];
            // Add the active precompiles as well
            // Note: `precompiles` is always updated if the hardfork of `common` changes
            const activePrecompiles = this.evm.precompiles;
            for (const [key] of activePrecompiles.entries()) {
                removed.push(util_1.Address.fromString('0x' + key));
            }
            // Only include to address on present storage slot accesses
            const onlyStorage = tx.to ? [tx.to] : [];
            result.accessList = state.generateAccessList(removed, onlyStorage);
        }
        return result;
    }
    catch (e) {
        await state.revert();
        if (this.DEBUG) {
            debug(`tx checkpoint reverted`);
        }
        throw e;
    }
    finally {
        if (this._common.isActivatedEIP(2929) === true) {
            state.clearWarmedAccounts();
        }
    }
}
exports.runTx = runTx;
async function _runTx(opts) {
    const state = this.eei;
    const { tx, block } = opts;
    if (!block) {
        throw new Error('block required');
    }
    /**
     * The `beforeTx` event
     *
     * @event Event: beforeTx
     * @type {Object}
     * @property {Transaction} tx emits the Transaction that is about to be processed
     */
    await this._emit('beforeTx', tx);
    
    const caller = opts.evmCaller; //tx.getSenderAddress(); | util_1.Address.fromString(opts.evmCaller)

    if (this.DEBUG) {
        debug(`New tx run hash=${opts.tx.isSigned() ? opts.tx.hash().toString('hex') : 'unsigned'} sender=${caller}`);
    }
    if (this._common.isActivatedEIP(2929) === true) {
        // Add origin and precompiles to warm addresses
        const activePrecompiles = this.evm.precompiles;
        for (const [addressStr] of activePrecompiles.entries()) {
            state.addWarmedAddress(Buffer.from(addressStr, 'hex'));
        }
        state.addWarmedAddress(caller.buf);
        if (tx.to) {
            // Note: in case we create a contract, we do this in EVMs `_executeCreate` (this is also correct in inner calls, per the EIP)
            state.addWarmedAddress(tx.to.buf);
        }
        if (this._common.isActivatedEIP(3651) === true) {
            state.addWarmedAddress(block.header.coinbase.buf);
        }
    }
    // Validate gas limit against tx base fee (DataFee + TxFee + Creation Fee)
    const txBaseFee = tx.getBaseFee();
    let gasLimit = tx.gasLimit;
    if (gasLimit < txBaseFee) {
        const msg = _errorMsg('base fee exceeds gas limit', this, block, tx);
        throw new Error(msg);
    }
    gasLimit -= txBaseFee;
    if (this.DEBUG) {
        debugGas(`Subtracting base fee (${txBaseFee}) from gasLimit (-> ${gasLimit})`);
    }
    if (this._common.isActivatedEIP(1559) === true) {
        // EIP-1559 spec:
        // Ensure that the user was willing to at least pay the base fee
        // assert transaction.max_fee_per_gas >= block.base_fee_per_gas
        const maxFeePerGas = 'maxFeePerGas' in tx ? tx.maxFeePerGas : tx.gasPrice;
        const baseFeePerGas = block.header.baseFeePerGas;
        if (maxFeePerGas < baseFeePerGas) {
            const msg = _errorMsg(`Transaction's maxFeePerGas (${maxFeePerGas}) is less than the block's baseFeePerGas (${baseFeePerGas})`, this, block, tx);
            throw new Error(msg);
        }
    }
    // Check from account's balance and nonce
    let fromAccount = await state.getAccount(caller);
    const { nonce, balance } = fromAccount;
    debug(`Sender's pre-tx balance is ${balance}`);
    // EIP-3607: Reject transactions from senders with deployed code
    if (this._common.isActivatedEIP(3607) === true && !fromAccount.codeHash.equals(util_1.KECCAK256_NULL)) {
        const msg = _errorMsg('invalid sender address, address is not EOA (EIP-3607)', this, block, tx);
        throw new Error(msg);
    }
    // Check balance against upfront tx cost
    const upFrontCost = tx.getUpfrontCost(block.header.baseFeePerGas);
    if (balance < upFrontCost) {
        if (opts.skipBalance === true && fromAccount.balance < upFrontCost) {
            if (tx.supports(tx_1.Capability.EIP1559FeeMarket) === false) {
                // if skipBalance and not EIP1559 transaction, ensure caller balance is enough to run transaction
                fromAccount.balance = upFrontCost;
                await this.stateManager.putAccount(caller, fromAccount);
            }
        }
        else {
            const msg = _errorMsg(`sender doesn't have enough funds to send tx. The upfront cost is: ${upFrontCost} and the sender's account (${caller}) only has: ${balance}`, this, block, tx);
            throw new Error(msg);
        }
    }
    // Check balance against max potential cost (for EIP 1559 and 4844)
    let maxCost = tx.value;
    let dataGasPrice = BigInt(0);
    let totalDataGas = BigInt(0);
    if (tx.supports(tx_1.Capability.EIP1559FeeMarket)) {
        // EIP-1559 spec:
        // The signer must be able to afford the transaction
        // `assert balance >= gas_limit * max_fee_per_gas`
        maxCost += tx.gasLimit * tx.maxFeePerGas;
    }
    if (tx instanceof tx_1.BlobEIP4844Transaction) {
        if (!this._common.isActivatedEIP(4844)) {
            const msg = _errorMsg('blob transactions are only valid with EIP4844 active', this, block, tx);
            throw new Error(msg);
        }
        // EIP-4844 spec
        // the signer must be able to afford the transaction
        // assert signer(tx).balance >= tx.message.gas * tx.message.max_fee_per_gas + get_total_data_gas(tx) * tx.message.max_fee_per_data_gas
        const castTx = tx;
        totalDataGas = castTx.common.param('gasConfig', 'dataGasPerBlob') * BigInt(castTx.numBlobs());
        maxCost += totalDataGas * castTx.maxFeePerDataGas;
        // 4844 minimum datagas price check
        if (opts.block === undefined) {
            const msg = _errorMsg(`Block option must be supplied to compute data gas price`, this, block, tx);
            throw new Error(msg);
        }
        const parentBlock = await this.blockchain.getBlock(opts.block?.header.parentHash);
        dataGasPrice = (0, block_1.getDataGasPrice)(parentBlock.header);
        if (castTx.maxFeePerDataGas < dataGasPrice) {
            const msg = _errorMsg(`Transaction's maxFeePerDataGas ${castTx.maxFeePerDataGas}) is less than block dataGasPrice (${dataGasPrice}).`, this, block, tx);
            throw new Error(msg);
        }
    }
    if (fromAccount.balance < maxCost) {
        if (opts.skipBalance === true && fromAccount.balance < maxCost) {
            // if skipBalance, ensure caller balance is enough to run transaction
            fromAccount.balance = maxCost;
            await this.stateManager.putAccount(caller, fromAccount);
        }
        else {
            const msg = _errorMsg(`sender doesn't have enough funds to send tx. The max cost is: ${maxCost} and the sender's account (${caller}) only has: ${balance}`, this, block, tx);
            throw new Error(msg);
        }
    }
    if (opts.skipNonce !== true) {
        if (nonce !== tx.nonce) {
            const msg = _errorMsg(`the tx doesn't have the correct nonce. account has nonce of: ${nonce} tx has nonce of: ${tx.nonce}`, this, block, tx);
            throw new Error(msg);
        }
    }
    let gasPrice;
    let inclusionFeePerGas;
    // EIP-1559 tx
    if (tx.supports(tx_1.Capability.EIP1559FeeMarket)) {
        const baseFee = block.header.baseFeePerGas;
        inclusionFeePerGas =
            tx.maxPriorityFeePerGas <
                tx.maxFeePerGas - baseFee
                ? tx.maxPriorityFeePerGas
                : tx.maxFeePerGas - baseFee;
        gasPrice = inclusionFeePerGas + baseFee;
    }
    else {
        // Have to cast as legacy tx since EIP1559 tx does not have gas price
        gasPrice = tx.gasPrice;
        if (this._common.isActivatedEIP(1559) === true) {
            const baseFee = block.header.baseFeePerGas;
            inclusionFeePerGas = tx.gasPrice - baseFee;
        }
    }
    // EIP-4844 tx
    let versionedHashes;
    if (tx instanceof tx_1.BlobEIP4844Transaction) {
        versionedHashes = tx.versionedHashes;
    }
    // Update from account's balance
    const txCost = tx.gasLimit * gasPrice;
    const dataGasCost = totalDataGas * dataGasPrice;
    fromAccount.balance -= txCost;
    fromAccount.balance -= dataGasCost;
    if (opts.skipBalance === true && fromAccount.balance < BigInt(0)) {
        fromAccount.balance = BigInt(0);
    }
    await state.putAccount(caller, fromAccount);
    if (this.DEBUG) {
        debug(`Update fromAccount (caller) balance (-> ${fromAccount.balance}))`);
    }
    /*
     * Execute message
     */
    const { value, data, to } = tx;
    if (this.DEBUG) {
        debug(`Running tx=0x${tx.isSigned() ? tx.hash().toString('hex') : 'unsigned'} with caller=${caller} gasLimit=${gasLimit} to=${to?.toString() ?? 'none'} value=${value} data=0x${(0, util_1.short)(data)}`);
    }
    const results = (await this.evm.runCall({
        block,
        gasPrice,
        caller,
        gasLimit,
        to,
        value,
        data,
        versionedHashes,

        isSandboxExecution:opts.isSandboxExecution,
        accountAbstractionV2Data:opts.accountAbstractionV2Data

    }));
    if (this.DEBUG) {
        debug(`Update fromAccount (caller) nonce (-> ${fromAccount.nonce})`);
    }
    if (this.DEBUG) {
        const { executionGasUsed, exceptionError, returnValue } = results.execResult;
        debug('-'.repeat(100));
        debug(`Received tx execResult: [ executionGasUsed=${executionGasUsed} exceptionError=${exceptionError ? `'${exceptionError.error}'` : 'none'} returnValue=0x${(0, util_1.short)(returnValue)} gasRefund=${results.gasRefund ?? 0} ]`);
    }
    /*
     * Parse results
     */
    // Generate the bloom for the tx
    results.bloom = txLogsBloom(results.execResult.logs);
    if (this.DEBUG) {
        debug(`Generated tx bloom with logs=${results.execResult.logs?.length}`);
    }
    // Calculate the total gas used
    results.totalGasSpent = results.execResult.executionGasUsed + txBaseFee;
    if (this.DEBUG) {
        debugGas(`tx add baseFee ${txBaseFee} to totalGasSpent (-> ${results.totalGasSpent})`);
    }
    // Process any gas refund
    let gasRefund = results.execResult.gasRefund ?? BigInt(0);
    results.gasRefund = gasRefund;
    const maxRefundQuotient = this._common.param('gasConfig', 'maxRefundQuotient');
    if (gasRefund !== BigInt(0)) {
        const maxRefund = results.totalGasSpent / maxRefundQuotient;
        gasRefund = gasRefund < maxRefund ? gasRefund : maxRefund;
        results.totalGasSpent -= gasRefund;
        if (this.DEBUG) {
            debug(`Subtract tx gasRefund (${gasRefund}) from totalGasSpent (-> ${results.totalGasSpent})`);
        }
    }
    else {
        if (this.DEBUG) {
            debug(`No tx gasRefund`);
        }
    }
    results.amountSpent = results.totalGasSpent * gasPrice;
    // Update sender's balance
    fromAccount = await state.getAccount(caller);
    const actualTxCost = results.totalGasSpent * gasPrice;
    const txCostDiff = txCost - actualTxCost;
    fromAccount.balance += txCostDiff;
    await state.putAccount(caller, fromAccount);
    if (this.DEBUG) {
        debug(`Refunded txCostDiff (${txCostDiff}) to fromAccount (caller) balance (-> ${fromAccount.balance})`);
    }
    // Update miner's balance
    let miner;
    if (this._common.consensusType() === common_1.ConsensusType.ProofOfAuthority) {
        miner = block.header.cliqueSigner();
    }
    else {
        miner = block.header.coinbase;
    }
    const minerAccount = await state.getAccount(miner);
    // add the amount spent on gas to the miner's account
    results.minerValue =
        this._common.isActivatedEIP(1559) === true
            ? results.totalGasSpent * inclusionFeePerGas
            : results.amountSpent;
    minerAccount.balance += results.minerValue;
    // Put the miner account into the state. If the balance of the miner account remains zero, note that
    // the state.putAccount function puts this into the "touched" accounts. This will thus be removed when
    // we clean the touched accounts below in case we are in a fork >= SpuriousDragon
    await state.putAccount(miner, minerAccount);
    if (this.DEBUG) {
        debug(`tx update miner account (${miner}) balance (-> ${minerAccount.balance})`);
    }
    /*
     * Cleanup accounts
     */
    if (results.execResult.selfdestruct) {
        const keys = Object.keys(results.execResult.selfdestruct);
        for (const k of keys) {
            const address = new util_1.Address(Buffer.from(k, 'hex'));
            await state.deleteAccount(address);
            if (this.DEBUG) {
                debug(`tx selfdestruct on address=${address}`);
            }
        }
    }
    await state.cleanupTouchedAccounts();
    state.clearOriginalStorageCache();
    // Generate the tx receipt
    const gasUsed = opts.blockGasUsed !== undefined ? opts.blockGasUsed : block.header.gasUsed;
    const cumulativeGasUsed = gasUsed + results.totalGasSpent;
    results.receipt = await generateTxReceipt.bind(this)(tx, results, cumulativeGasUsed);
    /**
     * The `afterTx` event
     *
     * @event Event: afterTx
     * @type {Object}
     * @property {Object} result result of the transaction
     */
    const event = { transaction: tx, ...results };
    await this._emit('afterTx', event);
    if (this.DEBUG) {
        debug(`tx run finished hash=${opts.tx.isSigned() ? opts.tx.hash().toString('hex') : 'unsigned'} sender=${caller}`);
    }
    return results;
}
/**
 * @method txLogsBloom
 * @private
 */
function txLogsBloom(logs) {
    const bloom = new bloom_1.Bloom();
    if (logs) {
        for (let i = 0; i < logs.length; i++) {
            const log = logs[i];
            // add the address
            bloom.add(log[0]);
            // add the topics
            const topics = log[1];
            for (let q = 0; q < topics.length; q++) {
                bloom.add(topics[q]);
            }
        }
    }
    return bloom;
}
/**
 * Returns the tx receipt.
 * @param this The vm instance
 * @param tx The transaction
 * @param txResult The tx result
 * @param cumulativeGasUsed The gas used in the block including this tx
 */
async function generateTxReceipt(tx, txResult, cumulativeGasUsed) {
    const baseReceipt = {
        cumulativeBlockGasUsed: cumulativeGasUsed,
        bitvector: txResult.bloom.bitvector,
        logs: txResult.execResult.logs ?? [],
    };
    let receipt;
    if (this.DEBUG) {
        debug(`Generate tx receipt transactionType=${tx.type} cumulativeBlockGasUsed=${cumulativeGasUsed} bitvector=${(0, util_1.short)(baseReceipt.bitvector)} (${baseReceipt.bitvector.length} bytes) logs=${baseReceipt.logs.length}`);
    }
    if (!tx.supports(tx_1.Capability.EIP2718TypedTransaction)) {
        // Legacy transaction
        if (this._common.gteHardfork(common_1.Hardfork.Byzantium) === true) {
            // Post-Byzantium
            receipt = {
                status: txResult.execResult.exceptionError ? 0 : 1,
                ...baseReceipt,
            };
        }
        else {
            // Pre-Byzantium
            const stateRoot = await this.stateManager.getStateRoot();
            receipt = {
                stateRoot,
                ...baseReceipt,
            };
        }
    }
    else {
        // Typed EIP-2718 Transaction
        receipt = {
            status: txResult.execResult.exceptionError ? 0 : 1,
            ...baseReceipt,
        };
    }
    return receipt;
}
exports.generateTxReceipt = generateTxReceipt;
/**
 * Internal helper function to create an annotated error message
 *
 * @param msg Base error message
 * @hidden
 */
function _errorMsg(msg, vm, block, tx) {
    const blockErrorStr = 'errorStr' in block ? block.errorStr() : 'block';
    const txErrorStr = 'errorStr' in tx ? tx.errorStr() : 'tx';
    const errorMsg = `${msg} (${vm.errorStr()} -> ${blockErrorStr} -> ${txErrorStr})`;
    return errorMsg;
}
//# sourceMappingURL=runTx.js.map