/**
 * Manual protobuf decoder.
 *
 * Because the Block Node's inner message schemas have evolved and may differ
 * slightly from the compiled stubs, we decode BlockItem payloads by hand using
 * the low-level ProtoReader rather than relying on proto-loader's type mapping.
 * This makes the SDK resilient to unknown fields and minor schema differences.
 */

import {
  BlockItem, BlockItemKind, BlockHeader, EventHeader, RoundHeader,
  EventTransaction, TransactionResult, StateChanges, FilteredItemHash,
  BlockProof, RecordFile, AddressBookProof, SemanticVersion, Timestamp,
  AccountId, TransactionId, Transfer, StateChange, DecodedTransaction,
  Signature, EntityId, TokenId, ExchangeRate, ExchangeRateSet,
  TransactionReceipt, TokenTransfer, NftTransfer, TokenTransferList,
  AssessedCustomFee, FullTransaction,
} from "./types";

// ─── ProtoReader ──────────────────────────────────────────────────────────────

export class ProtoReader {
  private b: Buffer;
  pos: number = 0;

  constructor(input: Buffer | Uint8Array) {
    this.b = Buffer.from(input);
  }

  more(): boolean { return this.pos < this.b.length; }

  varint(): bigint {
    let r = 0n, s = 0n;
    while (true) {
      const byte = this.b[this.pos++];
      r |= BigInt(byte & 0x7f) << s;
      if (!(byte & 0x80)) break;
      s += 7n;
    }
    return r;
  }

  tag(): { fieldNum: number; wireType: number } {
    const v = this.varint();
    return { fieldNum: Number(v >> 3n), wireType: Number(v & 7n) };
  }

