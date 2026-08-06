# @ohmpathorn/block-node-client

[![npm version](https://img.shields.io/npm/v/@ohmpathorn/block-node-client)](https://www.npmjs.com/package/@ohmpathorn/block-node-client)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen)](https://nodejs.org)

JavaScript/TypeScript SDK for the [Hedera Block Node](https://github.com/hiero-ledger/hiero-block-node) gRPC API.

Wraps all four Block Node RPCs with a clean async/callback interface, full TypeScript types, and built-in protobuf decoding — so you never have to touch raw bytes.

---

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

// Check node health
const status = await client.serverStatus();
console.log("Latest block:", status.lastAvailableBlock);

// Subscribe to live blocks
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

---

## Testnet endpoints

All endpoints use port **40840**.

| Region | Endpoint |
|--------|----------|
| Amsterdam | `s01.test.blk.ams.lat.ope.eng.hashgraph.io:40840` |
| Singapore | `s01.test.blk.sgp.lat.ope.eng.hashgraph.io:40840` |
| Chicago | `s01.test.blk.chi.lat.ope.eng.hashgraph.io:40840` |
| Tier 2 | `lfh01.testnet.blocknode.hashgraph-devops.com:40840` |

---

## API reference

### `new BlockNodeClient(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | required | `host:port` of the block node |
| `tls` | `"tls" \| "insecure"` | `"tls"` | TLS or plaintext |
| `timeout` | `number` | `10000` | Unary call timeout in ms |

---

### `client.serverStatus()` → `Promise<ServerStatusResponse>`

Lightweight health check. Returns the available block range and node state. Always call this first to validate the range before subscribing.

```ts
const status = await client.serverStatus();
console.log(status.firstAvailableBlock); // bigint
console.log(status.lastAvailableBlock);  // bigint
console.log(status.onlyLatestState);     // boolean
```

---

### `client.serverStatusDetail()` → `Promise<ServerStatusDetailResponse>`

Full capability report: software versions, all available block ranges, and the network address book.

```ts
const detail = await client.serverStatusDetail();

const v = detail.versionInformation?.blockNodeVersion;
console.log(`Block node: ${v?.major}.${v?.minor}.${v?.patch}`);

detail.availableRanges.forEach(r =>
  console.log(`${r.rangeStart} → ${r.rangeEnd}`)
);
```

---

### `client.getBlock(request)` → `Promise<GetBlockResponse>`

Fetch a single block by number or the latest block.

```ts
// By number
const result = await client.getBlock({ blockNumber: 38764703n });

// Latest
const latest = await client.getBlock({ retrieveLatest: true });

console.log(result.statusName);    // "SUCCESS"
console.log(result.block?.length); // number of BlockItems
```

---

### `client.subscribeBlockStream(options, callbacks)` → `StreamHandle`

Server-streaming RPC. Buffers `BlockItemSet` messages and fires `onBlock` once per complete block (after `end_of_block` is received).

```ts
const handle = client.subscribeBlockStream(
  {
    startBlockNumber: 38764000n,
    endBlockNumber: 0n,   // 0 = live open-ended stream
  },
  {
    onStatus: (code, name) => console.log("Stream status:", name),
    onBlock:  (blockNumber, items) => {
      items.filter(i => i.kind === "event_transaction").forEach(item => {
        console.log(item.payload.type);                     // "CRYPTO_TRANSFER"
        console.log(item.payload.transactionId?.toString()); // "0.0.3569@..."
      });
    },
    onError: (err) => console.error(err.message),
    onEnd:   ()    => console.log("Stream ended"),
  },
);

handle.cancel(); // stop at any time
```

> **Note:** `endBlockNumber: 0` is automatically converted to `uint64_max` for a live stream. Pass an explicit number for a bounded historical range.

---

### `client.getBlockTransactions(request)` → `Promise<FullTransaction[]>`

Fetch all transactions in a block, fully decoded — body fields, all signatures, receipt, HBAR/token/NFT transfers, and assessed custom fees.

```ts
const txs = await client.getBlockTransactions({ blockNumber: 38764703n });
// or: await client.getBlockTransactions({ retrieveLatest: true });

txs.forEach(tx => {
  console.log(tx.type, tx.transactionId?.toString());

  // Signatures (all keys that signed)
  tx.signatures.forEach(s => {
    console.log(s.type);        // "ed25519" | "ecdsa_secp256k1" | "rsa_3072"
    console.log(s.pubKeyPrefix); // hex string
    console.log(s.signature);    // hex string
  });

  // Receipt
  console.log(tx.receipt?.statusName);       // "SUCCESS"
  console.log(tx.receipt?.accountId);        // created account (CryptoCreate)
  console.log(tx.receipt?.exchangeRate?.currentRate);

  // Record
  console.log(tx.consensusTimestamp?.toDate());
  console.log(tx.transactionFee);            // bigint tinybars

  // HBAR transfers
  tx.transfers.forEach(t =>
    console.log(`${t.accountId?.accountNum}: ${t.amount}`)
  );

  // Token transfers
  tx.tokenTransfers.forEach(ttl => {
    console.log("token:", ttl.tokenId);
    ttl.transfers.forEach(t => console.log(t.accountId?.accountNum, t.amount));
    ttl.nftTransfers.forEach(n => console.log(`NFT #${n.serialNumber}`));
  });

  // Raw bytes
  console.log(tx.rawTransaction.length, "bytes");
  console.log(tx.rawRecord?.length, "bytes"); // record_file blocks only
});
```

> **Note:** For **historical blocks** (`record_file` format, blocks before HIP-1056) all fields are populated from the embedded `RecordStreamFile`. For **native stream blocks** (newer), the receipt, token transfers, and assessed custom fees are not available — only body and signature fields.

---

### `client.close()`

Releases gRPC connections and cleans up temp files. Always call when done.

---

## Block items

Each block is an ordered list of `BlockItem` objects. Every item has:

| Property | Type | Description |
|----------|------|-------------|
| `kind` | `BlockItemKind` | Which oneof field is set |
| `payload` | typed per `kind` | Decoded message |
| `raw` | `Buffer` | Original bytes |

### Item kinds

| Kind | Description | Payload type |
|------|-------------|--------------|
| `block_header` | Block number, hash algorithm, SW versions | `BlockHeader` |
| `event_header` | Gossip event metadata | `EventHeader` |
| `round_header` | Consensus round number | `RoundHeader` |
| `event_transaction` | Transaction type, ID, memo, raw bytes | `EventTransaction` |
| `transaction_result` | Status, fee, payer, transfers, tx hash | `TransactionResult` |
| `state_changes` | Which state tables changed | `StateChanges` |
| `filtered_item_hash` | Hash placeholder for filtered items | `FilteredItemHash` |
| `block_proof` | TSS block signature + Merkle proof | `BlockProof` |
| `record_file` | Historical block (pre-HIP-1056) with embedded transactions | `RecordFile` |
| `address_book_proof` | Network address book hashes for record-file blocks | `AddressBookProof` |

### Example: switch on kind

```ts
items.forEach(item => {
  switch (item.kind) {
    case "block_header":
      console.log("Block #", item.payload.number);
      break;

    case "event_transaction":
      console.log(item.payload.type);                      // "CRYPTO_TRANSFER"
      console.log(item.payload.transactionId?.toString()); // "0.0.3@1753912345.000000001"
      console.log(item.payload.memo);
      break;

    case "transaction_result":
      console.log(item.payload.statusName);      // "SUCCESS"
      console.log(item.payload.transactionFee);  // bigint tinybars
      item.payload.transfers.forEach(t =>
        console.log(`  ${t.accountId?.accountNum}: ${t.amount}`)
      );
      break;

    case "record_file":
      // Historical block format — transactions are nested inside
      item.payload.transactions.forEach(tx =>
        console.log(tx.type, tx.transactionId?.toString())
      );
      break;
  }
});
```

---

## Transaction IDs

Hedera transaction IDs follow the format `shard.realm.account@seconds.nanos`:

```ts
const txId = item.payload.transactionId;
console.log(txId.toString());
// "0.0.3569@1753912345.123456789"

