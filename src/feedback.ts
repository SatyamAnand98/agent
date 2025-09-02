import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
const exec = promisify(execCb);

async function hasScript(name: string, cwd: string) {
    try {
        const raw = await fs.readFile(`${cwd}/package.json`, "utf8");
        const pkg = JSON.parse(raw);
        return Boolean(pkg?.scripts?.[name]);
    } catch {
        return false;
    }
}

export async function runFeedback(repoPath: string) {
    const steps: { name: string; cmd: string; enabled: boolean }[] = [
        {
            name: "TypeCheck",
            cmd: "npx tsc --noEmit",
            enabled: (await hasScript("tsc", repoPath)) || true,
        }, // try anyway; harmless if no tsconfig
        {
            name: "Lint",
            cmd: "npx eslint . --max-warnings=0",
            enabled: await hasScript("lint", repoPath),
        },
        {
            name: "UnitTests",
            cmd: "npm test --silent",
            enabled: await hasScript("test", repoPath),
        },
    ];

    const results: {
        name: string;
        ok: boolean;
        out: string;
        skipped?: boolean;
    }[] = [];

    for (const s of steps) {
        if (!s.enabled) {
            results.push({ name: s.name, ok: true, out: "", skipped: true });
            continue;
        }
        try {
            const { stdout, stderr } = await exec(s.cmd, { cwd: repoPath });
            results.push({
                name: s.name,
                ok: true,
                out: (stdout || "") + (stderr || ""),
            });
        } catch (e: any) {
            results.push({
                name: s.name,
                ok: false,
                out: e?.stdout || e?.stderr || String(e),
            });
        }
    }
    return results;
}
