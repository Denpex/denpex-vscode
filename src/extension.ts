import { clarificationChoices } from './clarification-contract';
import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { previewCloudPayload, assessmentComparison } from './cloud-review';
import { savePendingReview, readPendingReview, clearPendingReview } from './pending-review';
import { prepareLocalFeedback, submitObservedCloudFeedback } from './local-feedback';
import { ClipboardCoordinator } from './clipboard-coordinator';
import { inspectGpuArtifact } from './artifacts';
import { connectAccount, disconnectAccount } from './connect';
import {
    ApiError, DiagnoseResponse, MAX_LOG_BYTES, MIN_LOG_CHARS,
    DASHBOARD_URL, PRICING_URL, REDEEM_URL, PRIVACY_URL, SITE_URL, attribute,
    apiBase, apiKey, askFollowup, diagnose, initializeApiKey, quota, redeem, redeemStatus, storeApiKey, cloudHistory, accountStatus, readCloudReport,
} from './api';
import { generateIncidentMarkdown, showDiagnosisPanel } from './panel';
import { PredictiveMonitor } from './predictive';
import { monitorCloudIncidents } from './cloud-incidents';
import { runGenerateRmaCommand } from './rma';
import { diagnoseLocally, initLocalEngine, localEngineAvailable, LocalEngineError } from './local-engine';
import { SAMPLE_FAILURES, sampleFailure } from './samples';
import { DenpexSidebarProvider } from './sidebar';
import { DenpexSidebarWebview } from './sidebar-webview';
import { selectEvidenceForRequest } from './evidence';
import { DenpexTerminalLinkProvider } from './terminal-links';
import { answerLocalFollowUp } from './local-follow-up';
import { saveInvestigation, chooseSavedInvestigation } from './saved-investigations';
import { openWorkspace } from './workspace';
import { manageExtensionFunnelConsent, offerExtensionFunnelConsent, recordExtensionFunnelEvent } from './funnel-events';
import {
    consumeFreeCloudDiagnosis, getRemainingFreeCloudDiagnoses, startInEditorTrialFlow,
} from './trial-flow';

let monitor: PredictiveMonitor | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let lastDiagnosis: DiagnoseResponse | undefined;
let lastLogs: string | undefined;
const clarificationConversations=new Map<string,string>();
let clarificationBusy=false;
let pendingClarification:{result:DiagnoseResponse;logs:string;facts:string[]}|undefined;
let remediationTerminal: vscode.Terminal | undefined;
let sidebarProvider: DenpexSidebarProvider | undefined;
let extContext: vscode.ExtensionContext | undefined;
let verifiedTrialKey: string | undefined;
let verifiedTrialEligibility = false;
const incidentLogs = new WeakMap<DiagnoseResponse, string>();
const precedingReports = new WeakMap<DiagnoseResponse, DiagnoseResponse>();
let activeReport: DiagnoseResponse | undefined;
let incidentGeneration = 0;
let cloudReviewInFlight = false;
const FIRST_RUN_AHA_KEY = 'denpex.firstRunAha.v1';

