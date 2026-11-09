import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { randomBytes } from 'crypto';
import { apiBase, apiKey, CLIENT_VERSION, attribute } from './api';
import { isWorkspaceReadPath, isWorkspaceWriteRequest } from './workspace-paths';

type View = 'fleet' | 'topology';
let panel: vscode.WebviewPanel | undefined;
let activeView: View = 'fleet';

export function readWorkspace(path: string, body?: unknown): Promise<{ status: number; body: string; contentType: string }> {
    if (!(body === undefined ? isWorkspaceReadPath(path) : isWorkspaceWriteRequest(path, body))) return Promise.reject(new Error('Unsupported account read'));
    const key = apiKey();
    if (!key) return Promise.resolve({ status: 401, body: '{"error":"Connect your account to read telemetry."}', contentType: 'application/json' });
    const base = new URL(apiBase());
    const url = new URL(path, base);
    if (url.origin !== base.origin || !['https:', 'http:'].includes(url.protocol)) return Promise.reject(new Error('Invalid API origin'));
    const responseLimit = url.pathname === '/api/monitor/status' && url.searchParams.get('map') === '1' ? 16 * 1024 * 1024 : 2 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'X-Denpex-Key': key, 'User-Agent': `Denpex-VSCode/${CLIENT_VERSION}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, timeout: 30000,
        }, res => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > responseLimit) req.destroy(new Error('Account response exceeded the safe size limit'));
                else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => {
                const status = res.statusCode || 502;
                const raw = Buffer.concat(chunks).toString('utf8');
                let upgradeRequired = false;
                if (status >= 400) {
                    try { upgradeRequired = JSON.parse(raw).code === 'UPGRADE_REQUIRED'; } catch { /* Do not forward upstream error bodies. */ }
                }
                resolve({ status, body: status >= 400 ? JSON.stringify({
                    error: status === 401 ? 'Reconnect your account.' : status === 403 ? 'This credential lacks access. Reconnect your account to approve incident controls, or manage permissions on the website.' : 'Account telemetry is unavailable. Retry later.',
                    ...(upgradeRequired ? { code: 'UPGRADE_REQUIRED' } : {}),
                }) : raw, contentType: String(res.headers['content-type'] || 'application/json') });
            });
        });
        req.on('timeout', () => req.destroy(new Error('Account read timed out')));
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

export async function saveWorkspaceReport(webview: vscode.Webview, message: { name?: unknown; text?: unknown }): Promise<void> {
    if (typeof message.name !== 'string' || !/^[A-Za-z0-9._-]{1,120}\.(csv|json|txt)$/.test(message.name)
        || typeof message.text !== 'string' || Buffer.byteLength(message.text) > 2 * 1024 * 1024) {
        void webview.postMessage({ command: 'workspaceExportStatus', text: 'This report cannot be saved in the editor. Use the website export.' });
        return;
    }
    try {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const destination = await vscode.window.showSaveDialog({
            ...(folder ? { defaultUri: vscode.Uri.joinPath(folder, message.name) } : {}),
            title: `Save ${message.name}`, saveLabel: 'Save Denpex report', filters: { 'Report files': ['csv', 'json', 'txt'] },
        });
        if (destination) await vscode.workspace.fs.writeFile(destination, Buffer.from(message.text, 'utf8'));
        void webview.postMessage({ command: 'workspaceExportStatus', text: destination ? 'Report saved.' : 'Report export canceled.' });
    } catch {
        void webview.postMessage({ command: 'workspaceExportStatus', text: 'The report could not be saved. Choose a writable destination and retry.' });
    }
}

export function openWorkspace(context: vscode.ExtensionContext, view: View): void {
    activeView = view;
    if (!panel) {
        panel = vscode.window.createWebviewPanel('denpex.workspace', 'Denpex Fleet', vscode.ViewColumn.Active, {
            enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        });
        const current = panel;
        context.subscriptions.push(current);
        current.onDidDispose(() => { if (panel === current) panel = undefined; });
        let inFlight = 0;
        current.webview.onDidReceiveMessage(async message => {
            if (!message || typeof message !== 'object') return;
            if (message.command === 'saveWorkspaceReport') {
                await saveWorkspaceReport(current.webview, message);
                return;
            }
            if (message.command === 'readWorkspace' || message.command === 'writeWorkspace') {
                if (typeof message.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(message.id)) return;
                let response = { status: 403, body: '{"error":"Unsupported account read."}', contentType: 'application/json' };
                if ((message.command === 'readWorkspace' ? isWorkspaceReadPath(message.path) : isWorkspaceWriteRequest(message.path, message.body)) && inFlight < 16) {
                    inFlight++;
                    try { response = await readWorkspace(message.path, message.command === 'writeWorkspace' ? message.body : undefined); }
                    catch { response = { status: 502, body: '{"error":"Account read failed. Refresh to retry."}', contentType: 'application/json' }; }
                    finally { inFlight--; }
                }
                void current.webview.postMessage({ command: 'workspaceResponse', id: message.id, ...response });
            } else if (message.command === 'openConsole') {
                await vscode.commands.executeCommand('denpex.openConsole');
            } else if (message.command === 'connectAccount') {
                await vscode.commands.executeCommand('denpex.connectAccount');
                openWorkspace(context, activeView);
            } else if (message.command === 'refreshWorkspace') {
                openWorkspace(context, activeView);
            } else if (message.command === 'prepareWorkspaceEvidence' && typeof message.text === 'string' && Buffer.byteLength(message.text) <= 65536) {
                await vscode.commands.executeCommand('denpex.prepareConsole',message.text);
            } else if (message.command === 'navigateWorkspace' && typeof message.path === 'string') {
                let url: URL;
                try { url = new URL(message.path, 'https://denpex.com'); } catch { return; }
                if (url.origin !== 'https://denpex.com') return;
                if (url.pathname === '/fleet' || url.pathname === '/topology') openWorkspace(context, url.pathname.slice(1) as View);
                else if (url.pathname === '/console' && url.searchParams.has('open')) await vscode.commands.executeCommand('denpex.openCloudReport', url.searchParams.get('open'));
                else if (url.pathname === '/console' || (url.pathname === '/dashboard' && (!url.search || url.searchParams.get('tab') === 'console'))) await vscode.commands.executeCommand('denpex.openConsole');
                else await vscode.env.openExternal(vscode.Uri.parse(attribute(url.href, 'panel')));
            }
        }, undefined, context.subscriptions);
    }
    panel.title = view === 'fleet' ? 'Denpex Fleet' : 'Denpex Topology';
    const nonce = randomBytes(24).toString('hex');
    const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'workspace.js'));
    const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'workspace.css'));
    panel.webview.html = `<!DOCTYPE html><html lang="en" data-view="${view}" data-connected="${!!apiKey()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body><nav class="workspace-toolbar" aria-label="Denpex workspace"><strong>Denpex ${view === 'fleet' ? 'Fleet' : 'Topology'}</strong><button type="button" id="console-link">Console</button><button type="button" id="connect-account">Connect Account</button><button type="button" id="refresh-workspace">Refresh</button></nav><p class="workspace-notice">${apiKey() ? "Connected account workspace. Incident actions use your approved permissions; recovery is never inferred from silence." : "No account connected. Connect to view reported fleet data. Local diagnosis remains free and available."}</p><div id="workspace-root"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    panel.reveal();
}
