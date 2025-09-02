import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";

function runAgent(cmd: "analyze" | "apply") {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage("Open your repo folder first.");
        return;
    }

    const agentRoot = path.resolve(ws.uri.fsPath, "agent"); // adjust if separate
    const out = vscode.window.createOutputChannel("Local Code Agent");
    out.show(true);
    const child = spawn("pnpm", [cmd], { cwd: agentRoot, shell: true });

    child.stdout.on("data", (d) => out.append(d.toString()));
    child.stderr.on("data", (d) => out.append(d.toString()));
    child.on("close", (code) => {
        if (code === 0)
            vscode.window.showInformationMessage(`Agent ${cmd} finished.`);
        else
            vscode.window.showErrorMessage(
                `Agent ${cmd} exited with code ${code}`
            );
    });
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("agent.analyze", () =>
            runAgent("analyze")
        ),
        vscode.commands.registerCommand("agent.apply", () => runAgent("apply"))
    );
}
export function deactivate() {}
