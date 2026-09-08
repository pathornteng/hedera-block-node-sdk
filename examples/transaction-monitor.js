/**
 * Example 2 — Live Transaction Monitor
 *
 * Subscribes to the live block stream and prints a real-time table of every
 * transaction with its type, payer, and status.
 *
 * Run: node examples/transaction-monitor.js
 * Stop: Ctrl+C
 */

const { BlockNodeClient } = require("../dist/client");

const ENDPOINT = process.env.ENDPOINT
  || "s01.test.blk.ams.lat.ope.eng.hashgraph.io";

async function main() {
  const client = new BlockNodeClient({
    endpoint: ENDPOINT,
    tls: process.env.USE_INSECURE === "1" ? "insecure" : "tls",
  });

  const status = await client.serverStatus();
  const start  = status.lastAvailableBlock - 5n;

  console.log(`\nMonitoring live transactions from block ${start}`);
  console.log("─".repeat(80));
  console.log(
    "BLOCK".padEnd(12),
    "TYPE".padEnd(30),
    "STATUS".padEnd(12),
    "TRANSACTION ID",
  );
  console.log("─".repeat(80));

  let totalTx = 0;
  const typeCounts = {};

  const handle = client.subscribeBlockStream(
    { startBlockNumber: start },
    {
      onStatus: (code, name) => {
        if (code !== 1) console.error(`Stream rejected: ${name} (${code})`);
      },

      onBlock: (blockNum, items) => {
        // Collect all transactions — both native stream and record file wrapped
        const allTxs = [];

        items.forEach(item => {
          if (item.kind === "event_transaction" && item.payload.type) {
            const tx = item.payload;
            // Find matching result for status
            const resultItem = items.find(i => i.kind === "transaction_result");
            allTxs.push({
              type:   tx.type,
              id:     tx.transactionId?.toString() ?? "n/a",
              status: resultItem?.payload?.statusName ?? "—",
            });
          } else if (item.kind === "record_file") {
            for (const tx of item.payload.transactions ?? []) {
              allTxs.push({ type: tx.type ?? "UNKNOWN", id: tx.transactionId?.toString() ?? "n/a", status: "—" });
            }
          }
        });

        if (allTxs.length === 0) return;

        allTxs.forEach(tx => {
          totalTx++;
          typeCounts[tx.type] = (typeCounts[tx.type] || 0) + 1;
          console.log(
            blockNum.toString().padEnd(12),
            (tx.type ?? "UNKNOWN").padEnd(30),
            tx.status.padEnd(12),
            tx.id,
          );
        });
        console.log("─".repeat(80));
      },

      onError: (err) => console.error("Error:", err.message),
      onEnd:   ()    => {
        console.log("\n── Summary ──────────────────────────────────────────────");
        console.log("Total transactions:", totalTx);
        Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .forEach(([type, count]) =>
            console.log(`  ${type.padEnd(32)} ${count}`));
        client.close();
      },
    },
  );

  process.on("SIGINT", () => {
    console.log("\n[stopping...]");
    handle.cancel();
  });
}

main().catch(err => { console.error(err.message); process.exit(1); });
