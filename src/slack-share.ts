import * as crypto from 'crypto';
import * as https from 'https';
import * as vscode from 'vscode';
import { SLACK_URL, attribute } from './api';
import type { DiagnoseResponse } from './api';
import { crashCostSentence } from './log-insights';

/**
 * Send a diagnosis to a Slack channel.
 *
 * Connecting opens Slack's own install screen, where the user picks the channel. The
 * channel's webhook comes back sealed to a secret that never leaves this editor, and is
 * kept in VS Code SecretStorage. Messages go from this editor straight to Slack: the
 * diagnosis never passes through Denpex. The raw log is never sent, only the summary the
 * user previews before it goes.
 */

const SHARE_BASE = 'https://slack.denpex.com';
const TARGET_KEY = 'denpex.slackShareTarget.v1';
const PENDING_KEY = 'denpex.slackSharePending.v1';
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_FIELD = 600;

export interface SlackShareTarget { webhookUrl: string; channel: string | null; teamName: string | null }
interface PendingShare { secret: string; expiresAt: number }

let context: vscode.ExtensionContext | undefined;
let queued: DiagnoseResponse | undefined;

export function initSlackShare(ctx: vscode.ExtensionContext): void {
    context = ctx;
    ctx.subscriptions.push(vscode.window.registerUriHandler({
        handleUri: async (uri) => {
            if (uri.path !== '/slack-connected') return;
            const ticket = new URLSearchParams(uri.query).get('ticket');
            if (ticket) await finishConnection(ticket);
        },
    }));
}

function clip(text: unknown, max = MAX_FIELD): string {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Slack escaping for user-visible text: only &, < and > are special. */
function slackEscape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The message posted to Slack. Summary fields only: no raw log, no evidence lines. */
export function buildSlackShareText(d: DiagnoseResponse): string {
    const fix: any = d.fix || {};
    const meta: any = d.meta || {};
    const lines: string[] = [`:rotating_light: *GPU crash diagnosed: ${slackEscape(clip(meta.failureType || 'GPU / ML incident', 120))}*`];
    if (fix.summary) lines.push(slackEscape(clip(fix.summary)));
    const ranks = d.logInsights?.ranks;
    if (ranks?.errored.length) {
        const waited = ranks.timedOut.length ? `; ${ranks.timedOut.length} other rank${ranks.timedOut.length === 1 ? '' : 's'} only timed out waiting` : '';
        lines.push(`*Where it started:* rank ${ranks.errored.slice(0, 8).join(', ')}${waited}`);
    }
    const cost = d.logInsights ? crashCostSentence(d.logInsights) : null;
    if (cost) lines.push(`*Cost of this crash:* ${slackEscape(cost)}`);
    if (fix.action) lines.push(`*Fix:* ${slackEscape(clip(fix.action))}`);
    if (fix.verificationCommand) lines.push(`*Verify with:* \`${clip(fix.verificationCommand, 300).replace(/`/g, "'")}\``);
    lines.push(`_Diagnosed in VS Code by Denpex. Diagnose crash logs right in Slack: ${attribute(SLACK_URL, 'slack')}_`);
    return lines.join('\n');
}

function postJson(url: string, body: unknown): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 15000,
        }, (res) => {
            let text = '';
            res.on('data', (c) => { if (text.length < 4096) text += c; });
            res.on('end', () => resolve({ status: res.statusCode || 0, text }));
        });
        req.on('timeout', () => req.destroy(new Error('Slack did not answer in time.')));
        req.on('error', reject);
        req.end(data);
    });
}

async function readTarget(): Promise<SlackShareTarget | undefined> {
    const raw = await context?.secrets.get(TARGET_KEY);
    if (!raw) return undefined;
    try {
        const t = JSON.parse(raw) as SlackShareTarget;
        return typeof t.webhookUrl === 'string' && t.webhookUrl.startsWith('https://hooks.slack.com/services/') ? t : undefined;
    } catch { return undefined; }
}

function channelLabel(t: SlackShareTarget): string {
    return t.channel ? `${t.channel}${t.teamName ? ` (${t.teamName})` : ''}` : (t.teamName || 'your Slack channel');
}

function uploadsBlocked(): boolean {
    if (vscode.workspace.getConfiguration('denpex').get<string>('engine') !== 'local') return false;
    void vscode.window.showWarningMessage('Denpex is in Local only mode, so nothing leaves this machine. Change "Denpex: Engine" to send diagnoses to Slack.');
    return true;
}