export async function activate(context: vscode.ExtensionContext) {
    extContext = context;
    await readPendingReview(context);
    await vscode.commands.executeCommand('setContext', 'denpex.ownLogDiagnosed', false);
    try {
        await initializeApiKey(context.secrets);
    } catch {
        // Local diagnosis must remain available even when the OS credential store
        // is unavailable. Never fall back to a plaintext setting.
        void vscode.window.showWarningMessage(
            'Denpex could not access VS Code SecretStorage. Local diagnosis remains available, but cloud features are disabled until secure credential storage is available.',
        );
    }
    // Resolve the bundled offline engine before anything can ask for it. This is what
    // makes the extension useful with no account and no network; see local-engine.ts.
    initLocalEngine(context);

    sidebarProvider = new DenpexSidebarProvider(context);
    const sidebarWebview = new DenpexSidebarWebview(sidebarProvider, localEngineAvailable(), () => !apiKey() || (verifiedTrialKey === apiKey() && verifiedTrialEligibility));
    sidebarProvider.onRefresh = () => sidebarWebview.refresh();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('denpex.sidebar', sidebarWebview),
    );

    // ── Predictive pre-crash detection (terminal shell integration) ──
    monitor = new PredictiveMonitor((logs, terminalName) => {
        void runDiagnosis(logs, `pre-crash: ${terminalName}`);
    });
    monitor.start();
    context.subscriptions.push(monitor);
    const cloudMonitor = monitorCloudIncidents(context);
    context.subscriptions.push(cloudMonitor);

    // ── Status bar: plan + remaining quota ──
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusItem.text = 'Denpex';
    statusItem.tooltip = 'Denpex ML Diagnostics, click for menu';
    statusItem.command = 'denpex.showStatusBarMenu';
    statusItem.show();
    context.subscriptions.push(statusItem);
    void refreshStatusBar();

    const register = (id: string, fn: (...args: any[]) => any) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    register('denpex.reopenSaved', async () => {
        try {
            const saved = await chooseSavedInvestigation(context);
            if (saved) { lastDiagnosis = saved; lastLogs = undefined; openPanel(saved); }
        } catch (error) { void vscode.window.showErrorMessage(`Denpex could not reopen the report: ${error instanceof Error ? error.message : 'unknown error'}`); }
    });
    register('denpex.deleteSaved', async () => {
        try { await chooseSavedInvestigation(context, true); }
        catch (error) { void vscode.window.showErrorMessage(`Denpex could not delete the report: ${error instanceof Error ? error.message : 'unknown error'}`); }
    });

    const diagnoseCollectedLogs = async () => {
        const logs = await collectLogs();
        if (!logs) return;
        await runDiagnosis(logs.text, 'local-ide-run', logs.topologyMap);
    };

    register('denpex.diagnoseCurrentLogs', diagnoseCollectedLogs);
    register('denpex.inspectGpuArtifact', async () => {
        const evidence = await inspectGpuArtifact(context);
        if (evidence) await runLocalDiagnosisWithProgress(evidence, 'gpu-artifact');
    });
    register('denpex.cloudHistory', async () => {
        if (!apiKey()) {
            void vscode.window.showInformationMessage('Connect your Denpex account to read shared cloud history. Local results stay on this machine.');
            return;
        }
        try {
            let cursor: string | undefined;
            while (true) {
                const page = await cloudHistory(cursor);
                const items = page.history.map((row) => ({ label: row.job_name || row.failure_type || 'Saved diagnosis',
                    description: row.created_at ? new Date(row.created_at).toLocaleString() : '',
                    detail: row.fix_summary || '', row, more: false }));
                if (page.nextCursor) items.push({ label: 'Load older diagnoses', description: '', detail: '', row: { id: '' }, more: true });
                if (!items.length) { void vscode.window.showInformationMessage('No cloud diagnoses are saved for this account. Choose cloud review to save a local result.'); return; }
                const selected = await vscode.window.showQuickPick(items, { title: 'Denpex: Shared Cloud History' });
                if (!selected) return;
                if (selected.more) { cursor = page.nextCursor || undefined; continue; }
                const row = selected.row;
                const document = await vscode.workspace.openTextDocument({ language: 'plaintext',
                    content: `${row.job_name || 'Denpex diagnosis'}\n${row.failure_type || ''}\n\n${row.fix_summary || ''}\n\n${row.fix_action || ''}\n\nCloud diagnosis ID: ${row.id}` });
                await vscode.window.showTextDocument(document);
                return;
            }
        } catch (error) {
            void vscode.window.showErrorMessage(`Could not read shared history: ${error instanceof Error ? error.message : 'Retry after reconnecting.'}`);
        }
    });


    register('denpex.openCloudReport', async (id: string) => {
        try { const saved = await readCloudReport(id); lastDiagnosis = saved; lastLogs = undefined; openPanel(saved); }
        catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not open the saved investigation.'); }
    });

    register('denpex.openConsole', () => openPanel(lastDiagnosis));
    register('denpex.prepareConsole', (text: unknown) => {
        if (typeof text === 'string' && Buffer.byteLength(text) <= 65536) openPanel(undefined, undefined, text);
    });
    register('denpex.openFleet', () => openWorkspace(context, 'fleet'));
    register('denpex.openTopology', () => openWorkspace(context, 'topology'));

    const clipboard = new ClipboardCoordinator<DiagnoseResponse>();
    const clipboardScope = () => [apiKey() || 'local', vscode.workspace.getConfiguration('denpex').get<string>('engine') || 'auto', vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()).join('|') || ''].join('\n');
    register('denpex.diagnoseClipboard', async () => {
        const text = (await vscode.env.clipboard.readText()).trim();
        if (text.length < MIN_LOG_CHARS) { void vscode.window.showInformationMessage('Copy a traceback or error first. The clipboard has fewer than six characters.'); return; }
        const scope = clipboardScope();
        const key = createHash('sha256').update(scope).update('\n').update(text).digest('hex');
        await clipboard.run(key, {
            alreadyRunning: () => { void vscode.window.showInformationMessage('Your copied log is already being analyzed. Wait for the current report.'); },
            reopen: report => { lastDiagnosis = report.result; lastLogs = report.logs; openPanel(report.result); },
            confirmReanalysis: async () => (await vscode.window.showInformationMessage('This copied log already has a report. Reopened it without creating another.', 'Analyze again')) === 'Analyze again',
            analyze: async () => {
                const previous = lastDiagnosis;
                await runDiagnosis(text, 'clipboard');
                return lastDiagnosis && lastDiagnosis !== previous && lastLogs === selectEvidenceForRequest(text, MAX_LOG_BYTES).text && clipboardScope() === scope ? { result: lastDiagnosis, logs: lastLogs } : undefined;
            },
        });
    });

    register('denpex.scanClusterLogs', async () => {
        const files = await vscode.workspace.findFiles('**/{slurm-*.out,slurm-*.err,*.log,*.out}', '**/node_modules/**', 25);
        if (!files.length) {
            const choice = await vscode.window.showInformationMessage(
                vscode.workspace.workspaceFolders?.length
                    ? 'Denpex found no Slurm output or .log/.out files in the open workspace. Choose a log file from another folder, or diagnose a copied error.'
                    : 'Open a project folder to search workspace logs, or choose a log file directly.',
                'Choose log file', 'Diagnose copied log',
            );
            if (choice === 'Choose log file') {
                const selected = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    canSelectFolders: false,
                    openLabel: 'Diagnose this log',
                    filters: { 'Log files': ['log', 'out', 'err', 'txt'], 'All files': ['*'] },
                });
                if (selected?.[0]) {
                    const doc = await vscode.workspace.openTextDocument(selected[0]);
                    await runDiagnosis(doc.getText(), 'selected-log-file');
                }
            } else if (choice === 'Diagnose copied log') {
                await vscode.commands.executeCommand('denpex.diagnoseClipboard');
            }
            return;
        }
        const picked = await vscode.window.showQuickPick(
            files.map((uri) => ({
                label: uri.path.split('/').pop() || uri.fsPath,
                description: vscode.workspace.asRelativePath(uri),
                uri,
            })),
            { placeHolder: 'Select a cluster/Slurm log file to diagnose:' },
        );
        if (picked) {
            const doc = await vscode.workspace.openTextDocument(picked.uri);
            await runDiagnosis(doc.getText(), `cluster:${picked.label}`);
        }
    });

    register('denpex.showStatusBarMenu', async () => {
        const remaining = extContext ? getRemainingFreeCloudDiagnoses(extContext) : 0;
        const hasKey = Boolean(apiKey());
        const cloudLabel = hasKey ? 'Plan Quota Active' : `${remaining} free passes remaining`;

        const picked = await vscode.window.showQuickPick([
            { label: '$(clippy) Paste & Diagnose Clipboard', description: 'Ctrl+Alt+D / Cmd+Alt+D', cmd: 'denpex.diagnoseClipboard' },
            { label: '$(terminal) Diagnose Terminal Error', description: 'Diagnose latest terminal traceback', cmd: 'denpex.diagnoseTerminal' },
            { label: '$(search) Scan Workspace for Slurm/Cluster Logs', description: 'Find slurm-*.out and GPU error logs', cmd: 'denpex.scanClusterLogs' },
            { label: '$(cloud) Run Cloud Deep Reasoning', description: cloudLabel, cmd: 'denpex.diagnoseCloud' },
            { label: '$(beaker) Try a Demo Failure', description: 'NCCL OOM cascade, Xid 79, vLLM cache', cmd: 'denpex.runSample' },
            { label: '$(rocket) Try Team Free for 30 Days', description: 'Enter your work email in VS Code; activate from the emailed link', cmd: 'denpex.startInEditorTrial' },
            { label: '$(account) Connect Account', description: 'Approve in your browser; no API key copying', cmd: 'denpex.connectAccount' },
            ...(hasKey ? [{ label: '$(sign-out) Disconnect Account', description: 'Revoke this credential; keep local diagnosis', cmd: 'denpex.disconnectAccount' }] : []),
            { label: '$(key) Set API Key (advanced)', description: 'For self-hosted endpoints or manual setup', cmd: 'denpex.setApiKey' },
            { label: '$(graph) Anonymous Step Counts', description: 'Optional analytics consent; no logs or email', cmd: 'denpex.manageAnalytics' },
        ], { placeHolder: 'Denpex GPU & ML Crash Diagnostics' });

        if (picked && picked.cmd) {
            await vscode.commands.executeCommand(picked.cmd);
        }
    });

    register('denpex.diagnoseCloud', async () => {
        // Escalate the log that was just diagnosed locally. Requiring a prior diagnosis
        // keeps the mental model straight: local answers first, cloud deepens it.
        if (!lastLogs) {
            vscode.window.showInformationMessage(
                'Run Denpex: Diagnose Terminal Error first, then deep reasoning can build on that result.',
            );
            return;
        }
        await escalateToCloud(lastLogs, 'cloud-escalation', undefined, lastDiagnosis);
    });
    register('denpex.manageAnalytics', async () => {
        if (extContext) await manageExtensionFunnelConsent(extContext);
    });

    register('denpex.diagnoseTerminal', diagnoseCollectedLogs);

    register('denpex.diagnoseSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showInformationMessage('Select the traceback or GPU/ML error you want Denpex to diagnose.');
            return;
        }
        const previousDiagnosis = lastDiagnosis;
        await runDiagnosis(editor.document.getText(editor.selection), 'editor-selection');
        if (lastDiagnosis !== previousDiagnosis) {
            await vscode.commands.executeCommand('setContext', 'denpex.ownLogDiagnosed', true);
        }
    });

    register('denpex.diagnoseCurrentEditor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Open a .log.out, or traceback, then run this action again.');
            return;
        }
        const text = editor.selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(editor.selection);
        await runDiagnosis(text, `editor:${editor.document.fileName.split(/[\\/]/).pop() || 'log'}`);
    });

    register('denpex.diagnoseLastFailure', async () => {
        const coalesced = coalesceTerminalBuffers();
        if (coalesced) {
            await runDiagnosis(coalesced.text, 'terminal-context-last-failure', coalesced.topologyMap);
            return;
        }
        vscode.window.showInformationMessage(
            'Denpex has not captured terminal output yet. Run the failing command in a VS Code terminal, or select its traceback in the editor.',
        );
    });

    register('denpex.diagnoseAllTerminals', async () => {
        const coalesced = coalesceTerminalBuffers();
        if (!coalesced) {
            vscode.window.showInformationMessage(
                'Denpex: no terminal output captured yet. Run your training command in a VS Code terminal (shell integration required), then try again.');
            return;
        }
        await runDiagnosis(coalesced.text, 'multi-node-run', coalesced.topologyMap);
    });

    const runSampleById = async (id: string) => {
        const sample = sampleFailure(id);
        if (!sample) {
            vscode.window.showErrorMessage(`Denpex sample "${id}" is not available in this build.`);
            return;
        }
        if (localEngineAvailable()) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Diagnosing sample "${sample.title}" locally...`,
                cancellable: true,
            }, async (_p, token) => {
                try {
                    const result = await diagnoseLocally(sample.logs, `sample:${sample.id}`, token);
                    lastDiagnosis = result;
                    lastLogs = sample.logs;
                    openPanel(result);
                    void sidebarProvider?.recordLocal(result);
                    void refreshStatusBar();
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Denpex sample diagnosis failed: ${err?.message || err}`);
                }
            });
            return;
        }
        await runDiagnosis(sample.logs, `sample:${sample.id}`);
    };

    register('denpex.runSample', async (id?: string) => {
        if (id) {
            await runSampleById(id);
            return;
        }
        const picked = await vscode.window.showQuickPick(
            SAMPLE_FAILURES.map((sample) => ({
                label: sample.title,
                description: sample.description,
                id: sample.id,
            })),
            { placeHolder: 'Choose a realistic failure to diagnose locally' },
        );
        if (picked) await runSampleById(picked.id);
    });
    register('denpex.sample.ncclOom', () => runSampleById('nccl-rank-oom'));
    register('denpex.sample.xid79', () => runSampleById('xid-79'));
    register('denpex.sample.interfaceMismatch', () => runSampleById('nccl-interface-mismatch'));
    register('denpex.sample.kubernetesPlugin', () => runSampleById('kubernetes-device-plugin'));
    register('denpex.sample.vllmKvCache', () => runSampleById('vllm-kv-cache'));

    register('denpex.walkthrough.inspectCausality', async () => {
        if (!lastDiagnosis) await runSampleById('nccl-rank-oom');
        if (lastDiagnosis) openPanel(lastDiagnosis, 'causal-chain');
    });
    register('denpex.walkthrough.inspectFix', async () => {
        if (!lastDiagnosis) await runSampleById('nccl-rank-oom');
        if (lastDiagnosis) openPanel(lastDiagnosis, 'recommended-actions');
    });
    register('denpex.showPrivacyStatus', async () => {
        const choice = await vscode.window.showInformationMessage(
            localEngineAvailable()
                ? 'Denpex local diagnosis is ready: unlimited, offline, and account-free. Logs leave this machine only when you explicitly choose cloud deep reasoning.'
                : 'This build is missing the bundled local engine. Do not diagnose sensitive logs until you install a complete Marketplace build.',
            'Open Privacy Policy',
        );
        if (choice) vscode.env.openExternal(vscode.Uri.parse(attribute(PRIVACY_URL, 'privacy-notice')));
    });
    context.subscriptions.push(
        vscode.window.registerTerminalLinkProvider(
            new DenpexTerminalLinkProvider((_t, lineText) => {
                if (lineText && lineText.trim().length >= MIN_LOG_CHARS) {
                    void runDiagnosis(lineText.trim(), 'terminal-link');
                } else {
                    void diagnoseCollectedLogs();
                }
            }),
        ),
    );

    register('denpex.resumePendingReview', resumePendingReview);
    register('denpex.discardPendingReview', async () => { await clearPendingReview(context); });
    register('denpex.startInEditorTrial', async () => {
        if (extContext) await startInEditorTrialFlow(extContext);
    });
    register('denpex.copyIncidentReport', async () => {
        if (lastDiagnosis) {
            const md = generateIncidentMarkdown(lastDiagnosis);
            await vscode.env.clipboard.writeText(md);
            void vscode.window.showInformationMessage('Denpex: Copied incident post-mortem for Slack / PR to clipboard.');
        } else {
            void vscode.window.showInformationMessage('No active diagnosis to copy. Run a diagnosis first.');
        }
    });
    register('denpex.startTrial', async () => {
        if (extContext) await startInEditorTrialFlow(extContext);
    });
    register('denpex.connectAccount', async () => {
        await connectAccount(context);
        sidebarProvider?.refresh();
        void refreshStatusBar();
        if (apiKey() && context.globalState.get('denpex.pendingReviewAvailable')) await resumePendingReview();
    });
    register('denpex.disconnectAccount', async () => {
        await disconnectAccount(context);
        sidebarProvider?.refresh();
        void refreshStatusBar();
    });
    register('denpex.openRecent', (id: string) => {
        const recent = sidebarProvider?.openRecent(id);
        if (recent) {
            lastDiagnosis = recent;
            lastLogs = undefined;
            openPanel(recent);
        } else {
            vscode.window.showInformationMessage(
                'Denpex kept only privacy-safe metadata for this older diagnosis. Run the log again to recreate the report.',
            );
        }
    });

    register('denpex.setApiKey', async () => {
        const entered = await vscode.window.showInputBox({
            title: 'Connect Denpex Cloud to VS Code',
            prompt: 'Create a key in Dashboard > Monitoring > API Keys, copy it once, then paste it here. VS Code stores it in SecretStorage.',
            placeHolder: 'dpx_...',
            ignoreFocusOut: true,
            password: true,
            value: apiKey() || '',
        });
        if (entered === undefined) {
            if (!apiKey()) {
                await vscode.window.showInformationMessage(
                    'To connect an approved Team evaluation or existing eligible plan, run Denpex: Connect Account. Manual API keys are an advanced fallback.',
                );
            }
            return;
        }
        try {
            await storeApiKey(context.secrets, entered);
        } catch {
            vscode.window.showErrorMessage(
                'Denpex could not save the API key securely. The key was not stored; local diagnosis is still available.',
            );
            return;
        }
        if (!entered.trim()) {
            vscode.window.showInformationMessage('Denpex: API key cleared.');
            return;
        }
        try {
            const q = await quota();
            vscode.window.showInformationMessage(
                `Denpex: key verified, ${q.plan || 'free'} plan${typeof q.remaining === 'number' && isFinite(q.remaining) ? `, ${q.remaining} diagnoses left today` : ', unlimited diagnoses'}.`);
        } catch (err: any) {
            vscode.window.showWarningMessage(`Denpex: key saved but could not be verified (${err.message}).`);
        }
        void refreshStatusBar();
    });

    register('denpex.redeemCode', async () => {
        const code = await vscode.window.showInputBox({
            prompt: 'Enter your Denpex trial code (e.g. DPX-XXXX-XXXX)',
            placeHolder: 'DPX-...',
            ignoreFocusOut: true,
        });
        if (!code) return;
        if (!apiKey()) {
            // Redeeming requires an authenticated account; without a key the site flow
            // (login → redeem) is the reliable path.
            const choice = await vscode.window.showInformationMessage(
                'Redeeming a code needs your Denpex account. Sign in on the website to redeem, or set your API key first.',
                'Redeem on denpex.com', 'Set API Key');
            if (choice === 'Redeem on denpex.com') {
                vscode.env.openExternal(vscode.Uri.parse(attribute(`${REDEEM_URL}?code=${encodeURIComponent(code)}`, 'redeem')));
            } else if (choice === 'Set API Key') {
                vscode.commands.executeCommand('denpex.setApiKey');
            }
            return;
        }
        try {
            const res = await redeem(code);
            vscode.window.showInformationMessage(
                `Denpex: ${res.days_remaining}-day ${res.plan} trial activated, up to 50 diagnoses a day. Run one resolved incident through the dashboard to verify the result.`);
            void refreshStatusBar();
        } catch (err: any) {
            if (err instanceof ApiError && err.status === 409) {
                vscode.window.showInformationMessage('Denpex: you already have an active trial.');
            } else if (err instanceof ApiError && err.status === 401) {
                const choice = await vscode.window.showErrorMessage('Denpex: this API key is not valid for redeeming. Redeem on the website instead?', 'Open denpex.com/redeem');
                if (choice) vscode.env.openExternal(vscode.Uri.parse(attribute(`${REDEEM_URL}?code=${encodeURIComponent(code)}`, 'redeem')));
            } else {
                vscode.window.showErrorMessage(`Denpex: redeem failed, ${err.message}`);
            }
        }
    });

    register('denpex.openPricing', () => vscode.env.openExternal(vscode.Uri.parse(attribute(PRICING_URL, 'pricing'))));
    register('denpex.openDashboard', () => vscode.env.openExternal(vscode.Uri.parse(attribute(DASHBOARD_URL, 'dashboard'))));
    register('denpex.generateRma', () => runGenerateRmaCommand(lastDiagnosis, lastLogs));

    // Declarative editor-title menus cannot inspect document contents. Maintain one
    // privacy-safe boolean context so traceback-like files without .log/.out still show
    // the Denpex action; no document content is stored or transmitted.
    const refreshEditorContext = () => {
        const document = vscode.window.activeTextEditor?.document;
        const sample = document ? documentEvidence(document, 64_000) : '';
        const looksLikeTraceback = /Traceback \(most recent call last\)|torch\.|CUDA error|NCCL|NVRM: Xid|vLLM|slurmstepd|nvidia-device-plugin/i.test(sample);
        void vscode.commands.executeCommand('setContext', 'denpex.tracebackOpen', looksLikeTraceback);
    };
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(refreshEditorContext),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document === vscode.window.activeTextEditor?.document) refreshEditorContext();
        }),
    );
    refreshEditorContext();

    if (!context.globalState.get<boolean>(FIRST_RUN_AHA_KEY, false)) {
        await context.globalState.update(FIRST_RUN_AHA_KEY, true);
        void vscode.commands.executeCommand('workbench.view.extension.denpex');
    }
    return {
        refreshCloudIncidents: () => cloudMonitor.pollNow(),
        connectCloudApiKey: (value: string) => storeApiKey(context.secrets, value),
    };
}

