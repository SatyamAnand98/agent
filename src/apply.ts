import fs from "fs/promises";
import path from "path";

export async function applyPlan(
    plan: any[],
    repoRoot: string,
    dryRun: boolean
) {
    if (!plan?.length) {
        console.log("No actionable plan.");
        return;
    }
    for (const p of plan) {
        const abs = path.join(repoRoot, p.file);
        let text: string;
        try {
            text = await fs.readFile(abs, "utf8");
        } catch {
            console.log("(skip) not found:", p.file);
            continue;
        }

        if (!p.patch || !p.patch.length) {
            console.log("Pointer →", p.file, "\n ", p.rationale);
            continue;
        }

        let updated = text,
            applied = 0;
        for (const ch of p.patch) {
            if (updated.includes(ch.before)) {
                updated = updated.replace(ch.before, ch.after);
                applied++;
            } else
                console.log(`  (warn) before-snippet not found in ${p.file}`);
        }

        if (applied > 0 && updated !== text) {
            if (dryRun)
                console.log(`Would change: ${p.file} (${applied} patch(es))`);
            else {
                await fs.writeFile(abs, updated, "utf8");
                console.log(`Applied → ${p.file}`);
            }
        } else {
            console.log("Pointer →", p.file, "\n ", p.rationale);
        }
    }
}
