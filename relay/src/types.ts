// Shared types: config, injected dependencies and the handler contract.
import type { Near } from "./near.ts";
import type { Db } from "./db.ts";

export type Config = {
  gateflow: string;
  accountId: string;
  /// Parent of merchant accounts; signs with the relay key.
  merchantParent: string;
  secret?: string;
  rpcUrl: string;
  publicUrl: string;
  port: number;
  dbPath: string;
  webDist: string;
  fuelTarget: bigint;
  executionDeposit: bigint;
  maxMerchants: number;
  oneclickUrl: string;
  oneclickKey?: string;
  evmChains: string[];
  llmBaseUrl: string;
  llmApiKey?: string;
  llmModel: string;
  chatDailyLimit: number;
  outlayerContract: string;
  outlayerProject: string;
  outlayerApi: string;
  /// ed25519 secret of the invoice signer key merchants add to enable the API.
  invoiceSigner?: string;
};

export interface OneClick {
  tokens(): Promise<any[]>;
  quote(body: object): Promise<any>;
  status(depositAddress: string): Promise<any>;
}

/// OutLayer's coordinator API (undocumented): jobs of one tx signer, newest first.
export interface OutLayerApi {
  jobs(q: { user: string; project: string; limit: number; offset: number }): Promise<any[]>;
}

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: unknown[]; tool_call_id?: string };
export type ToolDef = { name: string; description: string; parameters: object };
export type Completion = { content?: string; toolCalls?: { id: string; name: string; arguments: string }[] };

/// An OpenAI-compatible chat completions client.
export interface Llm {
  complete(messages: ChatMessage[], tools: ToolDef[]): Promise<Completion>;
}

/// Reads who sent a deposit on its origin chain.
export interface OriginApi {
  /// The addresses that sent origin tx `hash` on `chain`; undefined when the tx says none. Throws when the read fails.
  senders(chain: string, hash: string): Promise<string[] | undefined>;
}

/// `creator` signs merchant account creation as `cfg.merchantParent`; `near` signs everything else.
export type Deps = { cfg: Config; db: Db; near: Near; creator?: Near; oneclick: OneClick; outlayer: OutLayerApi; origin: OriginApi; llm?: Llm; now(): number };

export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
  cookies: Record<string, string>;
  /// Lower-cased header names.
  headers: Record<string, string>;
};

export type Res = {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
};

export type Handler = (req: Req, deps: Deps) => Promise<Res>;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const ok = (json: unknown, headers?: Record<string, string>): Res => ({ status: 200, json, headers });

export function loadConfig(env: Record<string, string | undefined>): Config {
  if (!env.GATEFLOW_CONTRACT) throw new Error("GATEFLOW_CONTRACT is required");
  const publicUrl = env.PUBLIC_URL ?? "http://localhost:8787";
  const url = new URL(publicUrl);
  return {
    gateflow: env.GATEFLOW_CONTRACT,
    accountId: env.RELAY_ACCOUNT_ID ?? "",
    merchantParent: env.MERCHANT_PARENT || env.RELAY_ACCOUNT_ID || "",
    secret: env.RELAY_PRIVATE_KEY,
    rpcUrl: env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com",
    publicUrl,
    port: Number(env.PORT ?? (url.port || (url.protocol === "https:" ? 443 : 80))),
    dbPath: env.DB_PATH ?? "gateflow.db",
    webDist: env.WEB_DIST ?? "../web/dist",
    fuelTarget: BigInt(env.FUEL_TARGET ?? "100000000000000000000000"),
    executionDeposit: BigInt(env.EXECUTION_DEPOSIT ?? "10000000000000000000000"),
    maxMerchants: Number(env.MAX_MERCHANTS ?? 100),
    oneclickUrl: env.ONECLICK_URL ?? "https://1click.chaindefuser.com",
    oneclickKey: env.ONECLICK_API_KEY || undefined,
    evmChains: (env.EVM_CHAINS ?? "base,eth,arb").split(",").map((s) => s.trim()).filter(Boolean),
    llmBaseUrl: env.LLM_BASE_URL || "https://cloud-api.near.ai/v1",
    llmApiKey: env.LLM_API_KEY || undefined,
    llmModel: env.LLM_MODEL ?? "",
    chatDailyLimit: Number(env.CHAT_DAILY_LIMIT ?? 200),
    outlayerContract: env.OUTLAYER_CONTRACT || "outlayer.near",
    outlayerProject: env.OUTLAYER_PROJECT || "ops.gateflow.near/gateflow",
    outlayerApi: env.OUTLAYER_API || "https://api.outlayer.ai",
    invoiceSigner: env.INVOICE_SIGNER_KEY || undefined,
  };
}