// ── Log collection ───────────────────────────────────────────────────────────

interface CollectedLogs { text: string; topologyMap?: Record<string, string[]> }

function documentEvidence(document: vscode.TextDocument, maxChars: number): string {
    return selectEvidenceForRequest(document.getText(), maxChars).text;
}

async function collectLogs(): Promise<CollectedLogs | undefined> {
    // 1. Prefer an explicit selection in the active editor.
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
        return { text: editor.document.getText(editor.selection) };
    }

    const items: (vscode.QuickPickItem & { id: string })[] = [];

    if (editor && /\.(log|out|err|txt)$/i.test(editor.document.fileName)) {
        items.push({ id: 'editor', label: '$(file-text) Use open log file', description: editor.document.fileName.split(/[\\/]/).pop() });
    }

    // 2. Live terminal buffers captured by shell integration.
    const buffers = monitor?.buffers() || new Map<string, string[]>();
    if (buffers.size === 1) {
        const [name, lines] = [...buffers.entries()][0];
        items.push({ id: 'terminal', label: `$(terminal) Use output of terminal "${name}"`, description: `${lines.length} captured lines` });
    } else if (buffers.size > 1) {
        items.push({ id: 'terminals', label: `$(server-environment) Coalesce all ${buffers.size} terminals (multi-node)`, description: 'sends per-terminal topology to the engine' });
        for (const [name, lines] of buffers) {
            items.push({ id: `terminal:${name}`, label: `$(terminal) Terminal "${name}" only`, description: `${lines.length} captured lines` });
        }
    }

    // Offer the source without reading or previewing private clipboard contents.
    items.push({ id: 'clipboard', label: '$(clippy) Use clipboard contents', description: 'Read only after you select this option' });
    if (!items.length) {
        void vscode.window.showInformationMessage('Open a log, select an error, copy a traceback, or run a bundled sample to start a diagnosis.');
        return undefined;
    }

    const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'Choose the log source for this diagnosis',
    });
    if (!choice) return undefined;

    if (choice.id === 'clipboard') {
        try {
            const clipboard = (await vscode.env.clipboard.readText()).trim();
            if (clipboard.length < MIN_LOG_CHARS) {
                void vscode.window.showInformationMessage(`Copy a log excerpt with at least ${MIN_LOG_CHARS} characters first.`);
                return undefined;
            }
            return { text: clipboard };
        } catch {
            void vscode.window.showWarningMessage('Denpex could not read the clipboard. Open or paste the log in the editor and choose that source instead.');
            return undefined;
        }
    }
    if (choice.id === 'editor' && editor) return { text: documentEvidence(editor.document, MAX_LOG_BYTES) };
    if (choice.id === 'terminal') {
        const [, lines] = [...buffers.entries()][0];
        return { text: lines.join('\n') };
    }
    if (choice.id === 'terminals') return coalesceTerminalBuffers() || undefined;
    if (choice.id.startsWith('terminal:')) {
        const name = choice.id.slice('terminal:'.length);
        return { text: (buffers.get(name) || []).join('\n') };
    }

    return undefined;
}