console.log(txId.accountId);
// { shardNum: 0n, realmNum: 0n, accountNum: 3569n }

console.log(txId.transactionValidStart.toDate());
// JavaScript Date
```

---

## Transaction types

All 55 Hedera transaction types are decoded automatically. You can also import the lookup table directly:

```ts
import { TX_TYPES } from "@ohmpathorn/block-node-client";

TX_TYPES[14]  // "CRYPTO_TRANSFER"
TX_TYPES[27]  // "CONSENSUS_SUBMIT_MESSAGE"
TX_TYPES[50]  // "ETHEREUM_TRANSACTION"
```

---

## Status codes

```ts
import { SubscribeStreamCode, BlockResponseCode } from "@ohmpathorn/block-node-client";

// Stream subscription status (first message)
SubscribeStreamCode.SUCCESS                   // 1
SubscribeStreamCode.INVALID_START_BLOCK_NUMBER // 4
SubscribeStreamCode.INVALID_END_BLOCK_NUMBER  // 5 — caused by sending end_block = 0
SubscribeStreamCode.NOT_AVAILABLE             // 6 — block not on this node

// getBlock response status
BlockResponseCode.SUCCESS       // 1
BlockResponseCode.NOT_FOUND     // 4
BlockResponseCode.NOT_AVAILABLE // 5
```

---

## TypeScript

Full types ship with the package. Import what you need:

```ts
import {
  BlockNodeClient,
  BlockNodeClientOptions,
  ServerStatusResponse,
  ServerStatusDetailResponse,
  BlockItem,
  BlockItemKind,
  BlockHeader,
  EventTransaction,
  TransactionResult,
  RecordFile,
  AddressBookProof,
  StreamHandle,
  SubscribeStreamCode,
  BlockResponseCode,
  // getBlockTransactions types
  FullTransaction,
  Signature,
  TransactionReceipt,
  TokenTransferList,
  NftTransfer,
  AssessedCustomFee,
  EntityId,
  TokenId,
} from "@ohmpathorn/block-node-client";
```

---

## Examples

```bash
# Basic usage — all four APIs
node examples/basic.js

# Fully decoded transactions with signatures, receipt, and transfers
node examples/get-block-transactions.js

# Fetch a specific block
BLOCK=38764703 node examples/get-block-transactions.js

# Live transaction monitor
node examples/transaction-monitor.js

# Multi-endpoint failover
node examples/multi-endpoint.js

# Plaintext instead of TLS
USE_INSECURE=1 node examples/basic.js

# Different endpoint
ENDPOINT=s01.test.blk.sgp.lat.ope.eng.hashgraph.io:40840 node examples/basic.js
```

---

## How it works

The SDK writes the necessary protobuf definitions to a temp directory at startup and loads them via `@grpc/proto-loader`. Inner `BlockItem` payloads are decoded manually using a hand-rolled `ProtoReader` rather than generated stubs — this makes the SDK resilient to schema evolution and unknown fields.

---

## License

[Apache 2.0](LICENSE)
