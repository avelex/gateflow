// Test doubles: an in-memory DB, a recording fake NEAR client and a scripted 1Click client.
import { openDb } from "./db.ts";
import type { Action, Near, TxResult } from "./near.ts";
import { type ChatMessage, type Completion, type Config, type Deps, type Llm, loadConfig, type OneClick, type OriginApi, type OutLayerApi, type Req, type ToolDef } from "./types.ts";

export const cfg = (over: Partial<Config> = {}): Config => ({
  ...loadConfig({ GATEFLOW_CONTRACT: "gateflow.testnet", RELAY_ACCOUNT_ID: "op.testnet", WEB_DIST: "/nonexistent" }),
  ...over,
});

export type Sent = { receiver: string; actions: Action[]; executor: string };

export type FakeNear = Near & {
  sent: Sent[];
  views: { contract: string; method: string; args: any }[];
  /// `contract.method` -> value or function of args.
  viewTable: Record<string, unknown>;
  /// Returns the result for each send, in order; default `{hash: "h<n>"}`.
  sendResults: ((s: Sent) => TxResult | undefined)[];
  existing: Set<string>;
  keys: Record<string, bigint>;
  /// `hash` -> tx status result; missing means unknown.
  txTable: Record<string, any>;
  txCalls: { hash: string; sender: string }[];
  /// Block hash -> timestamp in seconds; missing throws like an RPC error.
  blocks: Record<string, number>;
};

export function fakeNear(): FakeNear {
  const n: FakeNear = {
    sent: [],
    views: [],
    viewTable: {},
    sendResults: [],
    existing: new Set(),
    keys: {},
    txTable: {},
    txCalls: [],
    blocks: {},
    async view(contract, method, args) {
      n.views.push({ contract, method, args });
      const v = n.viewTable[`${contract}.${method}`];
      if (v === undefined) throw new Error(`no fake view ${contract}.${method}`);
      return typeof v === "function" ? v(args) : structuredClone(v);
    },
    async send(receiver, actions, executor = receiver) {
      const s = { receiver, actions, executor };
      n.sent.push(s);
      const custom = n.sendResults.shift()?.(s);
      return custom ?? { hash: `h${n.sent.length}` };
    },
    async accountExists(id) {
      return n.existing.has(id);
    },
    async accessKey(account, publicKey) {
      const nonce = n.keys[`${account}/${publicKey}`];
      return nonce === undefined ? undefined : { nonce };
    },
    async head() {
      return { height: 1000n, hash: new Uint8Array(32) };
    },
    async block(hash) {
      const t = n.blocks[hash];
      if (t === undefined) throw new Error(`no fake block ${hash}`);
      return { timestampSec: t };
    },
    async tx(hash, sender) {
      n.txCalls.push({ hash, sender });
      const t = n.txTable[hash];
      return t === undefined ? undefined : structuredClone(t);
    },
  };
  return n;
}

export type FakeOneClick = OneClick & { tokenList: any[]; quotes: any[]; statuses: Record<string, any>; quoteReply?: any; calls: string[] };

export function fakeOneClick(): FakeOneClick {
  const o: FakeOneClick = {
    tokenList: [],
    quotes: [],
    statuses: {},
    calls: [],
    async tokens() {
      o.calls.push("tokens");
      return o.tokenList;
    },
    async quote(body) {
      o.calls.push("quote");
      o.quotes.push(body);
      if (o.quoteReply instanceof Error) throw o.quoteReply;
      return o.quoteReply;
    },
    async status(addr) {
      o.calls.push(`status ${addr}`);
      const s = o.statuses[addr];
      if (s instanceof Error) throw s;
      if (s === undefined) throw new Error(`no fake status for ${addr}`);
      return s;
    },
  };
  return o;
}

export type FakeOutLayer = OutLayerApi & { jobList: any[]; calls: { user: string; project: string; limit: number; offset: number }[]; fail?: Error };

export function fakeOutLayer(): FakeOutLayer {
  const o: FakeOutLayer = {
    jobList: [],
    calls: [],
    async jobs(q) {
      o.calls.push(q);
      if (o.fail) throw o.fail;
      return structuredClone(o.jobList.slice(q.offset, q.offset + q.limit));
    },
  };
  return o;
}

export type FakeOrigin = OriginApi & {
  /// `chain:hash` -> senders.
  table: Record<string, string[]>;
  fail?: Error;
  calls: string[];
};

export function fakeOrigin(): FakeOrigin {
  const o: FakeOrigin = {
    table: {},
    calls: [],
    async senders(chain, hash) {
      o.calls.push(`${chain}:${hash}`);
      if (o.fail) throw o.fail;
      return o.table[`${chain}:${hash}`];
    },
  };
  return o;
}

export type FakeLlm = Llm & {
  /// Replies in order; an Error is thrown. When empty, the fake answers "ok".
  replies: (Completion | Error)[];
  calls: { messages: ChatMessage[]; tools: ToolDef[] }[];
};

export function fakeLlm(): FakeLlm {
  const l: FakeLlm = {
    replies: [],
    calls: [],
    async complete(messages, tools) {
      l.calls.push({ messages: structuredClone(messages), tools });
      const r = l.replies.shift() ?? { content: "ok" };
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return l;
}

export type TestDeps = Deps & { near: FakeNear; oneclick: FakeOneClick; outlayer: FakeOutLayer; origin: FakeOrigin; llm: FakeLlm; clock: { ms: number } };

export function fakeDeps(over: Partial<Config> = {}): TestDeps {
  const clock = { ms: Date.UTC(2026, 10, 2, 12) };
  return { cfg: cfg(over), db: openDb(":memory:"), near: fakeNear(), oneclick: fakeOneClick(), outlayer: fakeOutLayer(), origin: fakeOrigin(), llm: fakeLlm(), now: () => clock.ms, clock };
}

export const req = (method: string, path: string, body?: any, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): Req => {
  const url = new URL(path, "http://x");
  return { method, path: url.pathname, query: url.searchParams, body, cookies, headers };
};
