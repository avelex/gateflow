// The console assistant: model client, tools and the bounded tool loop (design decisions 2 to 9).
import type { Completion, Config, Llm } from "./types.ts";

/// OpenAI-compatible `/chat/completions` client over plain fetch. Tool schemas carry no `strict` flag.
export function llmClient(cfg: Pick<Config, "llmBaseUrl" | "llmApiKey" | "llmModel">): Llm {
  return {
    async complete(messages, tools) {
      const res = await fetch(`${cfg.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llmApiKey}` },
        body: JSON.stringify({ model: cfg.llmModel, messages, tools: tools.map((t) => ({ type: "function", function: t })) }),
      });
      if (!res.ok) throw new Error(`model endpoint ${res.status}`);
      const msg = (await res.json())?.choices?.[0]?.message;
      if (!msg) throw new Error("model returned no message");
      const out: Completion = { content: msg.content ?? undefined };
      if (msg.tool_calls?.length) {
        out.toolCalls = msg.tool_calls.map((c: any) => ({ id: String(c.id), name: String(c.function?.name), arguments: String(c.function?.arguments ?? "") }));
      }
      return out;
    },
  };
}
