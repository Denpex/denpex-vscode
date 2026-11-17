import * as vscode from 'vscode';
import { apiBase, apiKey, attribute, REDEEM_URL, storeApiKey } from './api';
import * as https from 'https';
import { createHash, randomBytes } from 'crypto';
import * as http from 'http';
import { recordExtensionFunnelEvent } from './funnel-events';

const CONSUMER_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
    'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
    'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
    'gmx.com', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'qq.com',
    '163.com', 'naver.com', 'fastmail.com', 'tutanota.com', 'duck.com',
]);

const ANONYMOUS_CLOUD_KEY = 'denpex.anonymousCloudCount';
// The API may require a browser challenge after the first anonymous request.
// VS Code cannot solve that challenge, so promise only the immediate pass here.
const MAX_FREE_ANONYMOUS_CLOUD = 1;

export function getRemainingFreeCloudDiagnoses(context: vscode.ExtensionContext): number {
    if (apiKey()) return 0; // Anonymous passes only. Authenticated allowance comes from quota().
    const used = context.globalState.get<number>(ANONYMOUS_CLOUD_KEY, 0);
    return Math.max(0, MAX_FREE_ANONYMOUS_CLOUD - used);
}

export async function consumeFreeCloudDiagnosis(context: vscode.ExtensionContext): Promise<number> {
    const current = context.globalState.get<number>(ANONYMOUS_CLOUD_KEY, 0);
    const next = current + 1;
    await context.globalState.update(ANONYMOUS_CLOUD_KEY, next);
    return Math.max(0, MAX_FREE_ANONYMOUS_CLOUD - next);
}

export function isConsumerDomain(email: string): boolean {
    const domain = email.split('@').pop()?.trim().toLowerCase() ?? '';
    return CONSUMER_DOMAINS.has(domain);
}

function postJson(urlStr: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const payload = JSON.stringify(body);
        const lib = url.protocol === 'http:' ? http : https;
        const req = lib.request({
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 15000,
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ ok: (res.statusCode || 500) < 400, status: res.statusCode || 500, data: parsed });
                } catch {
                    resolve({ ok: false, status: res.statusCode || 500, data: { message: data } });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Trial request timed out. Try again.')));
        req.write(payload);
        req.end();
    });
}

export interface ExtensionTrialRequestInterpretation {
    kind: 'sent' | 'pending' | 'error';
    message: string;
    recordFunnel: boolean;
}

export function interpretExtensionTrialRequestResult(
    res: { ok: boolean; status: number; data: any },
    email: string,
): ExtensionTrialRequestInterpretation {
    const data = res?.data && typeof res.data === 'object' ? res.data : {};
    const state = String(data.state || data.status || '').trim().toLowerCase();
    const reason = String(data.reason || '').trim().toLowerCase();
    const serverMessage = typeof data.message === 'string' ? data.message.trim() : '';
    const throttled = data.throttled === true || state === 'throttled' || reason === 'throttled';
    const isDeferred =
        throttled ||
        state === 'pending_delivery' ||
        state === 'verification_pending' ||
        reason === 'pending_delivery' ||
        reason === 'verification_pending';

    if (res.ok && data.ok !== false) {
        if (isDeferred || data.sent === false) {
            return {
                kind: 'pending',
                message:
                    serverMessage ||
                    'Your 30-day Team trial request (up to 50 diagnoses/day) is queued or rate-limited. Wait a few minutes before retrying, or contact support@denpex.com. Local diagnosis remains available.',
                recordFunnel: true,
            };
        }
        return {
            kind: 'sent',
            message:
                `We emailed a code to ${email.trim()}. Paste it here to start your 30-day Team trial (50 cloud diagnoses a day) without leaving VS Code. No card or automatic subscription.`,
            recordFunnel: true,
        };
    }

    if (res.status === 429 || res.status >= 500 || isDeferred || state === 'error') {
        return {
            kind: 'pending',
            message:
                serverMessage ||
                'Could not issue a 30-day Datacenter trial right now. Please retry shortly or contact support@denpex.com. Local diagnosis remains available.',
            recordFunnel: false,
        };
    }

    return {
        kind: 'error',
        message: serverMessage || data.error || `Request failed (HTTP ${res.status})`,
        recordFunnel: false,
    };
}

const TRIAL_EMAIL_KEY = 'denpex.trialEmail';
const EMAILED_CODE_RE = /^DPXV-[0-9A-F]{32}$/;

export interface EditorTrialActivationInterpretation {
    kind: 'active' | 'review_pending' | 'account_exists' | 'error';
    message: string;
}

/** Maps the /api/trial/activate-in-editor reply to what the editor does next. */
export function interpretEditorTrialActivation(res: { ok: boolean; status: number; data: any }): EditorTrialActivationInterpretation {
    const data = res?.data && typeof res.data === 'object' ? res.data : {};
    const message = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : '';
    if (res.ok && data.status === 'active') {
        return { kind: 'active', message: message || 'Your 30-day Team trial is active and VS Code is connected.' };
    }
    if (data.status === 'review_pending') {
        return { kind: 'review_pending', message: message || 'Your company is being reviewed. We will email you when the trial is approved.' };
    }
    if (data.status === 'account_exists') {
        return { kind: 'account_exists', message: message || 'This email already has a Denpex account. Use Connect Account to sign in.' };
    }
    return { kind: 'error', message: message || `Trial activation failed (HTTP ${res?.status ?? 'unknown'}).` };
}

/**
 * Finish the work-email trial without leaving the editor: paste the emailed code and
 * this install is connected. The credential is generated here; only its digest is sent.
 */
