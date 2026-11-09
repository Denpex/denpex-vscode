import * as vscode from 'vscode';
import { isIP } from 'net';
import { CLIENT_VERSION, DiagnoseResponse, apiKey, submitCloudOutcome, submitCloudCorrection } from './api';

/** Best-effort local redaction. Review is required because arbitrary logs can contain secrets. */
export function redactFeedbackText(value: string): string {
    const hosts = new Map<string, string>();
    return value
        .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g, '[PRIVATE KEY REDACTED]')
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[AUTH REDACTED]')
        .replace(/\b(?:sk|hf|ghp|github_pat|AKIA)[-_]?[A-Za-z0-9_]{12,}\b/g, '[TOKEN REDACTED]')
        .replace(/["']?\b(api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization|credential)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1=[REDACTED]')
        .replace(/--(api[-_]key|access[-_]token|token|password|secret)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '--$1 [REDACTED]')
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, '[URL REDACTED]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL REDACTED]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP REDACTED]')
        .replace(/(?<![A-Za-z0-9_:])(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*(?![A-Za-z0-9_:])/gi, candidate => isIP(candidate) === 6 ? '[IP REDACTED]' : candidate)
        .replace(/\b[A-Z]:[\\/][^\s"'<>]+/gi, '[PATH REDACTED]')
        .replace(/\\\\[^\s"'<>]+/g, '[PATH REDACTED]')
        .replace(/(^|[\s=(])(?:~?\/)[^\s"'<>]+/g, '$1[PATH REDACTED]')
        .replace(/\b(hostname|host|node)\s*[:=]\s*([^\s,;]+)/gi, (_match, key: string, host: string) => {
            if (!hosts.has(host)) hosts.set(host, `[HOST_${hosts.size + 1}]`);
            return `${key}=${hosts.get(host)}`;
        })
        .replace(/\b(username|user|project|job[_-]?id)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

/** Allowlist fields only. Raw incident logs, account data and machine identity are never included. */
export function buildLocalFeedback(result: DiagnoseResponse, reason: string, description: string, includeEvidence: boolean): string {
    const decision = result.offlineDecision;
    return JSON.stringify({
        schemaVersion: 1,
        extensionVersion: CLIENT_VERSION,
        feedback: { reason, description: redactFeedbackText(description) },
        diagnosis: {
            failureType: result.meta?.failureType,
            summary: redactFeedbackText(result.fix?.summary || ''),
            decisionStatus: decision?.status,
            hypotheses: decision?.hypotheses.map(item => ({ id: item.id, assessment: item.assessment })),
        },
        evidence: includeEvidence ? decision?.observations.slice(0, 40).map(item => ({
            line: item.line, rank: item.rank, kind: item.kind, role: item.role,
            text: redactFeedbackText(item.text).slice(0, 2000),
        })) || [] : [],
        privacy: {
            uploaded: false, evidenceIncluded: includeEvidence,
            notice: 'Best-effort redaction can miss private values. Review and edit this file before sharing. Nothing is sent automatically.',
        },
    }, null, 2);
}

export async function prepareLocalFeedback(result: DiagnoseResponse): Promise<void> {
    const reason = await vscode.window.showQuickPick([
        'Incorrect conclusion', 'Suggested fix did not help', 'Missing context or unsupported workload', 'Diagnosis helped',
    ], { title: 'Prepare feedback locally', placeHolder: 'This creates an editable local draft. Nothing is uploaded.' });
    if (!reason) return;
    const description = await vscode.window.showInputBox({
        title: 'What did you observe?', prompt: 'Optional: expected result and what actually happened. Avoid private data. Nothing is uploaded.',
        ignoreFocusOut: true,
    });
    if (description === undefined) return;
    const evidence = await vscode.window.showQuickPick(['No log excerpts', 'Include redacted evidence excerpts'], {
        title: 'Choose feedback content', placeHolder: 'Redaction is best effort. You will review an editable draft before saving.',
    });
    if (!evidence) return;
    const draft = await vscode.workspace.openTextDocument({ language: 'json', content: buildLocalFeedback(result, reason, description, evidence === 'Include redacted evidence excerpts') });
    await vscode.window.showTextDocument(draft, { preview: false });
    void vscode.window.showInformationMessage('Feedback draft created locally. Review and remove private values, then use Save As to export. Nothing has been sent.');
}

/** User initiated only. This reports observations for an owned cloud incident, not offline logs. */
export async function submitObservedCloudFeedback(result: DiagnoseResponse): Promise<void> {
    if (vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') return;
    if (!apiKey() || !result.diagnosisId) {
        void vscode.window.showInformationMessage('Central feedback needs a connected account and its saved cloud incident. You can still prepare a local feedback draft.'); return;
    }
    const choice = await vscode.window.showQuickPick(['Incorrect conclusion', 'Fix did not help', 'Fix resolved the observed failure'], { title: 'Report an observed outcome', placeHolder: 'Only report what you observed. No logs will be attached.' });
    if (!choice) return;
    const entered = await vscode.window.showInputBox({ title: 'Observed outcome', prompt: 'Describe the observation, or say the cause is unknown. This note will be sent only after your next confirmation. Avoid private data.', validateInput: value => value.length > 2000 ? 'Use at most 2,000 characters.' : null });
    if (entered === undefined) return;
    const note = redactFeedbackText(entered || 'User supplied no additional observation; the underlying cause remains unverified.');
    const approval = await vscode.window.showInformationMessage(`Send ${choice.toLowerCase()} for incident ${result.diagnosisId} to Denpex? Note: ${note}. Only this best-effort redacted note and your selected outcome are submitted with the incident ID. Check the note for private details before sending.`, { modal: true }, 'Send report');
    if (approval !== 'Send report' || vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') return;
    try {
        if (choice === 'Incorrect conclusion') await submitCloudCorrection(result.diagnosisId, result.meta?.failureType || 'UNKNOWN', note);
        else await submitCloudOutcome(result.diagnosisId, choice === 'Fix did not help' ? 'did_not_work' : 'worked', note);
        void vscode.window.showInformationMessage('Your observed outcome was saved for review. It is not independently verified ground truth.');
    } catch { void vscode.window.showErrorMessage('We could not confirm receipt. You can prepare a local feedback draft or retry this report.'); }
}
