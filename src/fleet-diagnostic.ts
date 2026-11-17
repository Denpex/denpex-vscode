// Denpex: Run Fleet Diagnostic on Current File.
// Sends the active file (or selection) to the GPU Fleet Command Suite API, which
// detects the tool and enforces the plan, then opens the report as Markdown.
import * as vscode from 'vscode';
import { ApiError, fleetDiagnostic } from './api';
import { fleetErrorNextStep, renderFleetReportMarkdown, selectFleetInput } from './fleet-report';

const MAX_BYTES = 2 * 1024 * 1024;

export async function runFleetDiagnosticOnCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showInformationMessage('Open the output of a fleet tool (for example nccl-tests, gpu-burn, DCGM, nvtop or lstopo), then run this command.');
        return;
    }
    if (vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') {
        void vscode.window.showInformationMessage('Fleet diagnostics run on Denpex servers, and Denpex: Engine is set to Local only, so nothing was sent. Use the Denpex CLI (for example `denpex nccl-tests --input out.txt`) to analyze this file on your machine.');
        return;
    }
    const input = selectFleetInput(editor.document.getText(), editor.document.getText(editor.selection));
    if (!input) {
        void vscode.window.showInformationMessage('This file is empty. Open or select fleet tool output first.');
        return;
    }
    if (Buffer.byteLength(input) > MAX_BYTES) {
        void vscode.window.showWarningMessage('This file is larger than 2 MiB. Select the relevant part, or analyze it locally with the Denpex CLI.');
        return;
    }
    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Denpex: analyzing fleet tool output', cancellable: true },
            (_progress, token) => fleetDiagnostic(input, token),
        );
        const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderFleetReportMarkdown(result) });
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
        await showFleetError(error);
    }
}

async function showFleetError(error: unknown): Promise<void> {
    const status = error instanceof ApiError ? error.status : undefined;
    const code = error instanceof ApiError ? error.code : undefined;
    const message = error instanceof Error ? error.message : 'The fleet diagnostic could not run.';
    switch (fleetErrorNextStep(status, code)) {
        case 'connect': {
            const choice = await vscode.window.showWarningMessage(message, 'Connect Account');
            if (choice) await vscode.commands.executeCommand('denpex.connectAccount');
            return;
        }
        case 'upgrade': {
            const choice = await vscode.window.showWarningMessage(message, 'View Plans');
            if (choice) await vscode.commands.executeCommand('denpex.openPricing');
            return;
        }
        case 'diagnose': {
            const choice = await vscode.window.showInformationMessage(message, 'Diagnose as a Crash Log');
            if (choice) await vscode.commands.executeCommand('denpex.diagnoseCurrentEditor');
            return;
        }
        default:
            void vscode.window.showErrorMessage(`Denpex: ${message}`);
    }
}
