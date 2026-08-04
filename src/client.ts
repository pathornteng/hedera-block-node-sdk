import * as grpc from "@grpc/grpc-js";
import { ProtoManager } from "./proto-manager";
import { decodeBlockItem } from "./decoder";
import {
  BlockNodeClientOptions,
  ServerStatusResponse,
  ServerStatusDetailResponse,
  BlockRequestSpecifier,
  GetBlockResponse,
  BlockResponseCode,
  BlockStreamOptions,
  BlockStreamCallbacks,
  StreamHandle,
  SubscribeStreamCode,
  BlockItem,
  SemanticVersion,
  BlockRange,
  BlockNodeVersions,
} from "./types";

const UINT64_MAX = "18446744073709551615";

const SUBSCRIBE_CODE_NAMES: Record<number, string> = {
  0: "UNKNOWN", 1: "SUCCESS", 2: "INVALID_REQUEST", 3: "ERROR",
  4: "INVALID_START_BLOCK_NUMBER", 5: "INVALID_END_BLOCK_NUMBER", 6: "NOT_AVAILABLE",
};

const BLOCK_CODE_NAMES: Record<string, string> = {
  "0": "UNKNOWN", "1": "SUCCESS", "2": "INVALID_REQUEST",
  "3": "ERROR", "4": "NOT_FOUND", "5": "NOT_AVAILABLE",
};

/**
 * BlockNodeClient — the main entry point for the Hedera Block Node SDK.
 *
 * @example
 * ```ts
 * import { BlockNodeClient } from "@ohmpathorn/block-node-client";
 *
 * const client = new BlockNodeClient({
 *   endpoint: "s01.test.blk.ams.lat.ope.eng.hashgraph.io:40840",
 * });
 *
 * const status = await client.serverStatus();
 * console.log(status.lastAvailableBlock);
 *
 * client.close();
 * ```
 */
export class BlockNodeClient {
  private proto: ProtoManager;
  private timeout: number;

  constructor(private readonly options: BlockNodeClientOptions) {
    this.proto = new ProtoManager(
      options.endpoint,
      options.tls ?? "tls",
    );
    this.timeout = options.timeout ?? 10_000;
  }

  // ── 1. serverStatus ──────────────────────────────────────────────────────────

