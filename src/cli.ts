import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { loadPromptFile, gitRecentCommits } from "./connectors.js";
import { retrieveTopK } from "./retrieve.js";
import { planEdits } from "./planner.js";
import { applyPlan } from "./apply.js";
import { runFeedback } from "./feedback.js";

const cfg = JSON.parse(await fs.readFile("agent.config.json", "utf8"));

async function readUserPrompt(): Promise<string> {
    const pf = await loadPromptFile();
    const git = await gitRecentCommits(cfg.codebasePath, 20);
    // Keep raw prompt content; add small footer with recent commits for extra context
    return `${pf.content}\n\n---\nRecent commits:\n${git.content}`;
}

async function analyze() {
    const userPrompt = await readUserPrompt();
    const retrieved = await retrieveTopK(
        cfg.collection,
        cfg.embedModel,
        userPrompt,
        12
    );
    console.log("\nTop context:");
    for (const r of retrieved) {
        console.log(`- ${r.path} [${r.start}-${r.end}]`);
    }
}

async function apply() {
    const userPrompt = await readUserPrompt();
    const retrieved = await retrieveTopK(
        cfg.collection,
        cfg.embedModel,
        userPrompt,
        12
    );
    const plan = await planEdits(cfg.llmModel, userPrompt, retrieved);
    await applyPlan(plan, cfg.codebasePath, cfg.dryRun);

    const fb = await runFeedback(cfg.codebasePath);
    console.log("\nFeedback results:");
    for (const r of fb) console.log(`- ${r.name}: ${r.ok ? "OK" : "FAIL"}`);
    // (Optional) if anything fails, you can loop: send fb.out back to planner for a fix.
}

const program = new Command();
program.command("analyze").action(analyze);
program.command("apply").action(apply);
program.parseAsync(process.argv);