export async function finishTrialInEditor(context: vscode.ExtensionContext, knownEmail?: string): Promise<boolean> {
    const email = knownEmail?.trim() || await vscode.window.showInputBox({
        title: 'Finish your Denpex trial',
        prompt: 'The work email that received the Denpex code',
        value: context.globalState.get<string>(TRIAL_EMAIL_KEY, ''),
        placeHolder: 'alex@yourcompany.com',
        ignoreFocusOut: true,
    });
    if (!email) return false;
    const code = await vscode.window.showInputBox({
        title: 'Paste the code from your email',
        prompt: `We emailed a code to ${email.trim()}. It starts with DPXV- and is valid for 24 hours.`,
        placeHolder: 'DPXV-...',
        ignoreFocusOut: true,
        validateInput: (val) => EMAILED_CODE_RE.test(val.trim().toUpperCase())
            ? null : 'Paste the whole code from the email. It starts with DPXV- followed by 32 letters and digits.',
    });
    if (!code) return false;

    const key = `dpx_${randomBytes(16).toString('hex')}`;
    let res: { ok: boolean; status: number; data: any };
    try {
        res = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Activating your Denpex trial...',
            cancellable: false,
        }, async () => postJson(`${apiBase()}/api/trial/activate-in-editor`, {
            email: email.trim(),
            code: code.trim().toUpperCase(),
            keyHash: createHash('sha256').update(key).digest('hex'),
            keyDisplay: `${key.slice(0, 8)}...${key.slice(-4)}`,
        }));
    } catch (err: any) {
        void vscode.window.showErrorMessage(`Denpex: could not reach Denpex (${err?.message || 'network error'}). Your code still works; try again.`, 'Try again')
            .then((choice) => { if (choice === 'Try again') void finishTrialInEditor(context, email); });
        return false;
    }

    const outcome = interpretEditorTrialActivation(res);
    if (outcome.kind === 'active') {
        await storeApiKey(context.secrets, key);
        await context.globalState.update(TRIAL_EMAIL_KEY, undefined);
        void recordExtensionFunnelEvent(context, 'account_connected');
        void vscode.commands.executeCommand('denpex.trialConnected');
        void vscode.window.showInformationMessage(
            `Denpex: ${outcome.message} Cloud AI review is now available in VS Code.`, 'Diagnose a log',
        ).then((choice) => { if (choice === 'Diagnose a log') void vscode.commands.executeCommand('denpex.diagnoseCurrentEditor'); });
        return true;
    }
    if (outcome.kind === 'review_pending') {
        await context.globalState.update(TRIAL_EMAIL_KEY, email.trim());
        void vscode.window.showInformationMessage(`Denpex: ${outcome.message} When it is approved, run "Denpex: Finish Trial with Emailed Code" again. Local diagnosis keeps working meanwhile.`);
        return false;
    }
    if (outcome.kind === 'account_exists') {
        void vscode.window.showInformationMessage(`Denpex: ${outcome.message}`, 'Connect Account')
            .then((choice) => { if (choice === 'Connect Account') void vscode.commands.executeCommand('denpex.connectAccount'); });
        return false;
    }
    void vscode.window.showErrorMessage(`Denpex: ${outcome.message}`, 'Try again')
        .then((choice) => { if (choice === 'Try again') void finishTrialInEditor(context, email); });
    return false;
}

export async function startInEditorTrialFlow(_context: vscode.ExtensionContext): Promise<boolean> {
    const email = await vscode.window.showInputBox({
        title: 'Try Denpex Team free for 30 days (50 cloud diagnoses a day)',
        prompt: 'Enter your work email. We email you a code; paste it here and VS Code is set up, no browser needed. No card, no auto-renewal. Local diagnosis stays free and unlimited.',
        placeHolder: 'alex@yourcompany.com',
        ignoreFocusOut: true,
        validateInput: (val) => {
            const trimmed = val.trim();
            if (!trimmed || !trimmed.includes('@') || !trimmed.includes('.')) {
                return 'Enter a valid email address (e.g. name@company.com)';
            }
            if (isConsumerDomain(trimmed)) {
                return 'Team trials require a work email domain (e.g. @company.com, not @gmail.com)';
            }
            return null;
        },
    });

    if (!email) return false;

    const endpoint = `${apiBase()}/api/trial/request`;
    let res: { ok: boolean; status: number; data: any };
    try {
        res = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Requesting Denpex 30-day Team trial...',
            cancellable: false,
        }, async () => postJson(endpoint, { email: email.trim(), source: 'vscode-extension' }));
    } catch (err: any) {
        void vscode.window.showErrorMessage(`Denpex: could not request evaluation (${err?.message || 'network error'})`);
        return false;
    }

    const outcome = interpretExtensionTrialRequestResult(res, email);

    if (outcome.kind === 'error') {
        void vscode.window.showErrorMessage(`Denpex: ${outcome.message}`);
        return false;
    }

    if (outcome.recordFunnel) {
        void recordExtensionFunnelEvent(_context, 'team_trial_requested');
    }

    if (outcome.kind === 'pending') {
        void vscode.window.showInformationMessage(
            `Denpex: ${outcome.message}`,
            'Open Redeem Page', 'Connect Account',
        ).then((choice) => {
            if (choice === 'Connect Account') {
                void vscode.commands.executeCommand('denpex.connectAccount');
            } else if (choice === 'Open Redeem Page') {
                void vscode.env.openExternal(vscode.Uri.parse(attribute(REDEEM_URL, 'trial')));
            }
        });
        return outcome.recordFunnel;
    }

    await _context.globalState.update(TRIAL_EMAIL_KEY, email.trim());
    void vscode.window.showInformationMessage(
        outcome.message,
        'Paste code now', 'Later',
    ).then((choice) => {
        if (choice === 'Paste code now') void finishTrialInEditor(_context, email);
    });
    return true;
}