/** Open Slack's install screen; the result arrives through the URI handler or a pasted code. */
export async function connectSlack(): Promise<void> {
    if (!context || uploadsBlocked()) return;
    const secret = crypto.randomBytes(32).toString('base64url');
    const ch = crypto.createHash('sha256').update(secret).digest('base64url');
    const pending: PendingShare = { secret, expiresAt: Date.now() + PENDING_TTL_MS };
    await context.secrets.store(PENDING_KEY, JSON.stringify(pending));
    let ret = '';
    try {
        const external = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://denpex.denpex-diagnostics/slack-connected`));
        if (external.scheme !== 'http' && external.scheme !== 'https') ret = external.toString(true);
    } catch { /* fall back to the pasted code */ }
    const start = `${SHARE_BASE}/slack/share/start?ch=${encodeURIComponent(ch)}${ret ? `&ret=${encodeURIComponent(ret)}` : ''}`;
    const opened = await vscode.env.openExternal(vscode.Uri.parse(start));
    if (!opened) {
        void vscode.window.showErrorMessage('Denpex could not open your browser to connect Slack.');
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        'Pick a channel in Slack, then return here. If your editor does not reopen by itself, paste the code the page shows.',
        'Paste code',
    );
    if (choice === 'Paste code') {
        const code = await vscode.window.showInputBox({ prompt: 'Paste the code from the Denpex Slack page', ignoreFocusOut: true, password: true });
        if (code) await finishConnection(code.trim());
    }
}

async function finishConnection(ticket: string): Promise<void> {
    if (!context) return;
    const raw = await context.secrets.get(PENDING_KEY);
    let pending: PendingShare | undefined;
    try { pending = raw ? JSON.parse(raw) as PendingShare : undefined; } catch { pending = undefined; }
    if (!pending || pending.expiresAt < Date.now()) {
        void vscode.window.showErrorMessage('This Slack connection expired. Choose Send to Slack again.');
        return;
    }
    let res: { status: number; text: string };
    try {
        res = await postJson(`${SHARE_BASE}/slack/share/redeem`, { ticket, secret: pending.secret });
    } catch (e: any) {
        void vscode.window.showErrorMessage(`Denpex could not finish connecting Slack: ${e?.message || e}`);
        return;
    }
    let body: any = {};
    try { body = JSON.parse(res.text); } catch { /* handled below */ }
    if (res.status !== 200 || typeof body.webhookUrl !== 'string') {
        void vscode.window.showErrorMessage(String(body.error || 'Denpex could not finish connecting Slack. Try again.'));
        return;
    }
    const target: SlackShareTarget = { webhookUrl: body.webhookUrl, channel: body.channel || null, teamName: body.teamName || null };
    await context.secrets.store(TARGET_KEY, JSON.stringify(target));
    await context.secrets.delete(PENDING_KEY);
    void vscode.window.showInformationMessage(`Denpex can now post to ${channelLabel(target)}.`);
    const next = queued;
    queued = undefined;
    if (next) await sendDiagnosisToSlack(next);
}

/** Preview, confirm, then post straight to the channel webhook. */
export async function sendDiagnosisToSlack(d: DiagnoseResponse | undefined): Promise<void> {
    if (!context) return;
    if (!d) {
        void vscode.window.showInformationMessage('Run a diagnosis first, then send it to Slack.');
        return;
    }
    if (uploadsBlocked()) return;
    const target = await readTarget();
    if (!target) {
        queued = d;
        await connectSlack();
        return;
    }
    const text = buildSlackShareText(d);
    const choice = await vscode.window.showInformationMessage(
        `Post this to ${channelLabel(target)}?`,
        { modal: true, detail: `${text}\n\nOnly this summary is sent, straight from your editor to Slack. The log itself is not sent.` },
        'Post to Slack', 'Choose another channel',
    );
    if (choice === 'Choose another channel') {
        queued = d;
        await connectSlack();
        return;
    }
    if (choice !== 'Post to Slack') return;
    let res: { status: number; text: string };
    try {
        res = await postJson(target.webhookUrl, { text, unfurl_links: false });
    } catch (e: any) {
        void vscode.window.showErrorMessage(`Denpex could not reach Slack: ${e?.message || e}`);
        return;
    }
    if (res.status === 200) {
        void vscode.window.showInformationMessage(`Posted to ${channelLabel(target)}.`);
        return;
    }
    if ([403, 404, 410].includes(res.status)) {
        await context.secrets.delete(TARGET_KEY);
        const again = await vscode.window.showErrorMessage('Slack no longer accepts posts to that channel (the app or channel was removed). Connect again?', 'Connect Slack');
        if (again === 'Connect Slack') { queued = d; await connectSlack(); }
        return;
    }
    void vscode.window.showErrorMessage(`Slack refused the message (${res.status}). Try again in a moment.`);
}

export async function disconnectSlackShare(): Promise<void> {
    await context?.secrets.delete(TARGET_KEY);
    await context?.secrets.delete(PENDING_KEY);
    void vscode.window.showInformationMessage('Denpex will no longer post to Slack from this editor. To remove the app itself, uninstall it in Slack.');
}
