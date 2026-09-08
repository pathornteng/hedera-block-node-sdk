const pptx = require("pptxgenjs");

const prs = new pptx();

// ── Theme ─────────────────────────────────────────────────────────────────────
const PURPLE    = "5B2D8E";
const WHITE     = "FFFFFF";
const LIGHT_BG  = "F5F0FA";
const ACCENT    = "8B5CF6";
const TEXT_DARK = "1E1E2E";
const TEXT_MID  = "4B5563";
const ROW_ALT   = "EDE9F5";

prs.layout  = "LAYOUT_WIDE";
prs.author  = "Hedera Block Node SDK";
prs.subject = "API Reference";
prs.title   = "Block Node Client — API Reference";

// ── Helper: slide with purple header bar ─────────────────────────────────────
function makeSlide(title, subtitle) {
  const slide = prs.addSlide();
  // background
  slide.background = { color: WHITE };
  // top bar
  slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 1.1, fill: { color: PURPLE } });
  // title
  slide.addText(title, {
    x: 0.4, y: 0.12, w: 9, h: 0.7,
    fontSize: 26, bold: true, color: WHITE, fontFace: "Calibri",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.72, w: 9, h: 0.35,
      fontSize: 13, color: "D8B4FE", fontFace: "Calibri",
    });
  }
  // bottom accent line
  slide.addShape(prs.ShapeType.rect, { x: 0, y: 6.95, w: "100%", h: 0.05, fill: { color: ACCENT } });
  return slide;
}

