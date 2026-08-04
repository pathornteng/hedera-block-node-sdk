/**
 * Example 3 — Multi-endpoint failover
 *
 * Tries each testnet endpoint in order and returns the first one that responds.
 * Useful for building resilient applications.
 *
 * Run: node examples/multi-endpoint.js
 */

const { BlockNodeClient } = require("../dist/client");

const TESTNET_ENDPOINTS = [
  "s01.test.blk.ams.lat.ope.eng.hashgraph.io:40840",
  "s01.test.blk.sgp.lat.ope.eng.hashgraph.io:40840",
  "s01.test.blk.chi.lat.ope.eng.hashgraph.io:40840",
  "lfh01.testnet.blocknode.hashgraph-devops.com:40840",
];

/**
 * Returns the first healthy endpoint and its status, or throws if all fail.
 */
async function findHealthyEndpoint(tls = "tls", timeoutMs = 5000) {
  for (const endpoint of TESTNET_ENDPOINTS) {
    const client = new BlockNodeClient({ endpoint, tls, timeout: timeoutMs });
    try {
      console.log(`Trying ${endpoint} ...`);
      const status = await client.serverStatus();
      console.log(`  ✓  first=${status.firstAvailableBlock}  last=${status.lastAvailableBlock}`);
      return { endpoint, client, status };
    } catch (err) {
      console.log(`  ✗  ${err.message.split("\n")[0]}`);
      client.close();
    }
  }
  throw new Error("All endpoints failed");
}

async function main() {
  const tls = process.env.USE_INSECURE === "1" ? "insecure" : "tls";
  const { endpoint, client, status } = await findHealthyEndpoint(tls);

  console.log(`\nConnected to: ${endpoint}`);
  console.log(`Block range : ${status.firstAvailableBlock} → ${status.lastAvailableBlock}`);

  // Now fetch a single block from the winning endpoint
  const blockNum = status.lastAvailableBlock - 2n;
  const result = await client.getBlock({ blockNumber: blockNum });
  console.log(`\ngetBlock(${blockNum}): ${result.statusName}  items=${result.block?.length ?? 0}`);

  client.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
