import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

// Fixed per-service ports on the block node host.
const SUBSCRIBER_PORT = 40980;   // gRPC — block subscribers
const BLOCK_ACCESS_PORT = 40981; // gRPC/HTTP — block query API
const SERVER_STATUS_PORT = 40982; // gRPC (HTTP endpoint not yet implemented by this SDK)

/**
 * Manages inline proto definitions and loaded gRPC clients.
 * Protos are written to a temp directory at construction and cleaned up on close().
 */
export class ProtoManager {
  private protoDir: string;
  private readonly serverStatusEndpoint: string;
  private readonly blockAccessEndpoint: string;
  private readonly subscriberEndpoint: string;
  private _nodeClient: grpc.Client | null = null;
  private _blockClient: grpc.Client | null = null;
  private _streamClient: grpc.Client | null = null;

  constructor(private readonly endpoint: string, private readonly tls: "tls" | "insecure") {
    this.serverStatusEndpoint = `${endpoint}:${SERVER_STATUS_PORT}`;
    this.blockAccessEndpoint = `${endpoint}:${BLOCK_ACCESS_PORT}`;
    this.subscriberEndpoint = `${endpoint}:${SUBSCRIBER_PORT}`;
    this.protoDir = fs.mkdtempSync(path.join(os.tmpdir(), "bnproto-"));
    this.writeProtos();
    this.loadClients();
  }

  get nodeClient(): grpc.Client {
    return this._nodeClient!;
  }
  get blockClient(): grpc.Client {
    return this._blockClient!;
  }
  get streamClient(): grpc.Client {
    return this._streamClient!;
  }

  cleanup(): void {
    try {
      fs.rmSync(this.protoDir, { recursive: true, force: true });
    } catch (_) {}
  }

