import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { DiagnoseResponse } from './api';

const MAX_BYTES = 2 * 1024 * 1024;
export interface SavedInvestigation { schemaVersion: 1; savedAt: number; result: DiagnoseResponse }
export function encodeInvestigation(result: DiagnoseResponse): Uint8Array {
    const data = Buffer.from(JSON.stringify({ schemaVersion: 1, savedAt: Date.now(), result }));
    if (data.byteLength > MAX_BYTES) throw Error('Report exceeds the 2 MiB local save limit.');
    return data;
}
export function decodeInvestigation(data: Uint8Array): SavedInvestigation {
    if (data.byteLength > MAX_BYTES) throw Error('Saved report exceeds the 2 MiB limit.');
    const value = JSON.parse(Buffer.from(data).toString('utf8'));
    if (value?.schemaVersion !== 1 || !Number.isFinite(value.savedAt)
        || !value.result || typeof value.result !== 'object' || typeof value.result.success !== 'boolean') {
        throw Error('This is not a supported Denpex saved investigation.');
    }
    const assessments = value.result.localAssessmentHistory ?? (value.result.localAssessment ? [value.result.localAssessment] : []);
    if (!Array.isArray(assessments) || assessments.length > 100 || assessments.some(item => !item
        || !['recovered','failed'].includes(item.outcome) || typeof item.evidence !== 'string'
        || item.evidence.length > 4000 || !Number.isFinite(item.recordedAt))) throw Error('Saved recovery assessments are invalid.');
    return value;
}
const folder = (context: vscode.ExtensionContext) => vscode.Uri.joinPath(context.globalStorageUri, 'investigations');
export async function saveInvestigation(context: vscode.ExtensionContext, result: DiagnoseResponse): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
        'Save this report on the extension host? It includes evidence excerpts, findings and your recovery notes. It is not encrypted and may contain sensitive values. The original input log is not separately saved. Reports remain until you delete them. Nothing is uploaded.',
        { modal: true }, 'Save locally');
    if (choice !== 'Save locally') return;
    const dir = folder(context);
    await vscode.workspace.fs.createDirectory(dir);
    const existing = await vscode.workspace.fs.readDirectory(dir);
    if (existing.filter(([name]) => /^[0-9a-f-]{36}\.json$/.test(name)).length >= 100) throw Error('Saved report limit reached. Delete an older report before saving another.');
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `${randomUUID()}.json`), encodeInvestigation(result));
    void vscode.window.showInformationMessage('Denpex report saved. Use Reopen saved investigation to continue after restarting VS Code.');
}
export async function chooseSavedInvestigation(context: vscode.ExtensionContext, remove = false): Promise<DiagnoseResponse | undefined> {
    const dir = folder(context);
    let files: [string, vscode.FileType][];
    try { files = await vscode.workspace.fs.readDirectory(dir); }
    catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') files = []; else throw error; }
    const records: Array<{label:string;description:string;uri:vscode.Uri;result:DiagnoseResponse;valid:boolean}> = [];
    for (const [name, type] of files) {
        if (type !== vscode.FileType.File || !/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        const uri = vscode.Uri.joinPath(dir, name);
        try {
            if ((await vscode.workspace.fs.stat(uri)).size > MAX_BYTES) throw Error('Saved report exceeds the 2 MiB limit.');
            const saved = decodeInvestigation(await vscode.workspace.fs.readFile(uri));
            records.push({label:saved.result.meta?.failureType || 'Saved investigation',description:new Date(saved.savedAt).toLocaleString(),uri,result:saved.result,valid:true});
        } catch { records.push({label:'Unreadable saved report',description:name,uri,result:{success:false},valid:false}); }
    }
    if (!records.length) { void vscode.window.showInformationMessage('No saved investigations. Choose Save locally in a diagnosis report first.'); return; }
    const selected = await vscode.window.showQuickPick(records, {placeHolder: remove ? 'Select a saved report to delete' : 'Reopen a saved investigation'});
    if (!selected) return;
    if (remove) {
        if (await vscode.window.showWarningMessage('Delete this saved report permanently?', {modal:true}, 'Delete report') === 'Delete report') {
            await vscode.workspace.fs.delete(selected.uri, {recursive:false, useTrash:false});
        }
        return;
    }
    if (!selected.valid) throw Error('This saved report cannot be reopened. You can delete it using Delete saved investigation.');
    return selected.result;
}