  bytes(): Buffer {
    const n = Number(this.varint());
    const slice = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  skip(wireType: number): void {
    if (wireType === 0) this.varint();
    else if (wireType === 2) { const n = Number(this.varint()); this.pos += n; }
    else if (wireType === 5) this.pos += 4;
    else if (wireType === 1) this.pos += 8;
    else throw new Error(`unknown wire type ${wireType}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSigned64(v: bigint): bigint {
  const MAX = 9223372036854775808n;
  return v >= MAX ? v - 18446744073709551616n : v;
}

// AccountAmount.amount is declared `sint64` in the HAPI protos, which uses
// ZigZag varint encoding (unlike the plain two's-complement `int64` used for
// fields like serial numbers or assessed fee amounts) — decoding it with
// toSigned64 silently produced wrong, always-positive amounts.
function zigzagDecode64(v: bigint): bigint {
  return (v >> 1n) ^ -(v & 1n);
}

function decodeTimestamp(buf: Buffer): Timestamp {
  const out = { seconds: 0n, nanos: 0 };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.seconds = r.varint();
    else if (fieldNum === 2 && wireType === 0) out.nanos = Number(r.varint());
    else r.skip(wireType);
  }
  return {
    seconds: out.seconds,
    nanos: out.nanos,
    toDate: () => new Date(Number(out.seconds) * 1000 + Math.floor(out.nanos / 1e6)),
  };
}

function decodeAccountId(buf: Buffer): AccountId {
  const out: AccountId = { shardNum: 0n, realmNum: 0n, accountNum: 0n };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.shardNum  = r.varint();
    else if (fieldNum === 2 && wireType === 0) out.realmNum  = r.varint();
    else if (fieldNum === 3 && wireType === 0) out.accountNum = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeSemanticVersion(buf: Buffer): SemanticVersion {
  const out: SemanticVersion = { major: 0, minor: 0, patch: 0 };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.major = Number(r.varint());
    else if (fieldNum === 2 && wireType === 0) out.minor = Number(r.varint());
    else if (fieldNum === 3 && wireType === 0) out.patch = Number(r.varint());
    else r.skip(wireType);
  }
  return out;
}

function decodeTransactionId(buf: Buffer): TransactionId {
  const out: any = { scheduled: false, nonce: 0 };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.transactionValidStart = decodeTimestamp(r.bytes());
    else if (fieldNum === 2 && wireType === 2) out.accountId = decodeAccountId(r.bytes());
    else if (fieldNum === 3 && wireType === 0) out.scheduled = Boolean(r.varint());
    else if (fieldNum === 4 && wireType === 0) out.nonce = Number(r.varint());
    else r.skip(wireType);
  }
  out.toString = () => {
    const a = out.accountId;
    const t = out.transactionValidStart;
    if (!a || !t) return "unknown";
    const nanos = String(t.nanos).padStart(9, "0");
    const sched = out.scheduled ? "[scheduled]" : "";
    const nonce = out.nonce ? `/${out.nonce}` : "";
    return `${a.shardNum}.${a.realmNum}.${a.accountNum}@${t.seconds}.${nanos}${nonce}${sched}`.trim();
  };
  return out as TransactionId;
}

// ─── Transaction type map (TransactionBody data oneof field numbers) ──────────

export const TX_TYPES: Record<number, string> = {
  7:  "CONTRACT_CALL",
  8:  "CONTRACT_CREATE",
  9:  "CONTRACT_UPDATE",
  10: "CONTRACT_DELETE",
  11: "CRYPTO_ADD_LIVE_HASH",
  12: "CRYPTO_CREATE",
  13: "CRYPTO_DELETE",
  14: "CRYPTO_TRANSFER",
  15: "CRYPTO_UPDATE",
  16: "FILE_APPEND",
  17: "FILE_CREATE",
  18: "FILE_DELETE",
  19: "FILE_UPDATE",
  20: "SYSTEM_DELETE",
  21: "SYSTEM_UNDELETE",
  23: "FREEZE",
  24: "CONSENSUS_CREATE_TOPIC",
  25: "CONSENSUS_UPDATE_TOPIC",
  26: "CONSENSUS_DELETE_TOPIC",
  27: "CONSENSUS_SUBMIT_MESSAGE",
  28: "UNCHECKED_SUBMIT",
  29: "TOKEN_CREATE",
  31: "TOKEN_FREEZE",
  32: "TOKEN_UNFREEZE",
  33: "TOKEN_GRANT_KYC",
  34: "TOKEN_REVOKE_KYC",
  35: "TOKEN_DELETE",
  36: "TOKEN_UPDATE",
  37: "TOKEN_MINT",
  38: "TOKEN_BURN",
  39: "TOKEN_WIPE",
  40: "TOKEN_ASSOCIATE",
  41: "TOKEN_DISSOCIATE",
  42: "SCHEDULE_CREATE",
  43: "SCHEDULE_DELETE",
  44: "SCHEDULE_SIGN",
  45: "TOKEN_FEE_SCHEDULE_UPDATE",
  46: "TOKEN_PAUSE",
  47: "TOKEN_UNPAUSE",
  48: "CRYPTO_APPROVE_ALLOWANCE",
  49: "CRYPTO_DELETE_ALLOWANCE",
  50: "ETHEREUM_TRANSACTION",
  51: "NODE_STAKE_UPDATE",
  52: "UTIL_PRNG",
  53: "TOKEN_UPDATE_NFTS",
  54: "NODE_CREATE",
  55: "NODE_UPDATE",
  56: "NODE_DELETE",
  57: "TOKEN_REJECT",
  58: "TOKEN_AIRDROP",
  59: "TOKEN_CANCEL_AIRDROP",
  60: "TOKEN_CLAIM_AIRDROP",
  61: "BATCH",
};

// Transaction.field5 → SignedTransaction.field1 → TransactionBody
function decodeTransactionProto(buf: Buffer): DecodedTransaction {
  const out: DecodedTransaction = {};
  try {
    // Layer 1: Transaction — find field 5 (signedTransactionBytes)
    let signedTxBytes: Buffer | null = null;
    let legacyBodyBytes: Buffer | null = null;
    const r0 = new ProtoReader(buf);
    while (r0.more()) {
      const { fieldNum, wireType } = r0.tag();
      if (fieldNum === 5 && wireType === 2) signedTxBytes   = r0.bytes();
      else if (fieldNum === 3 && wireType === 2) legacyBodyBytes = r0.bytes();
      else r0.skip(wireType);
    }

    // Layer 2: SignedTransaction — find field 1 (bodyBytes)
    let bodyBytes: Buffer | null = null;
    if (signedTxBytes) {
      const r1 = new ProtoReader(signedTxBytes);
      while (r1.more()) {
        const { fieldNum, wireType } = r1.tag();
        if (fieldNum === 1 && wireType === 2) { bodyBytes = r1.bytes(); break; }
        else r1.skip(wireType);
      }
    } else if (legacyBodyBytes) {
      bodyBytes = legacyBodyBytes;
    }

    if (!bodyBytes) return out;

    // Layer 3: TransactionBody
    const r2 = new ProtoReader(bodyBytes);
    while (r2.more()) {
      const { fieldNum, wireType } = r2.tag();
      if (fieldNum === 1 && wireType === 2) {
        out.transactionId = decodeTransactionId(r2.bytes());
      } else if (fieldNum === 6 && wireType === 2) {
        const m = r2.bytes().toString("utf8").trim();
        if (m) out.memo = m;
      } else if (TX_TYPES[fieldNum]) {
        out.type = TX_TYPES[fieldNum];
        r2.skip(wireType);
      } else {
        r2.skip(wireType);
      }
    }
  } catch (_) {}
  return out;
}

// ─── BlockItem field decoders ─────────────────────────────────────────────────

// Map of field number in BlockItem oneof → kind name
const BLOCK_ITEM_FIELDS: Record<number, BlockItemKind> = {
  1: "block_header", 2: "event_header", 3: "round_header",
  4: "event_transaction", 5: "transaction_result", 6: "transaction_output",
  7: "state_changes", 8: "filtered_item_hash", 9: "block_proof", 10: "record_file",
  // Field 12: empirically observed in record_file blocks; matches the AddressBookProof
  // required by the RecordFileItem spec (3 × 48-byte SHA-384 hash fields).
  12: "address_book_proof",
};

function decodeBlockHeader(buf: Buffer): BlockHeader {
  const out: Partial<BlockHeader> & { previousBlockHash: Buffer } = {
    number: 0n, hashAlgorithm: 0, previousBlockHash: Buffer.alloc(0),
  };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.hapiProtoVersion = decodeSemanticVersion(r.bytes());
    else if (fieldNum === 2 && wireType === 2) out.softwareVersion = decodeSemanticVersion(r.bytes());
    else if (fieldNum === 3 && wireType === 0) out.number = r.varint();
    else if (fieldNum === 4 && wireType === 2) out.previousBlockHash = r.bytes();
    else if (fieldNum === 5 && wireType === 2) out.firstTransactionConsensusTime = decodeTimestamp(r.bytes());
    else if (fieldNum === 6 && wireType === 0) out.hashAlgorithm = Number(r.varint());
    else r.skip(wireType);
  }
  return out as BlockHeader;
}

function decodeEventHeader(buf: Buffer): EventHeader {
  const out: EventHeader = { birthRound: 0n, generation: 0n, creatorNodeId: Buffer.alloc(0) };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) {
      // EventDescriptor
      const ri = new ProtoReader(r.bytes());
      while (ri.more()) {
        const t = ri.tag();
        if (t.fieldNum === 1 && t.wireType === 2) out.creatorNodeId = ri.bytes();
        else if (t.fieldNum === 2 && t.wireType === 0) out.birthRound = ri.varint();
        else if (t.fieldNum === 3 && t.wireType === 0) out.generation = ri.varint();
        else ri.skip(t.wireType);
      }
    } else {
      r.skip(wireType);
    }
  }
  return out;
}

function decodeRoundHeader(buf: Buffer): RoundHeader {
  const out: RoundHeader = { roundNumber: 0n };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.roundNumber = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeEventTransaction(buf: Buffer): EventTransaction {
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) {
      const txBytes = r.bytes();
      const decoded = decodeTransactionProto(txBytes);
      return {
        kind: "application",
        transactionId: decoded.transactionId,
        type: decoded.type,
        memo: decoded.memo,
        raw: txBytes,
      };
    } else if (fieldNum === 2 && wireType === 2) {
      const raw = r.bytes();
      return { kind: "system", raw };
    } else {
      r.skip(wireType);
    }
  }
  return { kind: "application", raw: Buffer.alloc(0) };
}

function decodeTransactionResult(buf: Buffer): TransactionResult {
  const out: TransactionResult = {
    status: 0, statusName: "UNKNOWN", transactionFee: 0n,
    transactionHash: Buffer.alloc(0), transfers: [],
  };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) { out.status = Number(r.varint()); out.statusName = RESPONSE_CODES[out.status] ?? `CODE_${out.status}`; }
    else if (fieldNum === 2 && wireType === 2) out.consensusTimestamp = decodeTimestamp(r.bytes());
    else if (fieldNum === 3 && wireType === 2) out.transfers = decodeTransferList(r.bytes());
    else if (fieldNum === 4 && wireType === 2) out.transactionHash = r.bytes();
    else if (fieldNum === 5 && wireType === 2) out.payerAccountId = decodeAccountId(r.bytes());
    else if (fieldNum === 6 && wireType === 0) out.transactionFee = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeTransferList(buf: Buffer): Transfer[] {
  const transfers: Transfer[] = [];
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) {
      const ra = new ProtoReader(r.bytes());
      const entry: Transfer = { amount: 0n };
      while (ra.more()) {
        const t = ra.tag();
        if (t.fieldNum === 1 && t.wireType === 2) entry.accountId = decodeAccountId(ra.bytes());
        else if (t.fieldNum === 2 && t.wireType === 0) entry.amount = zigzagDecode64(ra.varint());
        else ra.skip(t.wireType);
      }
      transfers.push(entry);
    } else {
      r.skip(wireType);
    }
  }
  return transfers;
}

function decodeStateChanges(buf: Buffer): StateChanges {
  const out: StateChanges = { changes: [] };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.consensusTimestamp = decodeTimestamp(r.bytes());
    else if (fieldNum === 2 && wireType === 2) {
      const sc: StateChange = { stateId: 0, stateName: "" };
      const rs = new ProtoReader(r.bytes());
      while (rs.more()) {
        const t = rs.tag();
        if (t.fieldNum === 1 && t.wireType === 0) {
          sc.stateId = Number(rs.varint());
          sc.stateName = STATE_IDS[sc.stateId] ?? `STATE_${sc.stateId}`;
        } else rs.skip(t.wireType);
      }
      out.changes.push(sc);
    } else {
      r.skip(wireType);
    }
  }
  return out;
}

function decodeFilteredItemHash(buf: Buffer): FilteredItemHash {
  const out: FilteredItemHash = { itemHash: Buffer.alloc(0), filteredPath: 0n };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.itemHash = r.bytes();
    else if (fieldNum === 3 && wireType === 0) out.filteredPath = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeBlockProof(buf: Buffer): BlockProof {
  const out: BlockProof = {
    block: 0n, previousBlockRootHash: Buffer.alloc(0),
    startOfBlockStateRootHash: Buffer.alloc(0),
    blockSignature: Buffer.alloc(0), siblingHashes: [],
  };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.block = r.varint();
    else if (fieldNum === 2 && wireType === 2) out.previousBlockRootHash = r.bytes();
    else if (fieldNum === 3 && wireType === 2) out.startOfBlockStateRootHash = r.bytes();
    else if (fieldNum === 4 && wireType === 2) out.blockSignature = r.bytes();
    else if (fieldNum === 5 && wireType === 2) out.siblingHashes.push(r.bytes());
    else r.skip(wireType);
  }
  return out;
}

function decodeRecordFile(buf: Buffer): RecordFile {
  const out: RecordFile = { number: 0n, transactions: [] };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.creationTime = decodeTimestamp(r.bytes());
    else if (fieldNum === 3 && wireType === 0) out.number = r.varint();
    else if (fieldNum === 2 && wireType === 2) {
      // RecordStreamFile proto
      out.transactions = extractTransactionsFromRecordStreamFile(r.bytes());
    } else {
      r.skip(wireType);
    }
  }
  return out;
}

function extractTransactionsFromRecordStreamFile(buf: Buffer): DecodedTransaction[] {
  const txs: DecodedTransaction[] = [];
  try {
    const r = new ProtoReader(buf);
    while (r.more()) {
      const { fieldNum, wireType } = r.tag();
      if (fieldNum === 3 && wireType === 2) {
        // RecordStreamItem: field 1 = Transaction
        const item = r.bytes();
        const ri = new ProtoReader(item);
        while (ri.more()) {
          const t = ri.tag();
          if (t.fieldNum === 1 && t.wireType === 2) {
            const tx = decodeTransactionProto(ri.bytes());
            txs.push(tx);
            break;
          } else ri.skip(t.wireType);
        }
      } else {
        r.skip(wireType);
      }
    }
  } catch (_) {}
  return txs;
}

function decodeAddressBookProof(buf: Buffer): AddressBookProof {
  const out: AddressBookProof = {
    previousAddressBookHash: Buffer.alloc(0),
    currentAddressBookHash:  Buffer.alloc(0),
    ledgerHash:              Buffer.alloc(0),
  };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if      (fieldNum === 1 && wireType === 2) out.previousAddressBookHash = r.bytes();
    else if (fieldNum === 2 && wireType === 2) out.currentAddressBookHash  = r.bytes();
    else if (fieldNum === 3 && wireType === 2) out.ledgerHash              = r.bytes();
    else r.skip(wireType);
  }
  return out;
}

// ─── Top-level BlockItem decoder ──────────────────────────────────────────────

export function decodeBlockItem(raw: Buffer): BlockItem {
  try {
    const r = new ProtoReader(raw);
    while (r.more()) {
      const { fieldNum, wireType } = r.tag();
      const kind = BLOCK_ITEM_FIELDS[fieldNum];
      if (kind && wireType === 2) {
        const inner = r.bytes();
        let payload: BlockItem["payload"];
        switch (kind) {
          case "block_header":       payload = decodeBlockHeader(inner);       break;
          case "event_header":       payload = decodeEventHeader(inner);       break;
          case "round_header":       payload = decodeRoundHeader(inner);       break;
          case "event_transaction":  payload = decodeEventTransaction(inner);  break;
          case "transaction_result": payload = decodeTransactionResult(inner); break;
          case "state_changes":      payload = decodeStateChanges(inner);      break;
          case "filtered_item_hash": payload = decodeFilteredItemHash(inner);  break;
          case "block_proof":        payload = decodeBlockProof(inner);        break;
          case "record_file":        payload = decodeRecordFile(inner);        break;
          case "address_book_proof": payload = decodeAddressBookProof(inner);  break;
          default: payload = {};
        }
        return { kind, raw, payload };
      } else {
        r.skip(wireType);
      }
    }
  } catch (e) {
    return { kind: "unknown", raw, payload: { error: String(e) } };
  }
  return { kind: "unknown", raw, payload: {} };
}

// ─── Lookup tables ────────────────────────────────────────────────────────────

export const RESPONSE_CODES: Record<number, string> = {
  0: "OK", 4: "INVALID_TRANSACTION", 7: "MEMO_TOO_LONG",
  21: "INVALID_SIGNATURE", 22: "SUCCESS", 32: "DUPLICATE_TRANSACTION",
  50: "ACCOUNT_ID_DOES_NOT_EXIST", 78: "INSUFFICIENT_PAYER_BALANCE",
};

export const STATE_IDS: Record<number, string> = {
  0:"UNKNOWN",1:"ENTITY_ID",2:"ACCOUNTS",3:"ALIASES",4:"STORAGE",5:"BYTECODE",
  6:"FILES",7:"TOKENS",8:"NFTS",9:"TOKEN_RELS",10:"STAKING_INFOS",
  11:"STAKING_NETWORK_REWARDS",12:"THROTTLE_USAGE",13:"CONGESTION_STARTS",
  14:"SCHEDULES_BY_ID",18:"RUNNING_HASHES",19:"BLOCKS",20:"NODES",21:"TOPICS",
  24:"BLOCK_STREAM_INFO",25:"PENDING_AIRDROPS",
};

// ─── FullTransaction decoders (getBlockTransactions) ─────────────────────────

function decodeSignatureMap(buf: Buffer): Signature[] {
  const sigs: Signature[] = [];
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) {
      const sp = r.bytes();
      const sig: Signature = { pubKeyPrefix: "", type: "unknown", signature: "" };
      const rs = new ProtoReader(sp);
      while (rs.more()) {
        const t = rs.tag();
        if (t.fieldNum === 1 && t.wireType === 2) {
          sig.pubKeyPrefix = rs.bytes().toString("hex");
        } else if (t.fieldNum === 2 && t.wireType === 2) {
          sig.type = "contract"; sig.signature = rs.bytes().toString("hex");
        } else if (t.fieldNum === 3 && t.wireType === 2) {
          sig.type = "ed25519"; sig.signature = rs.bytes().toString("hex");
        } else if (t.fieldNum === 4 && t.wireType === 2) {
          sig.type = "rsa_3072"; sig.signature = rs.bytes().toString("hex");
        } else if (t.fieldNum === 6 && t.wireType === 2) {
          sig.type = "ecdsa_secp256k1"; sig.signature = rs.bytes().toString("hex");
        } else {
          rs.skip(t.wireType);
        }
      }
      sigs.push(sig);
    } else {
      r.skip(wireType);
    }
  }
  return sigs;
}

function decodeEntityId(buf: Buffer): EntityId {
  const out: EntityId = { shardNum: 0n, realmNum: 0n, entityNum: 0n };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.shardNum  = r.varint();
    else if (fieldNum === 2 && wireType === 0) out.realmNum  = r.varint();
    else if (fieldNum === 3 && wireType === 0) out.entityNum = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeTokenId(buf: Buffer): TokenId {
  const out: TokenId = { shardNum: 0n, realmNum: 0n, tokenNum: 0n };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.shardNum  = r.varint();
    else if (fieldNum === 2 && wireType === 0) out.realmNum  = r.varint();
    else if (fieldNum === 3 && wireType === 0) out.tokenNum  = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeExchangeRateSet(buf: Buffer): ExchangeRateSet {
  const out: ExchangeRateSet = {};
  const decodeRate = (b: Buffer): ExchangeRate => {
    const rate: ExchangeRate = { hbarEquivalent: 0, centEquivalent: 0 };
    const rr = new ProtoReader(b);
    while (rr.more()) {
      const t = rr.tag();
      if (t.fieldNum === 1 && t.wireType === 0) rate.hbarEquivalent = Number(rr.varint());
      else if (t.fieldNum === 2 && t.wireType === 0) rate.centEquivalent = Number(rr.varint());
      else rr.skip(t.wireType);
    }
    return rate;
  };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.currentRate = decodeRate(r.bytes());
    else if (fieldNum === 2 && wireType === 2) out.nextRate  = decodeRate(r.bytes());
    else r.skip(wireType);
  }
  return out;
}

function decodeTransactionReceiptFull(buf: Buffer): TransactionReceipt {
  const out: TransactionReceipt = { status: 0, statusName: "UNKNOWN" };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) {
      out.status = Number(r.varint());
      out.statusName = RESPONSE_CODES[out.status] ?? `CODE_${out.status}`;
    } else if (fieldNum === 2 && wireType === 2) out.accountId  = decodeAccountId(r.bytes());
    else if (fieldNum === 3 && wireType === 2) out.fileId      = decodeEntityId(r.bytes());
    else if (fieldNum === 4 && wireType === 2) out.contractId  = decodeEntityId(r.bytes());
    else if (fieldNum === 5 && wireType === 2) out.exchangeRate = decodeExchangeRateSet(r.bytes());
    else if (fieldNum === 6 && wireType === 2) out.topicId     = decodeEntityId(r.bytes());
    else if (fieldNum === 7 && wireType === 0) out.topicSequenceNumber = r.varint();
    else if (fieldNum === 8 && wireType === 2) out.topicRunningHash = r.bytes();
    else if (fieldNum === 9 && wireType === 0) out.topicRunningHashVersion = r.varint();
    else if (fieldNum === 10 && wireType === 2) out.tokenId    = decodeTokenId(r.bytes());
    else if (fieldNum === 11 && wireType === 0) {
      if (!out.serialNumbers) out.serialNumbers = [];
      out.serialNumbers.push(toSigned64(r.varint()));
    } else if (fieldNum === 11 && wireType === 2) {
      // packed int64 serial numbers
      if (!out.serialNumbers) out.serialNumbers = [];
      const pb = r.bytes();
      const pr = new ProtoReader(pb);
      while (pr.more()) out.serialNumbers.push(toSigned64(pr.varint()));
    } else if (fieldNum === 12 && wireType === 2) out.scheduleId = decodeEntityId(r.bytes());
    else if (fieldNum === 14 && wireType === 0) out.nodeId     = r.varint();
    else r.skip(wireType);
  }
  return out;
}

function decodeTokenTransferList(buf: Buffer): TokenTransferList {
  const out: TokenTransferList = { transfers: [], nftTransfers: [] };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) {
      out.tokenId = decodeTokenId(r.bytes());
    } else if (fieldNum === 2 && wireType === 2) {
      const aa = r.bytes();
      const ra = new ProtoReader(aa);
      const t: TokenTransfer = { amount: 0n };
      while (ra.more()) {
        const tat = ra.tag();
        if (tat.fieldNum === 1 && tat.wireType === 2) t.accountId = decodeAccountId(ra.bytes());
        else if (tat.fieldNum === 2 && tat.wireType === 0) t.amount = zigzagDecode64(ra.varint());
        else if (tat.fieldNum === 3 && tat.wireType === 0) t.isApproval = Boolean(ra.varint());
        else ra.skip(tat.wireType);
      }
      out.transfers.push(t);
    } else if (fieldNum === 3 && wireType === 2) {
      const nft = r.bytes();
      const rn = new ProtoReader(nft);
      const n: NftTransfer = { serialNumber: 0n };
      while (rn.more()) {
        const nt = rn.tag();
        if (nt.fieldNum === 1 && nt.wireType === 2) n.senderAccountId   = decodeAccountId(rn.bytes());
        else if (nt.fieldNum === 2 && nt.wireType === 2) n.receiverAccountId = decodeAccountId(rn.bytes());
        else if (nt.fieldNum === 3 && nt.wireType === 0) n.serialNumber   = toSigned64(rn.varint());
        else if (nt.fieldNum === 4 && nt.wireType === 0) n.isApproval     = Boolean(rn.varint());
        else rn.skip(nt.wireType);
      }
      out.nftTransfers.push(n);
    } else {
      r.skip(wireType);
    }
  }
  return out;
}

function decodeAssessedCustomFee(buf: Buffer): AssessedCustomFee {
  const out: AssessedCustomFee = { amount: 0n, effectivePayerAccountIds: [] };
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 0) out.amount = toSigned64(r.varint());
    else if (fieldNum === 2 && wireType === 2) out.tokenId = decodeTokenId(r.bytes());
    else if (fieldNum === 3 && wireType === 2) out.feeCollectorAccountId = decodeAccountId(r.bytes());
    else if (fieldNum === 4 && wireType === 2) out.effectivePayerAccountIds.push(decodeAccountId(r.bytes()));
    else r.skip(wireType);
  }
  return out;
}

// Decodes a Hedera TransactionRecord proto (from record_file RecordStreamItem.field2)
function decodeHederaTransactionRecord(buf: Buffer, out: FullTransaction): void {
  const r = new ProtoReader(buf);
  while (r.more()) {
    const { fieldNum, wireType } = r.tag();
    if (fieldNum === 1 && wireType === 2) out.receipt = decodeTransactionReceiptFull(r.bytes());
    else if (fieldNum === 2 && wireType === 2) out.transactionHash = r.bytes();
    else if (fieldNum === 3 && wireType === 2) out.consensusTimestamp = decodeTimestamp(r.bytes());
    else if (fieldNum === 4 && wireType === 2) { if (!out.transactionId) out.transactionId = decodeTransactionId(r.bytes()); else r.skip(wireType); }
    else if (fieldNum === 5 && wireType === 2) { const m = r.bytes().toString("utf8").trim(); if (m && !out.memo) out.memo = m; }
    else if (fieldNum === 6 && wireType === 0) out.transactionFee = r.varint();
    else if (fieldNum === 10 && wireType === 2) out.transfers = decodeTransferList(r.bytes());
    else if (fieldNum === 11 && wireType === 2) out.tokenTransfers.push(decodeTokenTransferList(r.bytes()));
    else if (fieldNum === 13 && wireType === 2) out.assessedCustomFees.push(decodeAssessedCustomFee(r.bytes()));
    else if (fieldNum === 16 && wireType === 2) out.alias = r.bytes();
    else if (fieldNum === 17 && wireType === 2) out.ethereumHash = r.bytes();
    else if (fieldNum === 21 && wireType === 2) out.evmAddress = r.bytes();
    else r.skip(wireType);
  }
}

// Decodes Transaction bytes (body + signatures) into the provided FullTransaction
function decodeTransactionIntoFull(txBytes: Buffer, out: FullTransaction): void {
  let signedTxBytes: Buffer | null = null;
  let legacyBodyBytes: Buffer | null = null;
  let legacySigMapBytes: Buffer | null = null;

  const r0 = new ProtoReader(txBytes);
  while (r0.more()) {
    const { fieldNum, wireType } = r0.tag();
    if (fieldNum === 5 && wireType === 2) signedTxBytes    = r0.bytes();
    else if (fieldNum === 3 && wireType === 2) legacyBodyBytes  = r0.bytes();
    else if (fieldNum === 2 && wireType === 2) legacySigMapBytes = r0.bytes();
    else r0.skip(wireType);
  }

  let bodyBytes: Buffer | null = null;

  if (signedTxBytes) {
    const r1 = new ProtoReader(signedTxBytes);
    while (r1.more()) {
      const { fieldNum, wireType } = r1.tag();
      if (fieldNum === 1 && wireType === 2) bodyBytes = r1.bytes();
      else if (fieldNum === 2 && wireType === 2) out.signatures = decodeSignatureMap(r1.bytes());
      else r1.skip(wireType);
    }
  } else if (legacyBodyBytes) {
    bodyBytes = legacyBodyBytes;
    if (legacySigMapBytes) out.signatures = decodeSignatureMap(legacySigMapBytes);
  }

  if (!bodyBytes) return;

  const r2 = new ProtoReader(bodyBytes);
  while (r2.more()) {
    const { fieldNum, wireType } = r2.tag();
    if (fieldNum === 1 && wireType === 2) out.transactionId = decodeTransactionId(r2.bytes());
    else if (fieldNum === 2 && wireType === 2) out.nodeAccountId = decodeAccountId(r2.bytes());
    else if (fieldNum === 3 && wireType === 0) out.maxTransactionFee = r2.varint();
    else if (fieldNum === 4 && wireType === 2) {
      const db = r2.bytes();
      const dr = new ProtoReader(db);
      while (dr.more()) {
        const dt = dr.tag();
        if (dt.fieldNum === 1 && dt.wireType === 0) out.transactionValidDuration = dr.varint();
        else dr.skip(dt.wireType);
      }
    } else if (fieldNum === 6 && wireType === 2) {
      const m = r2.bytes().toString("utf8").trim();
      if (m) out.memo = m;
    } else if (TX_TYPES[fieldNum]) {
      out.type = TX_TYPES[fieldNum];
      r2.skip(wireType);
    } else {
      r2.skip(wireType);
    }
  }
}

function extractFullTransactionsFromRecordStreamFile(buf: Buffer): FullTransaction[] {
  const txs: FullTransaction[] = [];
  try {
    const r = new ProtoReader(buf);
    while (r.more()) {
      const { fieldNum, wireType } = r.tag();
      if (fieldNum === 3 && wireType === 2) {
        const itemBuf = r.bytes();
        let txBytes: Buffer | null = null;
        let recordBytes: Buffer | null = null;
        const ri = new ProtoReader(itemBuf);
        while (ri.more()) {
          const t = ri.tag();
          if (t.fieldNum === 1 && t.wireType === 2) txBytes     = ri.bytes();
          else if (t.fieldNum === 2 && t.wireType === 2) recordBytes = ri.bytes();
          else ri.skip(t.wireType);
        }
        if (txBytes) {
          const full: FullTransaction = {
            signatures: [], transfers: [], tokenTransfers: [],
            assessedCustomFees: [], rawTransaction: txBytes,
          };
          if (recordBytes) full.rawRecord = recordBytes;
          try { decodeTransactionIntoFull(txBytes, full); } catch (_) {}
          if (recordBytes) { try { decodeHederaTransactionRecord(recordBytes, full); } catch (_) {} }
          txs.push(full);
        }
      } else {
        r.skip(wireType);
      }
    }
  } catch (_) {}
  return txs;
}

/**
 * Decode all transactions from a raw BlockItem buffer.
 *
 * For record_file items (historical blocks): returns fully decoded transactions
 * with body fields, all signatures, receipt, HBAR/token/NFT transfers, and
 * assessed custom fees.
 *
 * For event_transaction items (native stream blocks): returns transactions with
 * body fields and signatures. Pass the corresponding transaction_result item
 * raw bytes separately if you need the record fields.
 *
 * Returns an empty array for non-transaction item kinds.
 */
export function decodeFullTransactionsFromBlockItem(raw: Buffer): FullTransaction[] {
  try {
    const r = new ProtoReader(raw);
    while (r.more()) {
      const { fieldNum, wireType } = r.tag();
      if (fieldNum === 10 && wireType === 2) {
        // RecordFileItem wrapper
        const rfiBuf = r.bytes();
        const rfi = new ProtoReader(rfiBuf);
        while (rfi.more()) {
          const t = rfi.tag();
          if (t.fieldNum === 2 && t.wireType === 2) {
            return extractFullTransactionsFromRecordStreamFile(rfi.bytes());
          } else {
            rfi.skip(t.wireType);
          }
        }
        return [];
      } else if (fieldNum === 4 && wireType === 2) {
        // event_transaction: single transaction
        const etBuf = r.bytes();
        let txBytes: Buffer | null = null;
        const re = new ProtoReader(etBuf);
        while (re.more()) {
          const t = re.tag();
          if (t.fieldNum === 1 && t.wireType === 2) { txBytes = re.bytes(); break; }
          else re.skip(t.wireType);
        }
        if (!txBytes) return [];
        const full: FullTransaction = {
          signatures: [], transfers: [], tokenTransfers: [],
          assessedCustomFees: [], rawTransaction: txBytes,
        };
        try { decodeTransactionIntoFull(txBytes, full); } catch (_) {}
        return [full];
      } else {
        r.skip(wireType);
      }
    }
  } catch (_) {}
  return [];
}
