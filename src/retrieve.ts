import { QdrantClient } from "@qdrant/js-client-rest";
import http from "http";

export type Retrieved = {
    path: string;
    start: number;
    end: number;
    preview: string;
};

async function embed(model: string, text: string): Promise<number[]> {
    const payloads = [
        { model, prompt: text }, // preferred in recent Ollama
        { model, input: text }, // fallback for older variants
    ];

    for (const bodyObj of payloads) {
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

            // If Ollama returned an error shape, throw to try the next payload or surface a good error
            if (parsed?.error) throw new Error(`Ollama error: ${parsed.error}`);
        } catch (e) {
            // Try next payload; if both fail, we'll throw below
        }
    }

    throw new Error(
        "Failed to get embeddings from Ollama. " +
            "Ensure the model is pulled and the endpoint is reachable. " +
            'Test with: curl -s localhost:11434/api/embeddings -d \'{"model":"nomic-embed-text","prompt":"hello"}\''
    );
}

export async function retrieveTopK(
    collection: string,
    embedModel: string,
    query: string,
    k = 12
): Promise<Retrieved[]> {
    const qdrant = new QdrantClient({ url: "http://127.0.0.1:6333" });

    // keep the query reasonable for embedding models
    const trimmed = query.length > 5000 ? query.slice(0, 5000) : query;

    const vec = await embed(embedModel, trimmed);
    if (!Array.isArray(vec) || vec.length === 0) {
        throw new Error("Embedding vector is empty; cannot query Qdrant.");
    }

    const res = await qdrant.search(collection, { vector: vec, limit: k });
    return (res ?? []).map((p) => ({
        path: (p.payload as any).path,
        start: (p.payload as any).start,
        end: (p.payload as any).end,
        preview: (p.payload as any).preview,
    }));
}
