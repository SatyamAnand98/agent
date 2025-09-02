import fs from "fs/promises";
import { exec as execCb } from "child_process";
import { promisify } from "util";
const exec = promisify(execCb);

export type ContextDoc = { label: string; content: string };

export async function loadPromptFile(): Promise<ContextDoc> {
    const raw = await fs.readFile("prompt.txt", "utf8");
    return { label: "prompt.txt", content: raw };
}

export async function gitRecentCommits(
    repoPath: string,
    n = 30
): Promise<ContextDoc> {
    try {
        const { stdout } = await exec(
            `git -C "${repoPath}" log -n ${n} --pretty=format:"%h %ad %s" --date=short`
        );
        return { label: "git-log", content: stdout };
    } catch {
        return { label: "git-log", content: "" };
    }
}
