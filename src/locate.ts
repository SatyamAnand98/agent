import fs from "fs/promises";
import { QdrantClient } from "@qdrant/js-client-rest";
import http from "http";

type Retrieved = {
    path: string;
    start: number;
    end: number;
    preview: string;
    score?: number;
};

const cfg = JSON.parse(await fs.readFile("agent.config.json", "utf8"));

async function embed(model: string, text: string): Promise<number[]> {
    const bodies = [
        { model, prompt: text },
        { model, input: text },
    ];
    for (const b of bodies) {
        const body = JSON.stringify(b);
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
                    res.on("data", (c) => (d += c));
                    res.on("end", () => resolve(d));
                });
                req.on("error", reject);
                req.write(body);
                req.end();
            });
            const parsed = JSON.parse(resp);
            const vec = parsed?.embedding as number[] | undefined;
            if (Array.isArray(vec) && vec.length) return vec;
        } catch {
            /* try next */
        }
    }
    throw new Error("Embeddings failed. Is Ollama running and model pulled?");
}

async function searchOnce(
    qdrant: QdrantClient,
    query: string
): Promise<Retrieved[]> {
    const vec = await embed(cfg.embedModel, query.slice(0, 4000));
    const res = await qdrant.search(cfg.collection, {
        vector: vec,
        limit: 20,
        with_payload: true,
        with_vectors: false,
    });
    return (res ?? []).map((p) => ({
        path: (p.payload as any).path,
        start: (p.payload as any).start,
        end: (p.payload as any).end,
        preview: (p.payload as any).preview,
        score: (p as any).score,
    }));
}

async function main() {
    const qdrant = new QdrantClient({ url: "http://127.0.0.1:6333" });
    const terms = [
        "cache",
        "caching",
        "ttl",
        "expiration",
        "expires",
        "max-age",
        "redis",
        "ioredis",
        "memcached",
        "lru",
        "memoize",
        "memoization",
        "etag",
        "cache-control",
        "revalidate",
        "swr",
        "staleWhileRevalidate",
        "store",
        "in-memory cache",
    ];

    const hits = new Map<string, { count: number; samples: Retrieved[] }>();

    for (const t of terms) {
        const results = await searchOnce(
            qdrant,
            `Find caching usage related to: ${t}`
        );
        for (const r of results) {
            const key = `${r.path}`;
            const arr = hits.get(key) ?? { count: 0, samples: [] };
            arr.count += 1;
            if (arr.samples.length < 3) arr.samples.push(r);
            hits.set(key, arr);
        }
    }

    const ranked = [...hits.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 40);

    if (!ranked.length) {
        console.log(
            "No likely caching files found. Consider re-indexing or expanding include globs."
        );
        return;
    }

    console.log("\nLikely caching-related files:");
    for (const [file, info] of ranked) {
        console.log(`- ${file}  (signals: ${info.count})`);
        for (const s of info.samples) {
            console.log(
                `    [L${s.start}-${s.end}] ${(s.preview || "")
                    .split("\n")[0]
                    ?.slice(0, 160)}`
            );
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
