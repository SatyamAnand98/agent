import http from "http";

export type PlanEdit = {
    file: string;
    rationale: string;
    patch?: { before: string; after: string }[];
};

function chat(
    model: string,
    messages: { role: "system" | "user"; content: string }[]
): Promise<string> {
    const body = JSON.stringify({ model, messages, stream: false });
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
    return new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve(JSON.parse(d).message?.content ?? ""));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

export async function planEdits(
    llmModel: string,
    userPrompt: string,
    retrieved: { path: string; start: number; end: number; preview: string }[]
): Promise<PlanEdit[]> {
    const ctx = retrieved
        .map((r) => `FILE:${r.path} [L${r.start}-${r.end}]\n${r.preview}`)
        .join("\n\n====\n\n");
    const prompt = `
User prompt (from prompt.txt):
${userPrompt}

You have relevant repo chunks:
${ctx}

Return JSON array ONLY like:
[
  {"file":"relative/path.ts","rationale":"...","patch":[{"before":"EXACT OLD","after":"NEW"}]}
]
- Up to 5 files, up to 3 patches/file
- If change is big or risky, omit "patch" and only give rationale with file pointer.
  `;
    const out = await chat(llmModel, [
        {
            role: "system",
            content:
                "You are a terse, surgical code editor. Output valid JSON only.",
        },
        { role: "user", content: prompt },
    ]);
    try {
        return JSON.parse(out);
    } catch {
        return [];
    }
}