  /**
   * Lightweight health check.
   * Returns the first/last available block and whether the node is running.
   * Always call this before subscribing to validate the block range.
   */
  serverStatus(): Promise<ServerStatusResponse> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.timeout);
      (this.proto.nodeClient as any).serverStatus(
        {},
        { deadline },
        (err: grpc.ServiceError | null, res: any) => {
          if (err) return reject(err);
          resolve({
            firstAvailableBlock: BigInt(res.first_available_block ?? "0"),
            lastAvailableBlock:  BigInt(res.last_available_block  ?? "0"),
            nextExpectedBlock:   BigInt(res.next_expected_block   ?? "0"),
            onlyLatestState:     Boolean(res.only_latest_state),
          });
        },
      );
    });
  }

  // ── 2. serverStatusDetail ────────────────────────────────────────────────────

  /**
   * Full capability report: versions, available block ranges, TSS data,
   * and the current network address book.
   */
  serverStatusDetail(): Promise<ServerStatusDetailResponse> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.timeout);
      (this.proto.nodeClient as any).serverStatusDetail(
        {},
        { deadline },
        (err: grpc.ServiceError | null, res: any) => {
          if (err) return reject(err);

          const mapRange = (r: any): BlockRange => ({
            rangeStart: BigInt(r.range_start ?? "0"),
            rangeEnd:   BigInt(r.range_end   ?? "0"),
          });

          const mapSemver = (v: any): SemanticVersion | undefined =>
            v ? { major: Number(v.major), minor: Number(v.minor), patch: Number(v.patch) } : undefined;

          let versionInformation: BlockNodeVersions | undefined;
          if (res.version_information) {
            const vi = res.version_information;
            versionInformation = {
              streamProtoVersion: mapSemver(vi.stream_proto_version),
              blockNodeVersion:   mapSemver(vi.block_node_version),
              installedPluginVersions: (vi.installed_plugin_versions ?? []).map((p: any) => ({
                pluginId: p.plugin_id ?? "",
                pluginSoftwareVersion: mapSemver(p.plugin_software_version),
                pluginFeatureNames: p.plugin_feature_names ?? [],
              })),
            };
          }

          resolve({
            versionInformation,
            availableRanges: (res.available_ranges ?? []).map(mapRange),
            storedRanges:    (res.stored_ranges    ?? []).map(mapRange),
          });
        },
      );
    });
  }

  // ── 3. getBlock ──────────────────────────────────────────────────────────────

  /**
   * Fetch a single block by number or retrieve the latest block.
   *
   * @example
   * ```ts
   * const result = await client.getBlock({ blockNumber: 38764703n });
   * const latest = await client.getBlock({ retrieveLatest: true });
   * ```
   */
  getBlock(request: BlockRequestSpecifier): Promise<GetBlockResponse> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.timeout);
      const grpcRequest: any =
        "blockNumber" in request
          ? { block_number: request.blockNumber.toString() }
          : { retrieve_latest: true };

      (this.proto.blockClient as any).getBlock(
        grpcRequest,
        { deadline },
        (err: grpc.ServiceError | null, res: any) => {
          if (err) return reject(err);

          // Status may come back as enum string or number
          const statusRaw = res.status ?? "0";
          const statusNum =
            typeof statusRaw === "string" && isNaN(Number(statusRaw))
              ? Object.values(BlockResponseCode).indexOf(statusRaw)
              : Number(statusRaw);
          const statusName = BLOCK_CODE_NAMES[String(statusNum)] ?? `CODE_${statusNum}`;

          let block: BlockItem[] | undefined;
          if (res.block && res.block.items) {
            block = (res.block.items as Buffer[]).map(raw =>
              decodeBlockItem(Buffer.from(raw)),
            );
          }

          resolve({ status: statusNum as BlockResponseCode, statusName, block });
        },
      );
    });
  }

  // ── 4. subscribeBlockStream ──────────────────────────────────────────────────

  /**
   * Subscribe to a live or historical block stream.
   *
   * The server sends `block_items` batches followed by `end_of_block` for each
   * block. This method accumulates items per block and calls `onBlock` once the
   * block is complete.
   *
   * Passing `endBlockNumber: 0` (or omitting it) subscribes to a live stream.
   *
   * @returns A `StreamHandle` with a `cancel()` method.
   *
   * @example
   * ```ts
   * const status = await client.serverStatus();
   *
   * const handle = client.subscribeBlockStream(
   *   { startBlockNumber: status.lastAvailableBlock - 10n },
   *   {
   *     onStatus: (code, name) => console.log("Stream status:", name),
   *     onBlock:  (num, items) => console.log(`Block ${num}: ${items.length} items`),
   *     onError:  (err)        => console.error("Stream error:", err.message),
   *     onEnd:    ()           => console.log("Stream ended"),
   *   },
   * );
   *
   * // Cancel after 30 seconds
   * setTimeout(() => handle.cancel(), 30_000);
   * ```
   */
  subscribeBlockStream(
    options: BlockStreamOptions,
    callbacks: BlockStreamCallbacks,
  ): StreamHandle {
    const start = BigInt(options.startBlockNumber);
    const endRaw = options.endBlockNumber ?? 0;
    // Sending 0 causes INVALID_END_BLOCK_NUMBER — convert to uint64_max for live streams
    const end = BigInt(endRaw) === 0n ? UINT64_MAX : BigInt(endRaw).toString();

    const stream = (this.proto.streamClient as any).subscribeBlockStream({
      start_block_number: start.toString(),
      end_block_number:   end,
    });

    let pending: Buffer[] = [];

    stream.on("data", (response: any) => {
      // ── Status (first message) ─────────────────────────────────────────────
      if (response.response === "status") {
        const code = parseInt(response.status, 10);
        const name = SUBSCRIBE_CODE_NAMES[code] ?? `CODE_${code}`;
        callbacks.onStatus?.(code as SubscribeStreamCode, name);
        return;
      }

      // ── BlockItemSet (one or more items per message) ───────────────────────
      if (response.response === "block_items") {
        const rawItems: Buffer[] = response.block_items?.block_items ?? [];
        rawItems.forEach(raw => pending.push(Buffer.from(raw)));
        return;
      }

      // ── end_of_block (block complete) ──────────────────────────────────────
      if (response.response === "end_of_block") {
        const blockNumber = BigInt(response.end_of_block?.block_number ?? "0");
        const items = pending.map(raw => decodeBlockItem(raw));
        pending = [];
        callbacks.onBlock?.(blockNumber, items);
        return;
      }
    });

    stream.on("error", (err: grpc.ServiceError) => {
      if (err.code === grpc.status.CANCELLED) {
        callbacks.onEnd?.();
        return;
      }
      callbacks.onError?.(err);
    });

    stream.on("end", () => {
      callbacks.onEnd?.();
    });

    return {
      cancel: () => stream.cancel(),
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Release gRPC resources and clean up temp proto files.
   * Call when you're done with the client.
   */
  close(): void {
    this.proto.cleanup();
  }
}
