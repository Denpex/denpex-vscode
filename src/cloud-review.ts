import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { apiBase, MAX_LOG_BYTES, MIN_LOG_CHARS, DiagnoseResponse } from './api';
import { escapeHtml } from './panel';
import { redactFeedbackText } from './local-feedback';

/** An explicit, editable transport preview. Opening or cancelling never sends a request. */
export function previewCloudPayload(logs: string, followup?: {diagnosisId: string; originalLogs: string}): Promise<string | undefined> {
    if (vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') return Promise.resolve(undefined);
    const destination = apiBase();
    return new Promise(resolve => {
        const panel = vscode.window.createWebviewPanel('denpexCloudPreview', 'Denpex: Review cloud payload', vscode.ViewColumn.Active, { enableScripts: true });
        const nonce = randomBytes(24).toString('hex');
        let settled = false;
        const finish = (value?: string) => { if (!settled) { settled = true; resolve(value); panel.dispose(); } };
        panel.onDidDispose(() => { if (!settled) { settled = true; resolve(undefined); } });
        panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'cancel') return finish();
            if (message.command !== 'send' || typeof message.logs !== 'string') return;
            if (vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') return finish();
            if (apiBase() !== destination) { void vscode.window.showWarningMessage('The cloud destination changed. Open a new preview before sending.'); return finish(); }
            const length = Buffer.byteLength(message.logs, 'utf8');
            if (message.logs.trim().length < (followup ? 1 : MIN_LOG_CHARS) || length > MAX_LOG_BYTES) {
                void vscode.window.showWarningMessage(`Cloud review needs at least ${followup ? 1 : MIN_LOG_CHARS} characters and at most ${MAX_LOG_BYTES} bytes. Edit the preview and try again.`);
                return;
            }
            finish(message.logs);
        });
        panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
            body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:20px;max-width:850px}textarea{box-sizing:border-box;width:100%;min-height:320px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-contrastBorder));font:inherit;padding:12px}button{margin:12px 12px 0 0;padding:8px 14px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid var(--vscode-contrastBorder,transparent)}button:focus-visible,textarea:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}</style></head><body>
            <h1>Review before sending</h1><p>Nothing has been uploaded. Edit or remove private values below. Best-effort redaction may miss secrets.</p>
            <p>Destination: <strong>${escapeHtml(destination)}</strong>. ${followup ? `Denpex will receive this edited follow-up and the original evidence already approved for incident <code>${escapeHtml(followup.diagnosisId)}</code>.` : 'Denpex will receive this edited text and the job label <code>extension-cloud-review</code>.'} Your connected credential or anonymous session is used for access. No files, telemetry or topology are attached by this flow.</p>
            ${followup ? `<details><summary>Original incident evidence included with this follow-up</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(followup.originalLogs)}</pre></details>` : ''}
            <p>Cloud review may add reasoning or request more evidence. It does not prove the cause or verify recovery. Your original local report stays available.</p>
            <label for="payload">${followup ? 'Follow-up message to send' : 'Log excerpts to send'}</label><textarea id="payload" spellcheck="false">${escapeHtml(redactFeedbackText(logs))}</textarea>
            <p>Submit only what you want Denpex to process under its privacy policy. This does not opt you into product analytics or marketing.</p>
            <button type="button" id="send">${followup ? 'Send follow-up' : 'Send for cloud review'}</button><button type="button" id="cancel">Cancel</button>
            <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.getElementById('send').addEventListener('click',()=>vscode.postMessage({command:'send',logs:document.getElementById('payload').value}));document.getElementById('cancel').addEventListener('click',()=>vscode.postMessage({command:'cancel'}));</script></body></html>`;
    });
}

export function assessmentComparison(local: DiagnoseResponse, cloud: DiagnoseResponse, evidenceChanged = false): DiagnoseResponse['cloudReview'] {
    const original = local.fix?.summary || 'See the original local report.';
    const reviewed = cloud.fix?.summary || 'The cloud returned no summary.';
    return { originalSummary: original, originalType: local.meta?.failureType || 'unknown',
        reviewedType: cloud.meta?.failureType || 'unknown',
        changed: original !== reviewed || local.meta?.failureType !== cloud.meta?.failureType,
        note: `${evidenceChanged ? 'The cloud used edited/redacted evidence, so an assessment change may reflect the input change. ' : ''}A second assessment is not independent verification. Compare the supporting evidence and verify the proposed next step on your workload.` };
}