function coalesceTerminalBuffers(): CollectedLogs | null {
    const buffers = monitor?.buffers();
    if (!buffers || buffers.size === 0) return null;
    const sections: string[] = [];
    const topologyMap: Record<string, string[]> = {};
    for (const [name, lines] of buffers) {
        sections.push(`===== terminal: ${name} =====\n${lines.join('\n')}`);
        // Best-effort host extraction so the engine's topology analyzer can map
        // blast radius; the terminal name itself is the fallback node label.
        const hosts = new Set<string>();
        for (const line of lines) {
            const m = line.match(/\b(node-\d+|gpu-node-\d+|host-\d+|ip-\d+-\d+-\d+-\d+)\b/i);
            if (m) hosts.add(m[1]);
        }
        topologyMap[name] = hosts.size ? [...hosts] : [name];
    }
    return { text: sections.join('\n\n'), topologyMap };
}

// ── Diagnosis flow ───────────────────────────────────────────────────────────

async function runLocalDiagnosisWithProgress(logs: string, jobName: string): Promise<void> {
    if (!localEngineAvailable()) {
        vscode.window.showErrorMessage('Denpex offline engine is not available in this build.');
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Diagnosing locally (offline, unlimited)...',
        cancellable: true,
    }, async (_p, token) => {
        try {
            const result = await diagnoseLocally(logs, jobName, token);
            lastDiagnosis = result;
            lastLogs = logs;
            openPanel(result);
            void sidebarProvider?.recordLocal(result);
            void refreshStatusBar();
            if (extContext) {
                const context = extContext;
                void offerExtensionFunnelConsent(context).then((allowed) => {
                    if (allowed) void recordExtensionFunnelEvent(
                        context, jobName.startsWith('sample:') ? 'sample_result' : 'own_log_result',
                    );
                });
            }
        } catch (err: any) {
            if (token.isCancellationRequested) return;
            const msg = err instanceof LocalEngineError ? err.message : err?.message || String(err);
            vscode.window.showErrorMessage(`Denpex local diagnosis failed: ${msg}`);
        }
    });
}

