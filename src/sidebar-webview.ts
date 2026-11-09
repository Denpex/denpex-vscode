import * as vscode from 'vscode';
import { DENPEX_WORDMARK_HTML, DENPEX_WORDMARK_CSS } from './brand';
import { SAMPLE_FAILURES } from './samples';
import { DenpexSidebarProvider } from './sidebar';

const html = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export class DenpexSidebarWebview implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;

    constructor(private readonly history: DenpexSidebarProvider, private readonly localReady: boolean, private readonly offerTrial: () => boolean = () => true) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage((message: { action?: string; id?: string }) => {
            const commands: Record<string, string> = {
                console: 'denpex.openConsole',
                clipboard: 'denpex.diagnoseClipboard',
                current: 'denpex.diagnoseCurrentLogs',
                workspace: 'denpex.scanClusterLogs',
                artifact: 'denpex.inspectGpuArtifact',
                cloudHistory: 'denpex.cloudHistory',
                connect: 'denpex.connectAccount',
                fleet: 'denpex.openFleet',
                topology: 'denpex.openTopology',
                trial: 'denpex.startInEditorTrial',
                privacy: 'denpex.showPrivacyStatus',
                saved: 'denpex.reopenSaved',
                deleteSaved: 'denpex.deleteSaved',
            };
            if (message.action && commands[message.action]) void vscode.commands.executeCommand(commands[message.action]);
            if (message.action === 'sample' && SAMPLE_FAILURES.some((sample) => sample.id === message.id)) {
                void vscode.commands.executeCommand('denpex.runSample', message.id);
            }
            if (message.action === 'recent' && this.history.openRecent(message.id || '')) {
                void vscode.commands.executeCommand('denpex.openRecent', message.id);
            }
        });
        view.onDidDispose(() => { this.view = undefined; });
        this.refresh();
    }

    refresh(): void {
        if (!this.view) return;
        const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const samples = SAMPLE_FAILURES.slice(1).map((sample) => `<button class="row" data-action="sample" data-id="${html(sample.id)}"><span>${html(sample.title)}</span><span aria-hidden="true">›</span></button>`).join('');
        const recent = this.history.getChildren().find((item) => item.id === 'recent');
        const records = recent ? this.history.getChildren(recent) : [];
        const history = records.length && records[0].command
            ? records.map((record) => {
                const id = String(record.command?.arguments?.[0] || '');
                const available = Boolean(this.history.openRecent(id));
                return `<button class="row" data-action="recent" data-id="${html(id)}" ${available ? '' : 'disabled title="Only report metadata is saved between sessions"'}><span>${html(record.label)}</span><small>${available ? 'Open report' : 'Previous session'}</small></button>`;
            }).join('')
            : '<p class="empty">Your diagnoses will appear here after you run one.</p>';
        this.view.webview.html = `<!DOCTYPE html><html lang="en"><head><title>Denpex investigations</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
            ${DENPEX_WORDMARK_CSS}*{box-sizing:border-box}body{margin:0;padding:0 0 28px;background:#151515;color:#E5E5E5;font:12.5px/1.5 var(--vscode-font-family)}body.vscode-light{background:var(--vscode-sideBar-background);color:var(--vscode-foreground)}button{font:inherit;cursor:pointer}button:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}.topbar{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 16px;border-bottom:1px solid #262626;background:#151515}.wrap{padding:16px 14px 0}.eyebrow,h2{font:500 11px/1.2 var(--vscode-font-family);letter-spacing:.05em;text-transform:uppercase;color:#8E8E8E}.eyebrow{color:var(--denpex-accent-text,#D6795C)}h1{font-size:16px;font-weight:600;letter-spacing:-.01em;line-height:1.25;margin:0 0 4px;color:#E5E5E5}h2{margin:0 0 8px}p{margin:0;color:#8E8E8E;font-size:12px}header.hero{border:1px solid rgba(204,90,55,.32);border-radius:12px;padding:14px 15px;margin-bottom:18px;background:#1C1C1C}.primary,.option{display:block;width:100%;text-align:left;border-radius:10px;padding:10px 12px;margin-bottom:8px;color:#E5E5E5;transition:background .15s ease,border-color .15s ease}.primary{border:1px solid rgba(204,90,55,.45);background:#231915;color:#E5E5E5;font-weight:600}.primary:hover{background:#2C1E19;border-color:#D6795C}.option{border:1px solid #333333;background:#1C1C1C}.option:hover,.row:hover{background:#242424;border-color:#3F3F3F}small{display:block;font-size:11px;font-weight:400;color:#8E8E8E;margin-top:2px}.section{margin-top:20px}.row{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;padding:8px 4px;border:0;border-bottom:1px solid #262626;background:transparent;color:#D4D4D4;text-align:left;font-size:12px}.row:disabled{cursor:default;opacity:.6}.row small{white-space:nowrap;color:#22C55E;font-family:ui-monospace,monospace}.empty{border:1px solid #2B2B2B;border-radius:10px;padding:12px;background:#1C1C1C}details{border-top:1px solid #262626;margin-top:18px;padding-top:12px}summary{cursor:pointer;font-weight:500;color:#D4D4D4}.link{display:block;border:0;background:transparent;color:var(--denpex-accent-text,#D6795C);padding:6px 0;text-align:left;font-size:12px}.privacy{margin-top:18px;font-size:11px;color:#8E8E8E}.privacy button{border:0;background:transparent;color:var(--denpex-accent-text,#D6795C);padding:0;text-decoration:underline}
        :root{--denpex-accent-text:#D6795C}.vscode-light{--denpex-accent-text:#9e351d}.status{display:inline-flex;align-items:center;gap:6px;color:#D4D4D4;font-size:11px}.status::before{content:'';width:6px;height:6px;border-radius:50%;background:#22C55E}.status.unavailable::before{background:#F87171}.source-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.source-grid .option{margin:0;min-height:74px}.source-grid strong{display:block;font-size:12px;font-weight:600;color:#E5E5E5}.source-grid small{font-size:11px}.sample-card{border:1px solid #333333;border-radius:12px;padding:14px;margin-top:10px;background:#1C1C1C}.sample-card strong{display:block;margin:4px 0;color:#E5E5E5;font-size:13px}.sample-card p{font-size:12px}.sample-path{display:flex;gap:6px;align-items:center;margin:10px 0;color:#BDBDBD;font:11px/1.2 ui-monospace,monospace;flex-wrap:wrap}.sample-path span{border:1px solid #333333;background:#181818;border-radius:6px;padding:3px 7px}.sample-card button{border:1px solid rgba(204,90,55,.4);border-radius:8px;background:transparent;color:#E5E5E5;padding:6px 11px;font-size:12px;font-weight:500}.sample-card button:hover{background:#2B2B2B;border-color:#D6795C}.sample-card button:focus-visible{outline:2px solid var(--vscode-focusBorder)}.sample-other{margin-top:10px;border:0;padding:0}.sample-other summary{color:var(--denpex-accent-text,#D6795C);font-size:12px}.cloud-note{margin:10px 0}.primary small{color:#B8A39C}.source-grid{grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}button,summary,p,h1,strong{overflow-wrap:anywhere}.row:focus-visible{outline:2px solid var(--vscode-focusBorder)}
        @media(forced-colors:active){body,body *{color:CanvasText!important;background-color:Canvas!important;opacity:1!important}button{color:ButtonText!important;background-color:ButtonFace!important;border:1px solid ButtonText!important}}</style></head><body>
        <div class="topbar">${DENPEX_WORDMARK_HTML}<span class="status${this.localReady ? '' : ' unavailable'}">${this.localReady ? 'Local engine' : 'Unavailable'}</span></div>
        <div class="wrap">
        <header class="hero"><h1>Find what failed first.</h1><p style="margin-bottom:6px"><strong style="color:#E5E5E5">Free local diagnosis. No account required.</strong></p><p>${this.localReady ? 'For CUDA, NCCL, Xid, Slurm, and inference failures. See the initiating rank or node, evidence, and next safe step.' : 'The bundled local engine could not start. Reinstall the extension or check the extension host logs.'}</p></header>
        <section class="section" aria-labelledby="start-title"><h2 id="start-title">Start a diagnosis</h2><button class="primary" data-action="console">+ Open Denpex console<small>Paste logs, inspect evidence, and ask local follow-ups</small></button><button class="option" data-action="clipboard"><strong>Diagnose copied log</strong><small>Use the error already in your clipboard</small></button><div class="source-grid"><button class="option" data-action="current"><strong>Editor or terminal</strong><small>Use a selection, open log, or terminal output</small></button><button class="option" data-action="workspace"><strong>Workspace logs</strong><small>Find Slurm output, or choose a log file</small></button></div><button class="option" data-action="artifact" style="margin-top:8px"><strong>Inspect a GPU artifact locally (0 Chrome lag)</strong><small>Flight Recorder dump, &gt;1GB CUDA memory snapshot, Nsight trace, or checkpoint</small></button></section>
        <section class="section" aria-labelledby="sample-title"><h2 id="sample-title">See how it works</h2><div class="sample-card"><span class="eyebrow">BUNDLED INCIDENT</span><strong>OOM before NCCL timeout</strong><p>Rank 3 runs out of memory. Other ranks report watchdog timeouts 30 minutes later.</p><div class="sample-path"><span>Rank 3: OOM</span><span aria-hidden="true">→</span><span>Ranks 0 to 2: timeout</span></div><button data-action="sample" data-id="nccl-rank-oom">Diagnose sample</button></div><details class="sample-other"><summary>Other sample failures</summary>${samples}</details></section>
        <section class="section" aria-labelledby="recent-title"><h2 id="recent-title">Recent diagnoses</h2>${history}<button class="link" data-action="saved">Reopen saved investigation</button><button class="link" data-action="deleteSaved">Delete a saved report</button></section>
        <section class="section" aria-labelledby="workspace-title"><h2 id="workspace-title">Connected workspace</h2><p>Inspect account incidents and reported GPU telemetry alongside your local investigation. Requires an eligible account and connected agents.</p><div class="source-grid" style="margin-top:10px"><button class="option" data-action="fleet"><strong>Fleet incidents</strong><small>Evidence, ownership and recovery state</small></button><button class="option" data-action="topology"><strong>GPU host map</strong><small>Clusters, hosts and device readings</small></button></div><button class="link" data-action="connect">Connect an existing account</button></section>${this.offerTrial() ? `<section class="sample-card" aria-labelledby="evaluation-title"><h2 id="evaluation-title">Try the team workflow</h2><p>Local single-log diagnosis stays unlimited and free. Team ($499/mo, up to 128 GPUs), Scale ($2,999/mo, up to 1,024 GPUs), Growth ($5,499/mo, up to 4,096 GPUs) &amp; Data Center add 24/7 autonomous multi-rank correlation, Slack #cluster-alerts pre-triage, and VRAM Zombie Chargeback.</p><button data-action="trial">Start 30-day Team trial in editor</button><p style="margin-top:8px">Enter your work email right inside VS Code (no browser or credit card required). After the trial, free local diagnosis continues.</p></section>` : ''}<details><summary>More investigation tools</summary><p class="cloud-note">Optional cloud review sends a log only when you choose it.</p><button class="link" data-action="cloudHistory">Shared cloud history</button></details><p class="privacy">Local diagnosis stays on this machine. <button data-action="privacy">Privacy details</button></p></div>
        <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button&&!button.disabled)vscode.postMessage({action:button.dataset.action,id:button.dataset.id});});</script></body></html>`;
    }
}