// ── Helper: table ─────────────────────────────────────────────────────────────
function addTable(slide, headers, rows, y = 1.25, colW = null) {
  const w = colW || Array(headers.length).fill(10 / headers.length);
  const tableRows = [
    headers.map(h => ({
      text: h,
      options: { bold: true, color: WHITE, fill: { color: PURPLE }, fontSize: 11, align: "left" },
    })),
    ...rows.map((row, ri) =>
      row.map(cell => ({
        text: cell,
        options: { color: TEXT_DARK, fill: { color: ri % 2 === 0 ? WHITE : ROW_ALT }, fontSize: 10, align: "left" },
      }))
    ),
  ];
  slide.addTable(tableRows, {
    x: 0.4, y, w: 9.2,
    colW: w,
    rowH: 0.32,
    border: { pt: 0.5, color: "E5E7EB" },
    fontFace: "Calibri",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 1 — Cover
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = prs.addSlide();
  slide.background = { color: PURPLE };
  slide.addShape(prs.ShapeType.rect, { x: 0, y: 4.5, w: "100%", h: 3, fill: { color: "3B0764" } });
  slide.addText("@ohmpathorn/block-node-client", {
    x: 0.6, y: 1.4, w: 9,
    fontSize: 36, bold: true, color: WHITE, fontFace: "Calibri",
  });
  slide.addText("API Reference — All Endpoints & Fields", {
    x: 0.6, y: 2.2, w: 9,
    fontSize: 20, color: "D8B4FE", fontFace: "Calibri",
  });
  slide.addText("Hedera Block Node SDK  •  v0.1.0", {
    x: 0.6, y: 5.6, w: 9,
    fontSize: 13, color: "A78BFA", fontFace: "Calibri",
  });
  slide.addText("Block Node v0.37.1  •  Testnet", {
    x: 0.6, y: 5.95, w: 9,
    fontSize: 12, color: "C4B5FD", fontFace: "Calibri",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 2 — Overview
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("SDK Overview", "Four gRPC endpoints, fully decoded");
  addTable(slide,
    ["Method", "RPC Type", "Service", "Description"],
    [
      ["serverStatus()", "Unary", "BlockNodeService", "Health check — first/last block, node state"],
      ["serverStatusDetail()", "Unary", "BlockNodeService", "Versions, block ranges, installed plugins"],
      ["getBlock()", "Unary", "BlockAccessService", "Fetch a single block by number or latest"],
      ["subscribeBlockStream()", "Server-streaming", "BlockStreamSubscribeService", "Live or historical block stream with callbacks"],
    ],
    1.25,
    [2.4, 1.4, 2.2, 3.2],
  );

  slide.addText("All uint64 fields are returned as JavaScript BigInt (e.g. 38000000n)", {
    x: 0.4, y: 5.5, w: 9.2, h: 0.4,
    fontSize: 10, color: TEXT_MID, italic: true, fontFace: "Calibri",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 3 — serverStatus()
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("serverStatus()", "Lightweight health check — call this first");
  addTable(slide,
    ["Field", "Type", "Example Value", "Description"],
    [
      ["firstAvailableBlock", "bigint", "38000000n", "Oldest block the node can serve"],
      ["lastAvailableBlock",  "bigint", "38886747n", "Most recent block available"],
      ["nextExpectedBlock",   "bigint", "0n",        "Next block to be written (0 = not reported)"],
      ["onlyLatestState",     "boolean","false",     "Whether only the latest state is stored (false = full history)"],
    ],
    1.25,
    [2.4, 1.2, 1.8, 3.8],
  );

  slide.addText("Usage: const status = await client.serverStatus();", {
    x: 0.4, y: 5.2, w: 9.2, h: 0.36,
    fontSize: 10.5, color: TEXT_DARK, fontFace: "Courier New",
    fill: { color: LIGHT_BG }, shape: prs.ShapeType.rect,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 4 — serverStatusDetail() — versionInformation
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("serverStatusDetail() — Version Information", "Software and protocol versions");
  addTable(slide,
    ["Field", "Type", "Example Value"],
    [
      ["versionInformation.streamProtoVersion", "{ major, minor, patch }", "{ major:0, minor:73, patch:0 }"],
      ["versionInformation.blockNodeVersion",   "{ major, minor, patch }", "{ major:0, minor:37, patch:1 }"],
      ["versionInformation.installedPluginVersions", "PluginVersion[]", "13 plugins (see next slide)"],
      ["availableRanges",  "{ rangeStart, rangeEnd }[]", "[{ rangeStart:38000000n, rangeEnd:38886747n }]"],
      ["storedRanges",     "{ rangeStart, rangeEnd }[]", "[] (empty — same as available)"],
      ["tssData",          "unknown", "Not returned by v0.37.1"],
      ["nodeAddressBook",  "unknown", "Not returned by v0.37.1"],
    ],
    1.25,
    [3.6, 2.2, 3.4],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 5 — serverStatusDetail() — Installed Plugins
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("serverStatusDetail() — Installed Plugins", "All 13 plugins returned by v0.37.1");
  addTable(slide,
    ["Plugin ID (suffix)", "Version"],
    [
      ["messaging.BlockMessagingFacilityImpl",          "0.37.1"],
      ["app.HistoricalBlockFacilityImpl",               "0.37.1"],
      ["blocks.files.recent.BlockFileRecentPlugin",     "0.37.1"],
      ["blocks.files.historic.BlockFileHistoricPlugin", "0.37.1"],
      ["stream.subscriber.SubscriberServicePlugin",     "0.37.1"],
      ["roster.bootstrap.tss.RosterBootstrapTssPlugin", "0.37.1"],
      ["health.HealthServicePlugin",                    "0.37.1"],
      ["verification.VerificationServicePlugin",        "0.37.1"],
      ["backfill.BackfillPlugin",                       "0.37.1"],
      ["roster.bootstrap.rsa.RsaRosterBootstrapPlugin", "0.37.1"],
      ["access.service.BlockAccessServicePlugin",       "0.37.1"],
      ["server.status.ServerStatusServicePlugin",       "0.37.1"],
      ["stream.publisher.StreamPublisherPlugin",        "0.37.1"],
    ],
    1.25,
    [7.2, 2.0],
  );

  slide.addText("All prefixed with: org.hiero.block.node.", {
    x: 0.4, y: 6.55, w: 9.2, h: 0.3,
    fontSize: 9.5, color: TEXT_MID, italic: true, fontFace: "Calibri",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 6 — getBlock()
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("getBlock()", "Fetch a single block by number or latest");
  addTable(slide,
    ["Field", "Type", "Description"],
    [
      ["status",     "BlockResponseCode (number)", "0=UNKNOWN 1=SUCCESS 2=INVALID_REQUEST 3=ERROR 4=NOT_FOUND 5=NOT_AVAILABLE"],
      ["statusName", "string",                     "Human-readable status e.g. \"SUCCESS\""],
      ["block",      "BlockItem[] | undefined",    "Array of decoded block items (see following slides)"],
    ],
    1.25,
    [1.6, 2.4, 5.2],
  );

  slide.addText("Request options:", {
    x: 0.4, y: 3.3, w: 9.2, h: 0.3,
    fontSize: 11, bold: true, color: TEXT_DARK, fontFace: "Calibri",
  });
  addTable(slide,
    ["Option", "Type", "Example"],
    [
      ["{ blockNumber }",   "bigint", "client.getBlock({ blockNumber: 38764703n })"],
      ["{ retrieveLatest }","boolean","client.getBlock({ retrieveLatest: true })"],
    ],
    3.65,
    [2.0, 1.4, 5.8],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 7 — Block Item Kinds
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("Block Item Kinds", "Every item has: kind · payload · raw (Buffer)");
  addTable(slide,
    ["kind", "Payload Type", "When present"],
    [
      ["block_header",       "BlockHeader",       "First item in every block"],
      ["event_header",       "EventHeader",       "Native stream — gossip event metadata"],
      ["round_header",       "RoundHeader",       "Native stream — consensus round number"],
      ["event_transaction",  "EventTransaction",  "Native stream — one per transaction input"],
      ["transaction_result", "TransactionResult", "Native stream — one per transaction result"],
      ["state_changes",      "StateChanges",      "Native stream — state tables modified"],
      ["filtered_item_hash", "FilteredItemHash",  "Filtered streams — hash placeholder"],
      ["block_proof",        "BlockProof",        "Last item in every block"],
      ["record_file",        "RecordFile",        "Historical blocks (pre-HIP-1056)"],
      ["address_book_proof", "AddressBookProof",  "Historical blocks — address book hashes"],
    ],
    1.25,
    [2.2, 2.2, 4.8],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 8 — block_header & record_file payloads
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("Block Item Payloads — block_header & record_file");

  slide.addText("block_header", {
    x: 0.4, y: 1.15, w: 4, h: 0.3,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Field", "Type"],
    [
      ["number",                         "bigint"],
      ["hapiProtoVersion",               "{ major, minor, patch }"],
      ["softwareVersion",                "{ major, minor, patch } | undefined"],
      ["previousBlockHash",              "Buffer (48 bytes)"],
      ["firstTransactionConsensusTime",  "Timestamp | undefined"],
      ["hashAlgorithm",                  "number"],
    ],
    1.45,
    [3.6, 4.8],
  );

  slide.addText("record_file  (historical blocks)", {
    x: 0.4, y: 3.95, w: 6, h: 0.3,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Field", "Type"],
    [
      ["number",                    "bigint"],
      ["creationTime",              "Timestamp  { seconds, nanos, toDate() }"],
      ["transactions[].type",       "string  e.g. \"CRYPTO_TRANSFER\""],
      ["transactions[].transactionId.toString()", "\"0.0.945@1784053965.774000665\""],
      ["transactions[].transactionId.accountId",  "{ shardNum, realmNum, accountNum }"],
      ["transactions[].memo",       "string | undefined"],
    ],
    4.15,
    [3.6, 4.8],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 9 — event_transaction & transaction_result
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("Block Item Payloads — event_transaction & transaction_result", "Native stream blocks only");

  slide.addText("event_transaction", {
    x: 0.4, y: 1.15, w: 5, h: 0.3,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Field", "Type"],
    [
      ["kind",           "\"application\" | \"system\""],
      ["type",           "string  e.g. \"CRYPTO_TRANSFER\""],
      ["transactionId",  "TransactionId  { accountId, transactionValidStart, scheduled, nonce }"],
      ["memo",           "string | undefined"],
      ["raw",            "Buffer — full raw transaction bytes"],
    ],
    1.45,
    [2.2, 7.0],
  );

  slide.addText("transaction_result", {
    x: 0.4, y: 3.55, w: 5, h: 0.3,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Field", "Type"],
    [
      ["status / statusName",    "number / string  e.g. 22 / \"SUCCESS\""],
      ["consensusTimestamp",     "Timestamp  { seconds, nanos, toDate() }"],
      ["transactionFee",         "bigint  (tinybars)"],
      ["payerAccountId",         "AccountId  { shardNum, realmNum, accountNum }"],
      ["transactionHash",        "Buffer (48 bytes SHA-384)"],
      ["transfers",              "Transfer[]  { accountId, amount: bigint }"],
    ],
    3.75,
    [2.8, 6.4],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 10 — block_proof & address_book_proof
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("Block Item Payloads — block_proof & address_book_proof");

  slide.addText("block_proof", {
    x: 0.4, y: 1.15, w: 4, h: 0.3,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Field", "Type"],
    [
      ["block",                     "bigint  — block number"],
      ["previousBlockRootHash",     "Buffer  — SHA-384 hash"],
      ["startOfBlockStateRootHash", "Buffer  — SHA-384 hash"],
      ["blockSignature",            "Buffer  — TSS aggregated signature (~1.5 KB)"],
      ["siblingHashes",             "Buffer[]  — Merkle sibling hashes"],
    ],
    1.45,
    [3.2, 6.0],
  );

  slide.addText("address_book_proof  (historical blocks only)", {
    x: 0.4, y: 4.0, w: 7, h: 0.3,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Field", "Type"],
    [
      ["previousAddressBookHash", "Buffer  — SHA-384 hash of previous network address book"],
      ["currentAddressBookHash",  "Buffer  — SHA-384 hash of current network address book"],
      ["ledgerHash",              "Buffer  — SHA-384 ledger hash"],
    ],
    4.2,
    [3.2, 6.0],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 11 — subscribeBlockStream()
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("subscribeBlockStream()", "Server-streaming — returns StreamHandle with cancel()");

  slide.addText("Options", {
    x: 0.4, y: 1.15, w: 2, h: 0.28,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Option", "Type", "Description"],
    [
      ["startBlockNumber", "bigint | number", "First block to stream"],
      ["endBlockNumber",   "bigint | number | undefined", "Last block (0 or omit = live open-ended stream)"],
    ],
    1.43,
    [2.2, 2.4, 4.6],
  );

  slide.addText("Callbacks", {
    x: 0.4, y: 2.65, w: 2, h: 0.28,
    fontSize: 12, bold: true, color: PURPLE, fontFace: "Calibri",
  });
  addTable(slide,
    ["Callback", "Signature", "When fired"],
    [
      ["onStatus", "(code: SubscribeStreamCode, name: string) => void", "Once after stream opens — code 1 = SUCCESS"],
      ["onBlock",  "(blockNumber: bigint, items: BlockItem[]) => void", "Once per complete block (after end_of_block)"],
      ["onError",  "(err: Error) => void",                              "On stream error"],
      ["onEnd",    "() => void",                                        "When stream ends or is cancelled"],
    ],
    2.93,
    [1.6, 4.0, 3.6],
  );

  slide.addText("SubscribeStreamCode:  0=UNKNOWN  1=SUCCESS  2=INVALID_REQUEST  3=ERROR  4=INVALID_START_BLOCK_NUMBER  5=INVALID_END_BLOCK_NUMBER  6=NOT_AVAILABLE", {
    x: 0.4, y: 5.85, w: 9.2, h: 0.4,
    fontSize: 9, color: TEXT_MID, fontFace: "Calibri", italic: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE 12 — Testnet Endpoints
// ─────────────────────────────────────────────────────────────────────────────
{
  const slide = makeSlide("Testnet Endpoints", "Ports 40980/40981/40982 — TLS or plaintext (USE_INSECURE=1)");
  addTable(slide,
    ["Region", "Host"],
    [
      ["Amsterdam", "s01.test.blk.ams.lat.ope.eng.hashgraph.io"],
      ["Singapore", "s01.test.blk.sgp.lat.ope.eng.hashgraph.io"],
      ["Chicago",   "s01.test.blk.chi.lat.ope.eng.hashgraph.io"],
      ["Tier 2",    "lfh01.testnet.blocknode.hashgraph-devops.com"],
    ],
    1.25,
    [1.6, 7.6],
  );

  slide.addText("npm install @ohmpathorn/block-node-client", {
    x: 0.4, y: 4.0, w: 9.2, h: 0.44,
    fontSize: 13, color: TEXT_DARK, fontFace: "Courier New",
    fill: { color: LIGHT_BG },
  });

  slide.addText("const client = new BlockNodeClient({ endpoint: 's01.test.blk.ams.lat.ope.eng.hashgraph.io' });", {
    x: 0.4, y: 4.55, w: 9.2, h: 0.44,
    fontSize: 11, color: TEXT_DARK, fontFace: "Courier New",
    fill: { color: LIGHT_BG },
  });

  slide.addText("npmjs.com/package/@ohmpathorn/block-node-client", {
    x: 0.4, y: 6.1, w: 9.2, h: 0.32,
    fontSize: 11, color: ACCENT, fontFace: "Calibri", underline: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
prs.writeFile({ fileName: "block-node-sdk-api-reference.pptx" }).then(() => {
  console.log("Created: block-node-sdk-api-reference.pptx");
});