async function runDiagnosis(logs: string, jobName: string, topologyMap?: Record<string, string[]>): Promise<void> {
    if (logs.trim().length < MIN_LOG_CHARS) {
        vscode.window.showWarningMessage(`Denpex needs at least ${MIN_LOG_CHARS} characters of logs to diagnose.`);
        return;
    }
    const selectedEvidence = selectEvidenceForRequest(logs, MAX_LOG_BYTES);
    if (selectedEvidence.truncated) {
        logs = selectedEvidence.text;
        void vscode.window.showWarningMessage('Denpex condensed this log to preserve causal evidence within the request limit.');
    }

    const mode = vscode.workspace.getConfiguration('denpex').get<string>('engine') || 'auto';
    const wantsCloudExplicit = mode === 'cloud';

    // Local-First Default: Run locally in 400ms for routine diagnoses unless the user explicitly configured 'cloud'
    if (!wantsCloudExplicit && localEngineAvailable()) {
        await runLocalDiagnosisWithProgress(logs, jobName);
        return;
    }

    if (mode === 'local') {
        void vscode.window.showWarningMessage('The bundled local engine is unavailable. Local-only mode blocks cloud uploads. Install a complete extension build to continue locally.');
        return;
    }
    await escalateToCloud(logs, jobName, topologyMap);

}

/**
 * Run the CLOUD engine on a log the local engine has already answered.
 *
 * Kept separate from runDiagnosis so that sending logs off the machine is always an
 * explicit act through the editable preview and Send approval.
 */
