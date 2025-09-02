// src/indexer.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import http, { IncomingMessage } from "node:http";
import fg from "fast-glob";
import { QdrantClient } from "@qdrant/js-client-rest";

type Cfg = {
    codebasePath: string;
    collection: string;
    embedModel: string;
    include: string[];
    exclude: string[];
    maxFileBytes: number;
    chunk: { lines: number; overlap: number };
};

type AnyCfg = Partial<Cfg> & { exlude?: unknown };

const QDRANT_URL = process.env.QDRANT_URL ?? "http://127.0.0.1:6333";
const DISTANCE: "Cosine" | "Dot" | "Euclid" = "Cosine";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 64);

const toPosix = (p: string) => p.replaceAll("\\", "/");
const normalizePattern = (p: string) => {
    const s = toPosix(p.trim());
    if (s && !s.includes("*") && !s.includes("?") && !s.includes("/")) {
        return `**/${s}/**`;
    }
    return s;
};

function hasPathSegment(p: string, seg: string) {
    const parts = p.split(path.sep).filter(Boolean);
    return parts.includes(seg);
}

async function readConfig(): Promise<Cfg> {
    const rawJSON = await fs.readFile("agent.config.json", "utf8");
    const raw = JSON.parse(rawJSON) as AnyCfg;

    // merge excludes with defaults + typo rescue
    const userExclude = Array.isArray(raw.exclude)
        ? raw.exclude
        : Array.isArray(raw.exlude)
        ? (raw.exlude as string[])
        : [];

    const defaultExclude = [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/.turbo/**",
        "**/coverage/**",
        "**/.cache/**",
    ];

    const mergedIgnores = Array.from(
        new Set([...defaultExclude, ...userExclude.map(normalizePattern)])
    );

    const cfg: Cfg = {
        codebasePath: raw.codebasePath ?? process.cwd(),
        collection: raw.collection ?? "code_chunks",
        embedModel: raw.embedModel ?? "nomic-embed-text",
        include:
            Array.isArray(raw.include) && raw.include.length > 0
                ? raw.include
                : ["**/*.{ts,tsx,js,jsx,md,mjs,cjs,py,go,rs,java,kt,json}"],
        exclude: mergedIgnores,
        maxFileBytes:
            typeof raw.maxFileBytes === "number" ? raw.maxFileBytes : 1_000_000,
        chunk: raw.chunk ?? { lines: 40, overlap: 10 },
    };

    return cfg;
}

function ollamaEmbed(model: string, prompt: string): Promise<number[]> {
    const body = JSON.stringify({ model, prompt });

    const opts: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: 11434,
        path: "/api/embeddings",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
    };

    return new Promise((resolve, reject) => {
        const req = http.request(opts, (res: IncomingMessage) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (data += chunk));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed?.embedding && Array.isArray(parsed.embedding)) {
                        resolve(parsed.embedding as number[]);
                    } else {
                        const msg =
                            parsed?.error ??
                            `Unexpected embeddings response (no 'embedding' array). Raw: ${data}`;
                        reject(new Error(msg));
                    }
                } catch (e) {
                    reject(
                        new Error(
                            `Failed to parse embeddings response: ${String(
                                e
                            )}. Raw: ${data}`
                        )
                    );
                }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

async function getDim(embedModel: string): Promise<number> {
    try {
        const v = await ollamaEmbed(embedModel, "dimension-probe");
        if (!v?.length) throw new Error("embedding returned empty array");
        return v.length;
    } catch (err) {
        const envSize = Number(process.env.VECTOR_SIZE);
        if (Number.isFinite(envSize) && envSize > 0) {
            console.warn(
                `[warn] Embedding probe failed: ${String(
                    err
                )}. Falling back to VECTOR_SIZE=${envSize}`
            );
            return envSize;
        }
        throw new Error(`Failed to get embedding dimension: ${String(err)}`);
    }
}

