import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({ url: "http://127.0.0.1:6333" });

async function wipe() {
    await client.deleteCollection("code_chunks"); // replace with your collection name
    console.log("Collection deleted");
}

wipe().catch(console.error);
