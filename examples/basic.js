/**
 * Example 1 — Basic usage
 *
 * Demonstrates all four APIs: serverStatus, serverStatusDetail, getBlock,
 * and subscribeBlockStream.
 *
 * Run: node examples/basic.js
 */

const { BlockNodeClient } = require("../dist/client");

const ENDPOINT = process.env.ENDPOINT
  || "s01.test.blk.ams.lat.ope.eng.hashgraph.io";

async function main() {
  const client = new BlockNodeClient({
    endpoint: ENDPOINT,
    tls: process.env.USE_INSECURE === "1" ? "insecure" : "tls",
    timeout: 10_000,
  });

  try {
    // ── 1. serverStatus ──────────────────────────────────────────────────────
    console.log("\n── 1. serverStatus ──────────────────────────────────────");
    const status = await client.serverStatus();
    console.log(status);
    console.log("First available block :", status.firstAvailableBlock.toString());
    console.log("Last available block  :", status.lastAvailableBlock.toString());
    console.log("Next expected block   :", status.nextExpectedBlock.toString());
    console.log("Only latest state     :", status.onlyLatestState);

    // ── 2. serverStatusDetail ────────────────────────────────────────────────
    console.log("\n── 2. serverStatusDetail ───────────────────────────────");
    const detail = await client.serverStatusDetail();
    if (detail.versionInformation?.blockNodeVersion) {
      const v = detail.versionInformation.blockNodeVersion;
      console.log(`Block node version    : ${v.major}.${v.minor}.${v.patch}`);
    }
    console.log(`Available ranges      : ${detail.availableRanges.length} range(s)`);
    detail.availableRanges.slice(0, 3).forEach((r, i) =>
      console.log(`  [${i}] ${r.rangeStart} → ${r.rangeEnd}`)
    );

    // ── 3. getBlock ──────────────────────────────────────────────────────────
    console.log("\n── 3. getBlock ─────────────────────────────────────────");
    const blockNum = status.firstAvailableBlock + 5n;
    const blockResult = await client.getBlock({ blockNumber: blockNum });
    console.log("Status                :", blockResult.statusName);
    if (blockResult.block) {
      console.log("Total items           :", blockResult.block.length);
      // Summarise item kinds
      const kinds = {};
      blockResult.block.forEach(item => {
        kinds[item.kind] = (kinds[item.kind] || 0) + 1;
      });
      console.log("Item breakdown        :", Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join("  "));
      // Show first few transactions from record_file or event_transaction items
      for (const item of blockResult.block) {
        if (item.kind === "record_file") {
          const txs = item.payload.transactions ?? [];
          console.log(`  record_file: ${txs.length} transactions`);
          txs.slice(0, 3).forEach(tx =>
            console.log(`    tx: ${(tx.type ?? "UNKNOWN").padEnd(28)} id=${tx.transactionId?.toString() ?? "n/a"}`)
          );
          if (txs.length > 3) console.log(`    ... and ${txs.length - 3} more`);
        } else if (item.kind === "event_transaction" && item.payload.type) {
          const tx = item.payload;
          console.log(`  event_transaction: ${tx.type}  id=${tx.transactionId?.toString() ?? "n/a"}`);
        }
      }
    }

    // ── 4. subscribeBlockStream ──────────────────────────────────────────────
    console.log("\n── 4. subscribeBlockStream (first 3 blocks then cancel) ─");
    const startBlock = status.lastAvailableBlock - 20n;
    let blockCount = 0;

    await new Promise((resolve) => {
      const handle = client.subscribeBlockStream(
        { startBlockNumber: startBlock },
        {
          onStatus: (code, name) => console.log(`Stream status         : ${name} (${code})`),
          onBlock: (num, items) => {
            blockCount++;
            // Count transactions
            const txs = items.filter(i =>
              i.kind === "event_transaction" ||
              (i.kind === "record_file" && i.payload.transactions?.length > 0)
            );
            const txCount = txs.reduce((sum, i) =>
              sum + (i.kind === "record_file" ? i.payload.transactions.length : 1), 0);

            console.log(`Block ${num}  items=${items.length}  transactions=${txCount}`);

            // Print first few transactions (from event_transaction or record_file)
            const allTxs = [];
            items.forEach(item => {
              if (item.kind === "event_transaction" && item.payload.type) {
                allTxs.push({ type: item.payload.type, id: item.payload.transactionId?.toString() ?? "n/a" });
              } else if (item.kind === "record_file") {
                (item.payload.transactions ?? []).forEach(tx =>
                  allTxs.push({ type: tx.type ?? "UNKNOWN", id: tx.transactionId?.toString() ?? "n/a" })
                );
              }
            });
            allTxs.slice(0, 3).forEach(tx =>
              console.log(`  tx: ${(tx.type).padEnd(28)} id=${tx.id}`)
            );
            if (allTxs.length > 3) console.log(`  ... and ${allTxs.length - 3} more`);

            if (blockCount >= 3) {
              handle.cancel();
              resolve();
            }
          },
          onError: (err) => { console.error("Stream error:", err.message); resolve(); },
          onEnd: () => resolve(),
        },
      );
    });

  } finally {
    client.close();
  }
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