  private write(rel: string, content: string): void {
    const full = path.join(this.protoDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  private writeProtos(): void {
    // ── Shared stubs ────────────────────────────────────────────────────────
    this.write("services/basic_types.proto", `
syntax = "proto3"; package proto;
message Timestamp       { int64 seconds = 1; int32 nanos = 2; }
message AccountID       { uint64 shardNum = 1; uint64 realmNum = 2; oneof account { uint64 accountNum = 3; bytes alias = 4; } }
message SemanticVersion { uint32 major = 1; uint32 minor = 2; uint32 patch = 3; }
message TransferList    { repeated AccountAmount accountAmounts = 1; }
message AccountAmount   { proto.AccountID accountID = 1; int64 amount = 2; bool is_approval = 3; }
message NodeAddressBook { repeated NodeAddress nodeAddress = 1; }
message NodeAddress     { bytes RSA_PubKey = 1; int64 nodeId = 2; }
`);

    // ── BlockItemSet (repeated bytes so inner decoding is handled manually) ──
    this.write("block-node/api/shared_message_types.proto", `
syntax = "proto3"; package org.hiero.block.api;
message BlockItemSet { repeated bytes block_items = 1; }
message BlockEnd     { uint64 block_number = 1; }
`);

    // ── Block (for getBlock response) — repeated bytes inner items ───────────
    this.write("block/stream/block.proto", `
syntax = "proto3"; package com.hedera.hapi.block.stream;
message Block { repeated bytes items = 1; }
`);

    // ── NodeService ──────────────────────────────────────────────────────────
    this.write("block-node/api/node_service.proto", `
syntax = "proto3"; package org.hiero.block.api;
import "services/basic_types.proto";

message ServerStatusRequest {}
message ServerStatusResponse {
  uint64 first_available_block  = 1;
  uint64 last_available_block   = 2;
  bool   only_latest_state      = 3;
  uint64 next_expected_block    = 4;
}
message BlockRange { uint64 range_start = 1; uint64 range_end = 2; }
message PluginVersion {
  string plugin_id = 1;
  proto.SemanticVersion plugin_software_version = 2;
  repeated string plugin_feature_names = 3;
}
message BlockNodeVersions {
  proto.SemanticVersion stream_proto_version = 1;
  proto.SemanticVersion block_node_version   = 2;
  repeated PluginVersion installed_plugin_versions = 3;
}
message ServerStatusDetailResponse {
  BlockNodeVersions      version_information  = 1;
  repeated BlockRange    available_ranges     = 2;
  bytes                  tss_data             = 3;
  proto.NodeAddressBook  node_address_book    = 4;
  repeated BlockRange    stored_ranges        = 5;
}
service BlockNodeService {
  rpc serverStatus       (ServerStatusRequest) returns (ServerStatusResponse);
  rpc serverStatusDetail (ServerStatusRequest) returns (ServerStatusDetailResponse);
}
`);

    // ── BlockAccessService ───────────────────────────────────────────────────
    this.write("block-node/api/block_access_service.proto", `
syntax = "proto3"; package org.hiero.block.api;
import "block/stream/block.proto";
message BlockRequest {
  oneof block_specifier {
    uint64 block_number    = 1;
    bool   retrieve_latest = 2;
  }
}
message BlockResponse {
  enum Code {
    UNKNOWN = 0; SUCCESS = 1; INVALID_REQUEST = 2;
    ERROR = 3; NOT_FOUND = 4; NOT_AVAILABLE = 5;
  }
  Code   status = 1;
  com.hedera.hapi.block.stream.Block block = 2;
}
service BlockAccessService {
  rpc getBlock (BlockRequest) returns (BlockResponse);
}
`);

    // ── BlockStreamSubscribeService ──────────────────────────────────────────
    this.write("block-node/api/block_stream_subscribe_service.proto", `
syntax = "proto3"; package org.hiero.block.api;
import "block-node/api/shared_message_types.proto";
message SubscribeStreamRequest {
  uint64 start_block_number = 1;
  uint64 end_block_number   = 2;
}
message SubscribeStreamResponse {
  enum Code {
    UNKNOWN = 0; SUCCESS = 1; INVALID_REQUEST = 2; ERROR = 3;
    INVALID_START_BLOCK_NUMBER = 4; INVALID_END_BLOCK_NUMBER = 5; NOT_AVAILABLE = 6;
  }
  oneof response {
    Code                              status      = 1;
    org.hiero.block.api.BlockItemSet  block_items = 2;
    org.hiero.block.api.BlockEnd      end_of_block = 3;
  }
}
service BlockStreamSubscribeService {
  rpc subscribeBlockStream (SubscribeStreamRequest) returns (stream SubscribeStreamResponse);
}
`);
  }

  private loadClients(): void {
    const opts: protoLoader.Options = {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [this.protoDir],
    };

    const creds = this.tls === "insecure"
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl(null, null, null, {
          checkServerIdentity: () => undefined,
        });

    const nodeDef    = protoLoader.loadSync(path.join(this.protoDir, "block-node/api/node_service.proto"), opts);
    const blockDef   = protoLoader.loadSync(path.join(this.protoDir, "block-node/api/block_access_service.proto"), opts);
    const streamDef  = protoLoader.loadSync(path.join(this.protoDir, "block-node/api/block_stream_subscribe_service.proto"), opts);

    const nodePkg   = (grpc.loadPackageDefinition(nodeDef)   as any)["org"]["hiero"]["block"]["api"];
    const blockPkg  = (grpc.loadPackageDefinition(blockDef)  as any)["org"]["hiero"]["block"]["api"];
    const streamPkg = (grpc.loadPackageDefinition(streamDef) as any)["org"]["hiero"]["block"]["api"];

    this._nodeClient   = new nodePkg.BlockNodeService(this.serverStatusEndpoint, creds);
    this._blockClient  = new blockPkg.BlockAccessService(this.blockAccessEndpoint, creds);
    this._streamClient = new streamPkg.BlockStreamSubscribeService(this.subscriberEndpoint, creds);
  }
}
