// src/ask.ts
import fs from "fs/promises";
import http from "http";
import { QdrantClient } from "@qdrant/js-client-rest";

type Cfg = {
  collection: string;
  embedModel: string;
  llmModel: string;
};

const cfg: Cfg = JSON.parse(await fs.readFile("agent.config.json", "utf8"));

// --- Embeddings (robust: tries {prompt} then {input}) ---
async function embed(model: string, text: string): Promise<number[]> {
  for (const bodyObj of [{ model, prompt: text }, { model, input: text }]) {
    const body = JSON.stringify(bodyObj);
    const opts = {
      hostname: "127.0.0.1",
      port: 11434,
      path: "/api/embeddings",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    try {
      const resp = await new Promise<string>((resolve, reject) => {
        const req = http.request(opts, (res) => {
          let d = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(d));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });
      const parsed = JSON.parse(resp);
      const vec = parsed?.embedding as number[] | undefined;
      if (Array.isArray(vec) && vec.length > 0) return vec;
      if (parsed?.error) throw new Error(parsed.error);
    } catch {
      // try next payload shape
    }
  }
  throw new Error("Failed to get embeddings from Ollama. Is ollama running? Is the model pulled?");
}

// --- LLM chat (no streaming, local) ---
async function chat(model: string, content: string): Promise<string> {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: "Answer only from the provided context. Be concise and structured. If unsure, say what’s missing." },
      { role: "user", content }
    ],
    stream: false,
  });
  const opts = {
    hostname: "127.0.0.1",
    port: 11434,
    path: "/api/chat",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };
  const resp = await new Promise<string>((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
  const parsed = JSON.parse(resp);
  return parsed?.message?.content ?? "";
}

type Retrieved = { path: string; start: number; end: number; preview: string; score?: number };

async function retrieveTopK(collection: string, embedModel: string, query: string, k = 8): Promise<Retrieved[]> {
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL ?? "http://127.0.0.1:6333" });
  const vec = await embed(embedModel, query.length > 5000 ? query.slice(0, 5000) : query);
  const res = await qdrant.search(collection, { vector: vec, limit: k, with_payload: true, with_vectors: false });
  return (res ?? []).map((p: any) => ({
    path: p.payload?.path,
    start: p.payload?.start,
    end: p.payload?.end,
    preview: p.payload?.preview,
    score: p.score
  }));
}

async function readQueryFromPromptTxt(): Promise<string> {
  try {
    const txt = await fs.readFile("prompt.txt", "utf8");
    // naive: prefer `prompt:` block if present; otherwise whole file
    const m = txt.match(/prompt:\s*>\s*([\s\S]*)$/);
    return (m?.[1]?.trim() || txt.trim()).slice(0, 8000);
  } catch {
    return "";
  }
}

async function main() {
  const arg = process.argv.slice(2).join(" ").trim();
  const query = arg || (await readQueryFromPromptTxt());
  if (!query) {
    console.error("No query provided. Pass it as an argument or put it under `prompt:` in prompt.txt");
    process.exit(1);
  }

  console.log("\nQuery:");
  console.log(query);

  // Retrieve
  const hits = await retrieveTopK(cfg.collection, cfg.embedModel, query, 10);

  if (!hits.length) {
    console.log("\nNo results from vector search. Try re-indexing or broadening the query.");
    process.exit(0);
  }

  // Show top hits (paths + first lines)
  console.log("\nTop matches:");
  for (const h of hits) {
    const firstLine = (h.preview || "").split("\n")[0]?.slice(0, 160);
    console.log(`- ${h.path} [L${h.start}-${h.end}]  (score: ${h.score?.toFixed(3) ?? "n/a"})`);
    if (firstLine) console.log(`    ${firstLine}`);
  }

  // Synthesize answer from context
  const context = hits.map(h => `FILE: ${h.path} [L${h.start}-${h.end}]\n${h.preview}`).join("\n\n----\n\n");
  const llmPrompt = `User question:\n${query}\n\nContext (use ONLY this):\n${context}\n\nAnswer with:\n- A concise explanation\n- If listing items (e.g., webhooks), use a short bullet list\n- Include file paths and line ranges when referencing code\n- If something is missing in the repo, say it plainly.`;

  const answer = await chat(cfg.llmModel, llmPrompt);

  console.log("\n--- Answer ---\n");
  console.log(answer.trim());
  console.log("\n--------------\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
