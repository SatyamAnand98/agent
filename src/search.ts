import { QdrantClient } from "@qdrant/js-client-rest";
import http, { IncomingMessage } from "node:http";
import { promises as fs } from "node:fs";

// load your same config
const cfg = JSON.parse(await fs.readFile("agent.config.json", "utf8"));
const client = new QdrantClient({
    url: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
});

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
            res.on("data", (c: string) => (data += c));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.embedding as number[]);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    const query =
        process.argv[2] ??
        `Give me short description about each webhook event:
        const webhookEventsDict = {
            video: [
                'video.status.created',
                'video.status.downloaded',
                'video.status.optimized',
                'video.status.ready',
                'video.status.errored',
                'video.status.deleted',
                'video.status.repackaged',
                'video.status.stream_ready'
            ],
            liveVideo: [
                'live.video.status.created',
                'live.video.status.ready',
                'live.video.status.preparing',
                'live.video.status.connected',
                'live.video.status.active',
                'live.video.status.complete',
                'live.video.status.disconnected'
            ],
            events: [
                'event.embed.viewed',
                'event.embed.cta_clicked',
                'event.video.updated',
                'event.video.uploaded',
                'event.playlist.created',
                'event.playlist.asset',
                'event.video.analytics',
                'event.image.analytics'
            ]
        }
        `
    const embedding = await ollamaEmbed(cfg.embedModel, query);

    const results = await client.search(cfg.collection, {
        vector: embedding,
        limit: 5,
    });

    console.log("Query:", query);
    console.log("Results:");
    for (const r of results) {
        console.log(`- Score: ${r.score.toFixed(3)} Path: ${r.payload?.path}`);
        console.log(r.payload?.preview);
        console.log("---");
    }
}

main().catch(console.error);
