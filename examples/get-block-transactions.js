/**
 * Example — getBlockTransactions
 *
 * Fetches all fully-decoded transactions from a single block, printing
 * every field: transaction ID, type, body fields, all signatures,
 * receipt, HBAR transfers, token transfers, and assessed custom fees.
 *
 * Run:
 *   node examples/get-block-transactions.js
 *   BLOCK=38764703 node examples/get-block-transactions.js
 *   ENDPOINT=s01.test.blk.sgp.lat.ope.eng.hashgraph.io:40840 node examples/get-block-transactions.js
 */

const { BlockNodeClient } = require("../dist/client");

const ENDPOINT = process.env.ENDPOINT
  || "s01.test.blk.ams.lat.ope.eng.hashgraph.io:40840";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtAccountId(a) {
  if (!a) return "n/a";
  return `${a.shardNum}.${a.realmNum}.${a.accountNum}`;
}

function fmtEntityId(e) {
  if (!e) return "n/a";
  return `${e.shardNum}.${e.realmNum}.${e.entityNum}`;
}

function fmtTokenId(t) {
  if (!t) return "n/a";
  return `${t.shardNum}.${t.realmNum}.${t.tokenNum}`;
}

function fmtTinybars(v) {
  if (v === undefined || v === null) return "n/a";
  return `${v.toLocaleString()} tℏ  (${(Number(v) / 1e8).toFixed(8)} HBAR)`;
}