async function escalateToCloud(logs: string, _jobName: string, _topology?: Record<string, string[]>, original?: DiagnoseResponse): Promise<void> {
    if (vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') {
        void vscode.window.showInformationMessage('Local-only mode blocks cloud review. Choose auto or cloud mode before requesting an upload.'); return;
    }
    if (cloudReviewInFlight) return;
    const offerContinuation = () => { if (original) { original.teamContinuation = true; openPanel(original); }
        else void vscode.window.showInformationMessage('Connect an eligible account to request further cloud review. No log has been uploaded.'); };
    if (!apiKey() && extContext && getRemainingFreeCloudDiagnoses(extContext) <= 0) {
        void recordExtensionFunnelEvent(extContext, 'further_cloud_requested');
        offerContinuation(); return;
    }
    const generation = incidentGeneration;
    const destination = apiBase();
    cloudReviewInFlight = true;
    try {
        if (extContext) void recordExtensionFunnelEvent(extContext, 'cloud_preview_opened');
        const approved = await previewCloudPayload(logs);
        if (approved === undefined || generation !== incidentGeneration || destination !== apiBase()
            || vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') return;
        if (extContext) void recordExtensionFunnelEvent(extContext, 'cloud_review_approved');
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Cloud review', cancellable: true }, async (_progress, token) => {
            try {
                if (token.isCancellationRequested) return;
                const anonymous = !apiKey();
                const reviewed = await diagnose(approved, 'extension-cloud-review', token);
                if (token.isCancellationRequested || generation !== incidentGeneration) return;
                incidentLogs.set(reviewed, approved);
                if (original) { reviewed.cloudReview = assessmentComparison(original, reviewed, approved !== logs); precedingReports.set(reviewed, original); }
                if (anonymous && extContext) await consumeFreeCloudDiagnosis(extContext);
                lastDiagnosis = reviewed; lastLogs = approved; openPanel(reviewed);
                if (extContext) { await clearPendingReview(extContext).catch(() => undefined); void recordExtensionFunnelEvent(extContext, 'cloud_result'); }
                void refreshStatusBar();
            } catch (error: any) {
                if (token.isCancellationRequested) return;
                if (error instanceof ApiError && (error.status === 401 || error.status === 429 || error.code?.startsWith('TURNSTILE'))) { offerContinuation(); return; }
                void vscode.window.showWarningMessage(`Cloud review could not finish: ${error?.message || 'request failed'}. The preceding report remains available.`);
            }
        });
    } finally { cloudReviewInFlight = false; }
}

async function resumePendingReview(): Promise<void> {
    if (!extContext) return;
    const saved = await readPendingReview(extContext);
    if (!saved) { void vscode.window.showInformationMessage('No unexpired incident is saved for continuation.'); return; }
    incidentLogs.set(saved.result, saved.logs); lastDiagnosis = saved.result; lastLogs = saved.logs;
    openPanel(saved.result);
    void vscode.window.showInformationMessage('Your incident is restored. Cloud review still requires preview and Send approval.');
}

async function continueCloudInvestigation(result: DiagnoseResponse, logs: string, question: string): Promise<boolean> {
    if (!result.diagnosisId) throw new Error('The original diagnosis identity is required.');
    const generation=incidentGeneration;
    const destination=apiBase();
    const credential=apiKey();
    const approved=await previewCloudPayload(question,{diagnosisId:result.diagnosisId,originalLogs:logs});
    if (approved === undefined || lastDiagnosis !== result || generation !== incidentGeneration || destination !== apiBase() || credential !== apiKey()
        || vscode.workspace.getConfiguration('denpex').get<string>('engine') === 'local') return false;
    const reply=await askFollowup(logs,result.diagnosisId,approved,clarificationConversations.get(result.diagnosisId));
    if (lastDiagnosis !== result || generation !== incidentGeneration || destination !== apiBase() || credential !== apiKey()) return false;
    clarificationConversations.set(result.diagnosisId,reply.conversationId);
    const updated={...result,fix:reply.reply,meta:{...result.meta,failureType:reply.reply.failureType || result.meta?.failureType}};
    incidentLogs.set(updated,logs);
    if (precedingReports.has(result)) precedingReports.set(updated,precedingReports.get(result)!);
    lastDiagnosis=updated;
    openPanel(updated);
    return true;
}

