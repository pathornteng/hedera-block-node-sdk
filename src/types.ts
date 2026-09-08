// ─── Public types ─────────────────────────────────────────────────────────────

export interface BlockNodeClientOptions {
  /**
   * Block node hostname, without a port, e.g. "s01.test.blk.ams.lat.ope.eng.hashgraph.io".
   * Ports are fixed per service: subscriber=40980, blockAccess=40981, serverStatus=40982.
   */
  endpoint: string;
  /**
   * TLS mode.
   *   "tls"      – TLS with self-signed cert tolerance (default)
   *   "insecure" – plaintext (USE_INSECURE=1 equivalent)
   */
  tls?: "tls" | "insecure";
  /** Timeout in ms for unary calls (serverStatus, getBlock). Default: 10000 */
  timeout?: number;
}

// ── ServerStatus ──────────────────────────────────────────────────────────────

export interface ServerStatusResponse {
  firstAvailableBlock: bigint;
  lastAvailableBlock: bigint;
  nextExpectedBlock: bigint;
  onlyLatestState: boolean;
}

// ── ServerStatusDetail ────────────────────────────────────────────────────────

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface BlockRange {
  rangeStart: bigint;
  rangeEnd: bigint;
}

export interface PluginVersion {
  pluginId: string;
  pluginSoftwareVersion?: SemanticVersion;
  pluginFeatureNames: string[];
}

export interface BlockNodeVersions {
  streamProtoVersion?: SemanticVersion;
  blockNodeVersion?: SemanticVersion;
  installedPluginVersions: PluginVersion[];
}

export interface ServerStatusDetailResponse {
  versionInformation?: BlockNodeVersions;
  availableRanges: BlockRange[];
  storedRanges: BlockRange[];
  nodeAddressBook?: unknown;
  tssData?: unknown;
}

// ── GetBlock ──────────────────────────────────────────────────────────────────

export type BlockRequestSpecifier =
  | { blockNumber: bigint }
  | { retrieveLatest: true };

export enum BlockResponseCode {
  UNKNOWN = 0,
  SUCCESS = 1,
  INVALID_REQUEST = 2,
  ERROR = 3,
  NOT_FOUND = 4,
  NOT_AVAILABLE = 5,
}

export interface AddressBookProof {
  previousAddressBookHash: Buffer;
  currentAddressBookHash: Buffer;
  ledgerHash: Buffer;
}

/** A single decoded BlockItem from the stream or getBlock response */
export interface BlockItem {
  /** The discriminator name of the oneof field that was set */
  kind: BlockItemKind;
  /** Raw bytes of the inner message (before kind-specific decoding) */
  raw: Buffer;
  /** Decoded payload — shape depends on `kind` */
  payload: BlockHeader | EventHeader | RoundHeader | EventTransaction
         | TransactionResult | StateChanges | FilteredItemHash
         | BlockProof | RecordFile | AddressBookProof | Record<string, unknown>;
}

export type BlockItemKind =
  | "block_header"
  | "event_header"
  | "round_header"
  | "event_transaction"
  | "transaction_result"
  | "transaction_output"
  | "state_changes"
  | "filtered_item_hash"
  | "block_proof"
  | "record_file"
  | "address_book_proof"
  | "unknown";

export interface BlockHeader {
  number: bigint;
  hapiProtoVersion?: SemanticVersion;
  softwareVersion?: SemanticVersion;
  previousBlockHash: Buffer;
  firstTransactionConsensusTime?: Timestamp;
  hashAlgorithm: number;
}

export interface EventHeader {
  birthRound: bigint;
  generation: bigint;
  creatorNodeId: Buffer;
}

export interface RoundHeader {
  roundNumber: bigint;
}

export interface TransactionId {
  accountId?: AccountId;
  transactionValidStart?: Timestamp;
  scheduled: boolean;
  nonce: number;
  /** Canonical format: "0.0.X@seconds.nanos" */
  toString(): string;
}

export interface AccountId {
  shardNum: bigint;
  realmNum: bigint;
  accountNum: bigint;
}

export interface Timestamp {
  seconds: bigint;
  nanos: number;
  toDate(): Date;
}

export interface EventTransaction {
  kind: "application" | "system";
  transactionId?: TransactionId;
  type?: string;
  memo?: string;
  raw: Buffer;
}

export interface TransactionResult {
  status: number;
  statusName: string;
  consensusTimestamp?: Timestamp;
  transactionFee: bigint;
  payerAccountId?: AccountId;
  transactionHash: Buffer;
  transfers: Transfer[];
}

export interface Transfer {
  accountId?: AccountId;
  amount: bigint;
}

export interface StateChange {
  stateId: number;
  stateName: string;
}

export interface StateChanges {
  consensusTimestamp?: Timestamp;
  changes: StateChange[];
}

export interface FilteredItemHash {
  itemHash: Buffer;
  filteredPath: bigint;
}

export interface BlockProof {
  block: bigint;
  previousBlockRootHash: Buffer;
  startOfBlockStateRootHash: Buffer;
  blockSignature: Buffer;
  siblingHashes: Buffer[];
}

export interface RecordFile {
  creationTime?: Timestamp;
  number: bigint;
  transactions: DecodedTransaction[];
}

export interface DecodedTransaction {
  transactionId?: TransactionId;
  type?: string;
  memo?: string;
}

export interface GetBlockResponse {
  status: BlockResponseCode;
  statusName: string;
  block?: BlockItem[];
}

// ── Subscribe ─────────────────────────────────────────────────────────────────

