# @ohmpathorn/block-node-client

JavaScript/TypeScript SDK for the [Hedera Block Node](https://github.com/hiero-ledger/hiero-block-node) gRPC API.

Wraps all four Block Node RPCs with a clean async/callback interface, full TypeScript types, and built-in protobuf decoding so you never have to touch raw bytes.

## Install

```bash
npm install @ohmpathorn/block-node-client
```

## Quick start

```ts
import { BlockNodeClient } from "@ohmpathorn/block-node-client";

const client = new BlockNodeClient({
  endpoint: "s01.test.blk.ams.lat.ope.eng.hashgraph.io:40840",
});

// 1. Check node health
const status = await client.serverStatus();
console.log("Latest block:", status.lastAvailableBlock);

// 2. Subscribe to live blocks
const handle = client.subscribeBlockStream(
  { startBlockNumber: status.lastAvailableBlock - 10n },
  {
    onStatus: (code, name) => console.log("Stream:", name),
    onBlock:  (num, items) => console.log(`Block ${num} — ${items.length} items`),
    onError:  (err)        => console.error(err.message),
    onEnd:    ()           => client.close(),
  },
);

// Cancel after 60 seconds
setTimeout(() => handle.cancel(), 60_000);
```

## Testnet endpoints

All endpoints use port **40840** (TLS or plaintext).

| Region | Endpoint |
|--------|----------|
| Amsterdam | `s01.test.blk.ams.lat.ope.eng.hashgraph.io:40840` |
| Singapore | `s01.test.blk.sgp.lat.ope.eng.hashgraph.io:40840` |
| Chicago | `s01.test.blk.chi.lat.ope.eng.hashgraph.io:40840` |
| Tier 2 | `lfh01.testnet.blocknode.hashgraph-devops.com:40840` |

## API reference

### `new BlockNodeClient(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | required | `host:port` |
| `tls` | `"tls" \| "insecure"` | `"tls"` | TLS mode |
| `timeout` | `number` | `10000` | Unary call timeout (ms) |

---

### `client.serverStatus()` → `Promise<ServerStatusResponse>`

Lightweight health check. **Always call this first** to validate the available block range before subscribing.

```ts
const status = await client.serverStatus();
// { firstAvailableBlock, lastAvailableBlock, nextExpectedBlock, onlyLatestState }
```

---

### `client.serverStatusDetail()` → `Promise<ServerStatusDetailResponse>`

Full capability report: software versions, all available block ranges, and the current network address book.

```ts
const detail = await client.serverStatusDetail();
detail.availableRanges.forEach(r =>
  console.log(`${r.rangeStart} → ${r.rangeEnd}`)
);
```

---

### `client.getBlock(request)` → `Promise<GetBlockResponse>`

Fetch a single block by number or retrieve the latest block.

```ts
// By number
const result = await client.getBlock({ blockNumber: 38764703n });

// Latest
const latest = await client.getBlock({ retrieveLatest: true });

console.log(result.statusName);   // "SUCCESS"
console.log(result.block?.length); // number of BlockItems
```

**BlockItem kinds:** `block_header`, `event_header`, `round_header`, `event_transaction`, `transaction_result`, `state_changes`, `filtered_item_hash`, `block_proof`, `record_file`

---

### `client.subscribeBlockStream(options, callbacks)` → `StreamHandle`

Server-streaming RPC. Accumulates `BlockItemSet` batches until `end_of_block` fires, then calls `onBlock` with the complete decoded block.

```ts
const handle = client.subscribeBlockStream(
  {
    startBlockNumber: 38764000n,
    endBlockNumber: 0,            // 0 = live open-ended stream (default)
  },
  {
    onStatus: (code, name) => { /* 1 = SUCCESS */ },
    onBlock:  (blockNumber, items) => {
      const txs = items.filter(i => i.kind === "event_transaction");
      txs.forEach(tx => {
        console.log(tx.payload.type);                    // "CRYPTO_TRANSFER"
        console.log(tx.payload.transactionId?.toString()); // "0.0.3569@1753912345.123456789"
      });
    },
    onError: (err) => console.error(err.message),
    onEnd:   ()    => console.log("done"),
  },
);

handle.cancel(); // stop the stream at any time
```

**⚠ Important:** Do not pass `endBlockNumber: 0` meaning "end now" — `0` is automatically converted to `uint64_max` for live streaming. Pass an explicit block number to get a bounded historical range.

---

### `client.close()`

Releases gRPC connections and cleans up temp files. Always call when done.

---

## Working with decoded blocks

Every `BlockItem` has:
- `item.kind` — which oneof field was set (`"block_header"`, `"event_transaction"`, etc.)
- `item.payload` — the decoded message (typed per kind)
- `item.raw` — the original bytes

```ts
items.forEach(item => {
  switch (item.kind) {
    case "block_header":
      console.log("Block number:", item.payload.number);
      break;
    case "event_transaction":
      console.log("Tx type:", item.payload.type);
      console.log("Tx ID:  ", item.payload.transactionId?.toString());
      break;
    case "transaction_result":
      console.log("Status:", item.payload.statusName);
      console.log("Fee:   ", item.payload.transactionFee, "tinybars");
      item.payload.transfers.forEach(t =>
        console.log(`  ${t.accountId?.accountNum} → ${t.amount}`));
      break;
    case "record_file":
      // Historical block (pre-HIP-1056) — transactions nested inside
      item.payload.transactions.forEach(tx =>
        console.log(tx.type, tx.transactionId?.toString()));
      break;
  }
});
```

## TransactionID format

Hedera transaction IDs are formatted as `shard.realm.account@seconds.nanos`:

```ts
const txId = item.payload.transactionId;
console.log(txId.toString()); // "0.0.3569@1753912345.123456789"
console.log(txId.accountId);  // { shardNum: 0n, realmNum: 0n, accountNum: 3569n }
console.log(txId.transactionValidStart.toDate()); // JavaScript Date
```

## Transaction types

All 55 Hedera transaction types are decoded:

```ts
import { TX_TYPES } from "@ohmpathorn/block-node-client";
// { 7: "CONTRACT_CALL", 14: "CRYPTO_TRANSFER", 27: "CONSENSUS_SUBMIT_MESSAGE", ... }
```

## Status codes

```ts
import { SubscribeStreamCode, BlockResponseCode } from "@ohmpathorn/block-node-client";

SubscribeStreamCode.SUCCESS                    // 1
SubscribeStreamCode.INVALID_END_BLOCK_NUMBER   // 5 — caused by sending end_block = 0
SubscribeStreamCode.NOT_AVAILABLE              // 6 — block not on this node

BlockResponseCode.NOT_FOUND                    // 4
BlockResponseCode.NOT_AVAILABLE                // 5
```

## TypeScript

Full types are included. Import them directly:

```ts
import {
  BlockNodeClient,
  BlockNodeClientOptions,
  ServerStatusResponse,
  BlockItem,
  EventTransaction,
  TransactionResult,
  RecordFile,
  StreamHandle,
} from "@ohmpathorn/block-node-client";
```

## Examples

```bash
# Basic usage — all four APIs
node examples/basic.js

# Live transaction monitor
node examples/transaction-monitor.js

# Multi-endpoint failover
node examples/multi-endpoint.js

# Use plaintext instead of TLS
USE_INSECURE=1 node examples/basic.js

# Use a different endpoint
ENDPOINT=s01.test.blk.sgp.lat.ope.eng.hashgraph.io:40840 node examples/basic.js
```

## License

Apache 2.0
# hedera-block-node-sdk
