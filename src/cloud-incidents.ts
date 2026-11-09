import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { apiBase, apiKey, cloudIncidents, SITE_URL } from './api';

/** Poll account-owned reports without uploading editor content or executing fixes. */
export function monitorCloudIncidents(context: vscode.ExtensionContext): vscode.Disposable & { pollNow: () => Promise<void> } {
    let disposed = false;
    let busy = false;
    const poll = async () => {
        const key = apiKey();
        if (disposed || busy || !key) return;
        busy = true;
        const identity = createHash('sha256').update(`${apiBase()}\n${key}`).digest('hex');
        const stateKey = `denpex.cloudIncidents.${identity}`;
        try {
            const seen = new Set(context.globalState.get<string[]>(stateKey, []));
            const response = await cloudIncidents();
            if (disposed || apiKey() !== key) return;
            const rows = (response.history || []).filter(row => /^[a-zA-Z0-9_-]{8,64}$/.test(row.id));
            const fresh = rows.filter(row => !seen.has(row.id));
            for (const row of fresh) seen.add(row.id);
            if (!fresh.length) return;
            await context.globalState.update(stateKey, [...seen].slice(-500));
            const row = fresh[0]!;
            const actionLabel = fresh.length === 1 ? 'Open analysis' : 'Open dashboard';
            const message = fresh.length === 1
                ? `Denpex: diagnosis ready for ${row.job_name || 'your workload'} (${row.failure_type || 'incident'}). ${row.repair_verified === true ? 'Workload recovery verified.' : 'Recovery is not yet verified.'}`
                : `Denpex: ${fresh.length} cloud diagnoses are available. Open the reports for individual recovery status.`;
            void vscode.window.showInformationMessage(message, actionLabel).then(action => {
                if (action === actionLabel) void vscode.env.openExternal(vscode.Uri.parse(fresh.length === 1 ? `${SITE_URL}/console?open=${encodeURIComponent(row.id)}` : `${SITE_URL}/dashboard?tab=history`));
            });
        } catch {
            // Retry on the next interval. Never record undelivered rows after a failed fetch.
        } finally { busy = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 60_000);
    return Object.assign(new vscode.Disposable(() => { disposed = true; clearInterval(timer); }), { pollNow: poll });
}