export enum SubscribeStreamCode {
  UNKNOWN = 0,
  SUCCESS = 1,
  INVALID_REQUEST = 2,
  ERROR = 3,
  INVALID_START_BLOCK_NUMBER = 4,
  INVALID_END_BLOCK_NUMBER = 5,
  NOT_AVAILABLE = 6,
}

export interface BlockStreamOptions {
  startBlockNumber: bigint | number;
  /**
   * End block. Omit or pass 0n for a live open-ended stream.
   * The SDK automatically converts 0 to uint64_max for you.
   */
  endBlockNumber?: bigint | number;
}

export interface BlockStreamCallbacks {
  /** Called once after the stream is opened — SUCCESS means items will follow */
  onStatus?: (code: SubscribeStreamCode, name: string) => void;
  /** Called once per complete block (after end_of_block is received) */
  onBlock?: (blockNumber: bigint, items: BlockItem[]) => void;
  /** Called on stream error */
  onError?: (err: Error) => void;
  /** Called when the stream ends (either bounded range finished or cancelled) */
  onEnd?: () => void;
}

export interface StreamHandle {
  /** Cancel the stream */
  cancel(): void;
}

// ── FullTransaction (getBlockTransactions) ────────────────────────────────────

export interface Signature {
  /** Leading bytes of the public key, hex-encoded */
  pubKeyPrefix: string;
  /** Signature algorithm */
  type: "ed25519" | "ecdsa_secp256k1" | "rsa_3072" | "contract" | "unknown";
  /** Signature bytes, hex-encoded */
  signature: string;
}

export interface EntityId {
  shardNum: bigint;
  realmNum: bigint;
  entityNum: bigint;
}

export interface TokenId {
  shardNum: bigint;
  realmNum: bigint;
  tokenNum: bigint;
}

export interface ExchangeRate {
  hbarEquivalent: number;
  centEquivalent: number;
}

export interface ExchangeRateSet {
  currentRate?: ExchangeRate;
  nextRate?: ExchangeRate;
}

export interface TransactionReceipt {
  status: number;
  statusName: string;
  accountId?: AccountId;
  fileId?: EntityId;
  contractId?: EntityId;
  topicId?: EntityId;
  tokenId?: TokenId;
  scheduleId?: EntityId;
  exchangeRate?: ExchangeRateSet;
  topicSequenceNumber?: bigint;
  topicRunningHash?: Buffer;
  topicRunningHashVersion?: bigint;
  serialNumbers?: bigint[];
  nodeId?: bigint;
}

export interface TokenTransfer {
  accountId?: AccountId;
  amount: bigint;
  isApproval?: boolean;
}

export interface NftTransfer {
  senderAccountId?: AccountId;
  receiverAccountId?: AccountId;
  serialNumber: bigint;
  isApproval?: boolean;
}

export interface TokenTransferList {
  tokenId?: TokenId;
  transfers: TokenTransfer[];
  nftTransfers: NftTransfer[];
}

export interface AssessedCustomFee {
  amount: bigint;
  tokenId?: TokenId;
  feeCollectorAccountId?: AccountId;
  effectivePayerAccountIds: AccountId[];
}

export interface FullTransaction {
  /** Hedera transaction ID */
  transactionId?: TransactionId;
  /** Transaction type string, e.g. "CRYPTO_TRANSFER" */
  type?: string;
  /** Optional memo */
  memo?: string;
  /** Node the transaction was submitted to */
  nodeAccountId?: AccountId;
  /** Maximum fee the payer authorised (tinybars) */
  maxTransactionFee?: bigint;
  /** Transaction validity window (seconds) */
  transactionValidDuration?: bigint;
  /** All signatures from the SignatureMap */
  signatures: Signature[];
  /** Receipt: final status plus any created entity IDs */
  receipt?: TransactionReceipt;
  /** Consensus timestamp */
  consensusTimestamp?: Timestamp;
  /** SHA-384 hash of the transaction bytes */
  transactionHash?: Buffer;
  /** Actual fee charged (tinybars) */
  transactionFee?: bigint;
  /** HBAR transfers */
  transfers: Transfer[];
  /** Fungible-token and NFT transfers */
  tokenTransfers: TokenTransferList[];
  /** Custom fees assessed during token operations */
  assessedCustomFees: AssessedCustomFee[];
  /** Auto-generated alias (CryptoCreate with alias) */
  alias?: Buffer;
  /** Ethereum transaction hash (EthereumTransaction) */
  ethereumHash?: Buffer;
  /** EVM contract address */
  evmAddress?: Buffer;
  /** Raw serialised Transaction proto bytes */
  rawTransaction: Buffer;
  /** Raw serialised TransactionRecord proto bytes (record_file blocks only) */
  rawRecord?: Buffer;
  /**
   * Raw serialised TransactionBody proto bytes — the exact message that
   * `signatures[]` sign for Ed25519, and whose keccak256 hash `signatures[]`
   * sign for ECDSA secp256k1. Present whenever the transaction body could be
   * decoded at all.
   */
  bodyBytes?: Buffer;
  /**
   * Raw serialised SignedTransaction proto bytes (bodyBytes + sigMap
   * together) — SHA-384 of this is what `TransactionRecord.transactionHash`
   * contains. Only present when the transaction used the modern
   * `signedTransactionBytes` wire format (i.e. not legacy transactions
   * using the deprecated top-level bodyBytes/sigMap fields directly).
   */
  signedTransactionBytes?: Buffer;
}