function openPanel(result?: DiagnoseResponse, focusSection?: string, preparedText = ''): void {
    if (result) {
        if (result === lastDiagnosis && lastLogs && !incidentLogs.has(result)) incidentLogs.set(result, lastLogs);
        if (activeReport !== result) { activeReport = result; incidentGeneration++; }
        lastDiagnosis = result; lastLogs = incidentLogs.get(result);
    }

    const consolePanel = showDiagnosisPanel(result, async (message) => {
        switch (message.command) {
            case 'saveInvestigation':
                if (extContext && result) {
                    try { await saveInvestigation(extContext, result); }
                    catch (error) { void vscode.window.showErrorMessage(`Denpex could not save: ${error instanceof Error ? error.message : 'unknown error'}`); }
                }
                break;
            case 'reopenSaved':
                await vscode.commands.executeCommand('denpex.reopenSaved');
                break;
            case 'deleteSaved':
                await vscode.commands.executeCommand('denpex.deleteSaved');
                break;
            case 'exportInvestigation':
                if (result) {
                    const destination = await vscode.window.showSaveDialog({filters:{'Markdown report':['md']},saveLabel:'Export report with evidence'});
                    if (destination) {
                        try { await vscode.workspace.fs.writeFile(destination, Buffer.from(generateIncidentMarkdown(result))); }
                        catch (error) { void vscode.window.showErrorMessage(`Denpex export failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
                    }
                }
                break;
            case 'assessRecovery':
                if (result) {
                    const choice = await vscode.window.showQuickPick([
                        {label:'Workload recovered',outcome:'recovered' as const},
                        {label:'Recommendation did not resolve it',outcome:'failed' as const},
                    ],{placeHolder:'Record your own recovery assessment. Denpex does not independently verify it.'});
                    if (!choice) break;
                    const evidence = await vscode.window.showInputBox({prompt:'Record the operation rerun, reference comparison and recurrence checks, or what still failed. This note stays in memory unless you save or export it.',validateInput:value=>value.trim().length<12 ? 'Describe the observed result in at least 12 characters.' : value.length>4000 ? 'Keep the note below 4,000 characters.' : undefined});
                    if (!evidence) break;
                    const previous = result.localAssessmentHistory || (result.localAssessment ? [result.localAssessment] : []);
                    if (previous.length >= 100) { void vscode.window.showWarningMessage('This report has 100 recovery assessments. Export it before starting a new investigation.'); break; }
                    const assessment = {outcome:choice.outcome,evidence,recordedAt:Date.now()};
                    const updated = {...result,localAssessment:assessment,localAssessmentHistory:[...previous,assessment]};
                    if (incidentLogs.has(result)) incidentLogs.set(updated, incidentLogs.get(result)!);
                    if (precedingReports.has(result)) precedingReports.set(updated, precedingReports.get(result)!);
                    sidebarProvider?.updateLocal(result, updated);
                    lastDiagnosis = updated;
                    openPanel(updated);
                }
                break;
            case 'openFleet':
                if (extContext) openWorkspace(extContext, 'fleet');
                break;
            case 'openTopology':
                if (extContext) openWorkspace(extContext, 'topology');
                break;
            case 'diagnoseConsoleInput':
                if (clarificationBusy) break;
                clarificationBusy=true;
                try {
                    if (typeof message.text === 'string' && message.text.trim().length >= MIN_LOG_CHARS) {
                        const selected = selectEvidenceForRequest(message.text, MAX_LOG_BYTES);
                        if (selected.truncated) void vscode.window.showWarningMessage('Denpex condensed this log to preserve causal evidence within the request limit.');
                        const pending=pendingClarification;

                        if (pending && pending.result===lastDiagnosis) {
                            if (pending.result.diagnosisId && apiKey() && vscode.workspace.getConfiguration('denpex').get<string>('engine') !== 'local') {if (!await continueCloudInvestigation(pending.result,pending.logs,`Additional observed evidence:\n${selected.text}\n${pending.facts.join('\n')}`)) break;}
                            else await runDiagnosis(`${pending.logs}\n\n## Additional observed evidence\n${selected.text}${pending.facts.length ? '\n\n## Operator answers\n'+pending.facts.join('\n') : ''}`,'clarifying-evidence');
                            pendingClarification=undefined;
                        } else await runLocalDiagnosisWithProgress(selected.text, 'console-input');
                    }
                } catch(error) {void vscode.window.showErrorMessage(`Denpex: ${error instanceof Error ? error.message : 'Request failed. Your pending evidence is preserved for retry.'}`);}
                finally {
                    clarificationBusy=false;
                    void consolePanel.webview.postMessage({ command: 'consoleReady', text: 'Ready for your evidence or another log.' });
                }
                break;
            case 'askLocalFollowUp':
                if (!message.text?.trim() || clarificationBusy || lastDiagnosis !== result) break;
                if (result?.diagnosisId && lastLogs && apiKey() && vscode.workspace.getConfiguration('denpex').get<string>('engine') !== 'local') {
                    clarificationBusy = true;
                    try {
                        await continueCloudInvestigation(result,lastLogs,message.text);
                    } catch (error) {void vscode.window.showErrorMessage(`Denpex follow-up: ${error instanceof Error ? error.message : 'Request failed. Retry this investigation.'}`);}
                    finally {clarificationBusy = false;void consolePanel.webview.postMessage({command:'consoleReady'});}
                } else if (result) {
                    void consolePanel.webview.postMessage({command:'localFollowUp',question:message.text,text:answerLocalFollowUp(message.text,result)});
                }
                break;
            case 'submitClarifyingAnswers': {
                if (!result || lastDiagnosis !== result || !lastLogs || clarificationBusy) break;
                let answers: unknown;
                try {answers=JSON.parse(message.text || '');} catch {break;}
                if (!Array.isArray(answers)) break;
                const questions=clarificationChoices(result.fix?.clarifyingChoices,result.fix?.clarifyingQuestions);
                const facts: string[]=[];
                const pending: string[]=[];
                for (const answer of answers.slice(0,4)) {
                    const q=questions.find(item=>item.id===answer?.questionId);
                    if (!q) continue;
                    const custom=answer.optionId==='custom' && typeof answer.text==='string' ? answer.text.trim().slice(0,4000).replace(/[\r\n]+/g,' ') : '';
                    const option=q.options.find(item=>item.id===answer.optionId);
                    if (!custom && !option) continue;
                    if (q.kind==='action' && !custom && option!.id !== 'collect.unavailable') pending.push(`${q.question}: ${option!.label}. This is availability or intent, not a check result.`);
                    else facts.push(`- ${q.question} ${q.kind === 'action' ? 'Operator context, not a test result: ' : ''}${custom || option!.label}`);
                }
                if (pending.length) {
                    pendingClarification={result,logs:lastLogs,facts};
                    void consolePanel.webview.postMessage({command:'consoleReady',collectEvidence:true,text:'Paste the requested evidence below. A selected check is not a result.'});
                    void vscode.window.showInformationMessage(pending.join(' '));
                }
                if (facts.length && !pending.length) {
                    const refined=`${lastLogs}\n\n## Operator answers\n${facts.join('\n')}`;
                    clarificationBusy=true;
                    try {if(result.diagnosisId && apiKey() && vscode.workspace.getConfiguration('denpex').get<string>('engine') !== 'local') await continueCloudInvestigation(result,lastLogs,facts.join('\n')); else await runDiagnosis(refined,'clarifying-refinement');}
                    catch(error) {void vscode.window.showErrorMessage(`Denpex: ${error instanceof Error ? error.message : 'Unable to submit answers. Retry.'}`);}
                    finally {clarificationBusy=false;void consolePanel.webview.postMessage({command:'consoleReady'});}
                }
                break;
            }
            case 'consoleSample':
                await vscode.commands.executeCommand('denpex.runSample', 'nccl-rank-oom');
                break;
            case 'copy':
                if (message.text) await vscode.env.clipboard.writeText(message.text);
                vscode.window.setStatusBarMessage('Denpex: copied to clipboard', 2000);
                break;
            case 'copyIncidentReport':
                if (result) {
                    const md = generateIncidentMarkdown(result);
                    await vscode.env.clipboard.writeText(md);
                    void vscode.window.showInformationMessage('Denpex: Copied incident post-mortem for Slack / PR to clipboard.');
                }
                break;
            case 'insertInTerminal':
                if (message.text) {
                    const term = vscode.window.activeTerminal || vscode.window.createTerminal({ name: 'Denpex' });
                    term.show(true);
                    term.sendText(message.text, false);
                    vscode.window.setStatusBarMessage('Denpex: Inserted command at terminal prompt', 3000);
                }
                break;
            case 'startInEditorTrial':
                if (extContext) await startInEditorTrialFlow(extContext);
                break;
            case 'open':
                if (message.text) vscode.env.openExternal(vscode.Uri.parse(message.text));
                break;
            case 'runInTerminal':
                if (message.text) await executeInTerminal(message.text);
                break;
            case 'restartCheckpoint':
                await restartFromCheckpoint(result);
                break;
            case 'generateRma':
                await runGenerateRmaCommand(lastDiagnosis, lastLogs);
                break;
            case 'escalateCloud':
                if (result && incidentLogs.has(result)) await escalateToCloud(incidentLogs.get(result)!, 'report-cloud-escalation', undefined, result);
                else void vscode.window.showInformationMessage('Open the original log again before cloud review. Saved reports do not retain the full source log.');
                break;
            case 'diagnoseOwnLog':
                await vscode.commands.executeCommand('denpex.diagnoseCurrentLogs');
                break;
            case 'originalAssessment':
                if (result && precedingReports.has(result)) openPanel(precedingReports.get(result));
                break;
            case 'prepareLocalFeedback':
                if (result) await prepareLocalFeedback(result);
                break;
            case 'submitCloudFeedback':
                if (result) await submitObservedCloudFeedback(result);
                break;
            case 'resumePendingReview':
                await resumePendingReview();
                break;
            case 'connectPendingAccount':
                if (extContext && result && incidentLogs.has(result)) await savePendingReview(extContext, incidentLogs.get(result)!, result);
                await vscode.commands.executeCommand('denpex.connectAccount');
                break;
            case 'requestTeamEvaluation':
                if (extContext && result) {
                    if (incidentLogs.has(result)) await savePendingReview(extContext, incidentLogs.get(result)!, result);
                    const requested = await startInEditorTrialFlow(extContext);
                    if (!requested) await clearPendingReview(extContext);
                }
                break;
            case 'startTrial':
                if (extContext) await startInEditorTrialFlow(extContext);
                break;
        }
    }, focusSection, !apiKey() || (verifiedTrialKey === apiKey() && verifiedTrialEligibility), preparedText);
}

// ── Closed-loop remediation (explicit consent, always visible) ──────────────

async function executeInTerminal(command: string, forceConfirmation = false, contextNote = ''): Promise<void> {
    const confirmRequired = forceConfirmation || vscode.workspace.getConfiguration('denpex').get<boolean>('remediation.confirmBeforeRun', true);
    if (confirmRequired) {
        const preview = command.length > 400 ? command.slice(0, 400) + '…' : command;
        const choice = await vscode.window.showWarningMessage(
            `${contextNote ? contextNote + '\n\n' : ''}Denpex will run this in a terminal on ${vscode.env.remoteName ? 'the REMOTE host' : 'this machine'}:\n\n${preview}`,
            { modal: true },
            'Run It');
        if (choice !== 'Run It') return;
    }
    if (!remediationTerminal || remediationTerminal.exitStatus !== undefined) {
        remediationTerminal = vscode.window.createTerminal({ name: 'Denpex Remediation' });
    }
    remediationTerminal.show(true);
    remediationTerminal.sendText(command, true);
}

async function restartFromCheckpoint(result?: DiagnoseResponse): Promise<void> {
    const target = result?.fix?.resumeFrom || result?.resumeFrom;
    if (result?.checkpointIntegrity?.isSafe !== true || !target) {
        void vscode.window.showWarningMessage('Restart is unavailable. Validate a specific checkpoint and provide its integrity evidence first.');
        return;
    }
    const cfg = vscode.workspace.getConfiguration('denpex');
    let command = (cfg.get<string>('remediation.restartCommand') || '').trim();
    if (!command) {
        const entered = await vscode.window.showInputBox({
            prompt: 'Command that resumes your training from the last checkpoint (saved for next time)',
            placeHolder: 'e.g. sbatch resume_training.sh   or   torchrun train.py --resume latest',
            ignoreFocusOut: true,
        });
        if (!entered) return;
        command = entered.trim();
        await cfg.update('remediation.restartCommand', command, vscode.ConfigurationTarget.Workspace);
    }
    await executeInTerminal(command, true, `Evidence supports checkpoint ${target}. Confirm that this command uses this exact checkpoint and is appropriate for the affected workload.`);
}

// ── Status bar ───────────────────────────────────────────────────────────────

async function refreshStatusBar(): Promise<void> {
    if (!statusItem) return;
    const previousTrialOffer = !apiKey() || (verifiedTrialKey === apiKey() && verifiedTrialEligibility);
    const currentKey = apiKey();
    verifiedTrialKey = undefined;
    verifiedTrialEligibility = false;
    if (!apiKey()) {
        const remaining = extContext ? getRemainingFreeCloudDiagnoses(extContext) : 0;
        if (remaining > 0) {
            statusItem.text = `Denpex: Local · ${remaining} Cloud Passes`;
            statusItem.tooltip = `Denpex: Unlimited Local Engine Active · ${remaining} free Cloud Deep Reasoning passes remaining. Click for menu.`;
        } else if (localEngineAvailable()) {
            statusItem.text = 'Denpex: Local Engine';
            statusItem.tooltip =
                'Denpex: Unlimited Local Engine Active (no account required).\n'
                + 'Request a trial code by work email for 30 days of Team (50 cloud analyses/day). Click for menu.';
        } else {
            statusItem.text = 'Denpex';
            statusItem.tooltip = 'Denpex ML Diagnostics. Run "Denpex: Set API Key" to sync with your dashboard.';
        }
        if (!previousTrialOffer) sidebarProvider?.refresh();
        return;
    }
    try {
        const [q, trial, identity] = await Promise.all([quota(), redeemStatus().catch(() => null), accountStatus()]);
        if(currentKey !== apiKey())return;
        verifiedTrialKey = currentKey;
        verifiedTrialEligibility = q.plan === 'free' && trial?.active === false;
        const planLabel = trial?.active && trial.plan ? `${trial.plan} trial` : (q.plan || 'free');
        const remainingLabel = typeof q.remaining === 'number' && isFinite(q.remaining) ? ` · ${q.remaining} left` : '';
        statusItem.text = `Denpex: ${planLabel}${remainingLabel}`;
        statusItem.tooltip = trial?.active
            ? `Connected as ${identity.account.email}. ${trial.plan} trial, ${trial.days_remaining} days remaining. Click for menu.`
            : `Connected as ${identity.account.email}. ${planLabel} plan verified by the server. Cloud diagnoses share your dashboard history. Click for menu.`;
    } catch (error) {
        statusItem.text = error instanceof ApiError && error.status === 401 ? 'Denpex: Reconnect' : 'Denpex: Account unverified';
        statusItem.tooltip = 'Account status could not be verified. Reconnect or retry. Local diagnosis remains available.';
    }
    const nextTrialOffer = !apiKey() || (verifiedTrialKey === apiKey() && verifiedTrialEligibility);
    if (previousTrialOffer !== nextTrialOffer) sidebarProvider?.refresh();
}

export function deactivate() {
    monitor?.dispose();
}