function hex(buf, maxBytes = 32) {
  if (!buf || !buf.length) return "(empty)";
  const h = buf.toString("hex");
  return h.length > maxBytes * 2 ? h.slice(0, maxBytes * 2) + "…" : h;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const client = new BlockNodeClient({
    endpoint: ENDPOINT,
    tls: process.env.USE_INSECURE === "1" ? "insecure" : "tls",
    timeout: 15_000,
  });

  try {
    // Resolve which block to fetch
    const status = await client.serverStatus();
    const blockNum = process.env.BLOCK
      ? BigInt(process.env.BLOCK)
      : status.firstAvailableBlock + 5n;

    console.log(`\nEndpoint : ${ENDPOINT}`);
    console.log(`Block    : ${blockNum}`);
    console.log("─".repeat(60));

    const txs = await client.getBlockTransactions({ blockNumber: blockNum });

    console.log(`Transactions in block: ${txs.length}\n`);

    txs.forEach((tx, idx) => {
      console.log(`${"═".repeat(60)}`);
      console.log(`  Transaction ${idx + 1} of ${txs.length}`);
      console.log(`${"═".repeat(60)}`);

      // ── Identity ──────────────────────────────────────────────
      console.log("\n  ── Identity ──────────────────────────────────────────");
      console.log(`  id           : ${tx.transactionId?.toString() ?? "n/a"}`);
      console.log(`  type         : ${tx.type ?? "n/a"}`);
      console.log(`  memo         : ${tx.memo || "(none)"}`);

      // ── Body ──────────────────────────────────────────────────
      console.log("\n  ── Body ──────────────────────────────────────────────");
      console.log(`  nodeAccountId        : ${fmtAccountId(tx.nodeAccountId)}`);
      console.log(`  maxTransactionFee    : ${fmtTinybars(tx.maxTransactionFee)}`);
      console.log(`  validDuration        : ${tx.transactionValidDuration ?? "n/a"} s`);

      // ── Signatures ────────────────────────────────────────────
      console.log(`\n  ── Signatures (${tx.signatures.length}) ──────────────────────────────`);
      if (tx.signatures.length === 0) {
        console.log("  (none)");
      } else {
        tx.signatures.forEach((s, i) => {
          console.log(`  [${i}] type       : ${s.type}`);
          console.log(`      pubKeyPrefix : ${s.pubKeyPrefix}`);
          console.log(`      signature    : ${s.signature.slice(0, 64)}…`);
        });
      }

      // ── Receipt ───────────────────────────────────────────────
      if (tx.receipt) {
        console.log("\n  ── Receipt ───────────────────────────────────────────");
        console.log(`  status         : ${tx.receipt.statusName} (${tx.receipt.status})`);
        if (tx.receipt.accountId)  console.log(`  accountId      : ${fmtAccountId(tx.receipt.accountId)}`);
        if (tx.receipt.fileId)     console.log(`  fileId         : ${fmtEntityId(tx.receipt.fileId)}`);
        if (tx.receipt.contractId) console.log(`  contractId     : ${fmtEntityId(tx.receipt.contractId)}`);
        if (tx.receipt.topicId)    console.log(`  topicId        : ${fmtEntityId(tx.receipt.topicId)}`);
        if (tx.receipt.tokenId)    console.log(`  tokenId        : ${fmtTokenId(tx.receipt.tokenId)}`);
        if (tx.receipt.scheduleId) console.log(`  scheduleId     : ${fmtEntityId(tx.receipt.scheduleId)}`);
        if (tx.receipt.nodeId !== undefined) console.log(`  nodeId         : ${tx.receipt.nodeId}`);
        if (tx.receipt.topicSequenceNumber !== undefined) {
          console.log(`  topicSeqNum    : ${tx.receipt.topicSequenceNumber}`);
        }
        if (tx.receipt.serialNumbers?.length) {
          console.log(`  serialNumbers  : [${tx.receipt.serialNumbers.join(", ")}]`);
        }
        if (tx.receipt.exchangeRate?.currentRate) {
          const r = tx.receipt.exchangeRate.currentRate;
          console.log(`  exchangeRate   : ${r.hbarEquivalent} HBAR = ${r.centEquivalent} cents`);
        }
      }

      // ── Record ────────────────────────────────────────────────
      console.log("\n  ── Record ────────────────────────────────────────────");
      if (tx.consensusTimestamp) {
        console.log(`  consensusTime  : ${tx.consensusTimestamp.toDate().toISOString()}`);
      }
      console.log(`  transactionFee : ${fmtTinybars(tx.transactionFee)}`);
      console.log(`  txHash         : ${hex(tx.transactionHash, 48)}`);

      // ── HBAR Transfers ────────────────────────────────────────
      if (tx.transfers.length > 0) {
        console.log(`\n  ── HBAR Transfers (${tx.transfers.length}) ─────────────────────────`);
        tx.transfers.forEach(t => {
          const sign = t.amount >= 0n ? "+" : "";
          console.log(`  ${fmtAccountId(t.accountId).padEnd(20)} ${sign}${fmtTinybars(t.amount)}`);
        });
      }

      // ── Token Transfers ───────────────────────────────────────
      if (tx.tokenTransfers.length > 0) {
        console.log(`\n  ── Token Transfers (${tx.tokenTransfers.length} token(s)) ──────────────`);
        tx.tokenTransfers.forEach(ttl => {
          console.log(`  Token: ${fmtTokenId(ttl.tokenId)}`);
          ttl.transfers.forEach(t => {
            const sign = t.amount >= 0n ? "+" : "";
            console.log(`    ${fmtAccountId(t.accountId).padEnd(20)} ${sign}${t.amount}${t.isApproval ? " (approval)" : ""}`);
          });
          ttl.nftTransfers.forEach(n => {
            console.log(`    NFT #${n.serialNumber}: ${fmtAccountId(n.senderAccountId)} → ${fmtAccountId(n.receiverAccountId)}${n.isApproval ? " (approval)" : ""}`);
          });
        });
      }

      // ── Assessed Custom Fees ──────────────────────────────────
      if (tx.assessedCustomFees.length > 0) {
        console.log(`\n  ── Assessed Custom Fees (${tx.assessedCustomFees.length}) ────────────────`);
        tx.assessedCustomFees.forEach(f => {
          const token = f.tokenId ? `token ${fmtTokenId(f.tokenId)}` : "HBAR";
          console.log(`  ${fmtTinybars(f.amount)} ${token} → collector ${fmtAccountId(f.feeCollectorAccountId)}`);
        });
      }

      // ── Raw Bytes ─────────────────────────────────────────────
      console.log("\n  ── Raw ───────────────────────────────────────────────");
      console.log(`  rawTransaction : ${tx.rawTransaction.length} bytes`);
      if (tx.rawRecord) {
        console.log(`  rawRecord      : ${tx.rawRecord.length} bytes`);
      }

      console.log();
    });

  } finally {
    client.close();
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