function chunkByLines(
    text: string,
    lines: number,
    overlap: number
): { start: number; end: number; text: string }[] {
    if (lines <= 0) throw new Error("lines must be > 0");
    if (overlap < 0 || overlap >= lines)
        throw new Error("0 <= overlap < lines");

    const arr = text.split(/\r?\n/);
    const chunks: { start: number; end: number; text: string }[] = [];

    for (let i = 0; i < arr.length; i += lines - overlap) {
        const slice = arr.slice(i, i + lines);
        if (!slice.length) break;
        chunks.push({
            start: i + 1,
            end: Math.min(i + lines, arr.length),
            text: slice.join("\n"),
        });
    }
    return chunks;
}

async function ensureCollection(
    client: QdrantClient,
    name: string,
    expectedSize: number
): Promise<void> {
    if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
        throw new Error(`Invalid vector size: ${expectedSize}`);
    }

    try {
        const info = await client.getCollection(name);
        const vectorsCfg: any = (info as any)?.result?.config?.params?.vectors;
        if (vectorsCfg) return;
    } catch {
        console.log("not found or not healthy, we'll try create");
    }

    try {
        await client.createCollection(name, {
            vectors: { size: expectedSize, distance: DISTANCE },
        });
        return;
    } catch (e: any) {
        const msg = String(e?.data?.status?.error ?? e?.message ?? e);
        const looksLikeDirExists =
            /File exists \(os error 17\)|already exists|EEXIST/i.test(msg);

        if (!looksLikeDirExists) throw e;

        console.warn(
            `[warn] Collection dir exists but API create failed. Dropping and recreating: ${name}`
        );
        try {
            await client.deleteCollection(name);
        } catch (delErr: any) {
            console.warn(
                `[warn] deleteCollection failed (continuing): ${String(
                    delErr?.data?.status?.error ?? delErr
                )}`
            );
        }
        await client.createCollection(name, {
            vectors: { size: expectedSize, distance: DISTANCE },
        });
    }
}

async function main(): Promise<void> {
    const cfg = await readConfig();
    const client = new QdrantClient({ url: QDRANT_URL });

    // Determine vector size
    const discoveredDim = await getDim(cfg.embedModel);
    const vectorSize =
        Number.isFinite(Number(process.env.VECTOR_SIZE)) &&
        Number(process.env.VECTOR_SIZE) > 0
            ? Number(process.env.VECTOR_SIZE)
            : discoveredDim;

    await ensureCollection(client, cfg.collection, vectorSize);

    const files = await fg(cfg.include, {
        cwd: cfg.codebasePath,
        ignore: cfg.exclude,
        absolute: true,
        onlyFiles: true,
        unique: true,
        dot: false,
        followSymbolicLinks: false
    });

    let id = 1;
    let pending: Array<{
        id: number | string;
        vector: number[];
        payload: Record<string, unknown>;
    }> = [];

    for (const f of files) {
        const rel = path.relative(cfg.codebasePath, f);

        if (hasPathSegment(rel, "node_modules")) continue;
        if (hasPathSegment(rel, ".git")) continue;
        if (hasPathSegment(rel, "dist")) continue;
        if (hasPathSegment(rel, "build")) continue;

        const st = await fs.stat(f);
        if (st.size > cfg.maxFileBytes) continue;

        let text: string;
        try {
            text = await fs.readFile(f, "utf8");
        } catch {
            continue;
        }

        const chunks = chunkByLines(text, cfg.chunk.lines, cfg.chunk.overlap);

        for (const ch of chunks) {
            const emb = await ollamaEmbed(
                cfg.embedModel,
                `FILE:${rel}\n[L${ch.start}-${ch.end}]\n${ch.text}`
            );

            if (emb.length !== vectorSize) {
                throw new Error(
                    `Embedding size mismatch for ${rel} [${ch.start}-${ch.end}]: got ${emb.length}, expected ${vectorSize}`
                );
            }

            pending.push({
                id: id++,
                vector: emb,
                payload: {
                    path: rel,
                    start: ch.start,
                    end: ch.end,
                    preview: ch.text.slice(0, 600),
                },
            });

            if (pending.length >= BATCH_SIZE) {
                await client.upsert(cfg.collection, { points: pending });
                pending = [];
            }
        }

        console.log(`Indexed: ${rel} (${chunks.length} chunks)`);
    }

    if (pending.length) {
        await client.upsert(cfg.collection, { points: pending });
    }

    console.log("✅ Index complete.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
