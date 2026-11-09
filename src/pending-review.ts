import * as vscode from 'vscode';
import { DiagnoseResponse, MAX_LOG_BYTES } from './api';

const KEY = 'denpex.pendingIncidentReview.v1';
const TTL = 24 * 60 * 60 * 1000;
export type PendingReview = { logs: string; result: DiagnoseResponse; expiresAt: number };

/** This is deliberate local continuity after choosing Team, not general report history. */
export async function savePendingReview(context: vscode.ExtensionContext, logs: string, result: DiagnoseResponse): Promise<void> {
    if (Buffer.byteLength(logs, 'utf8') > MAX_LOG_BYTES) throw new Error('Incident too large to preserve');
    const retained: DiagnoseResponse = { success: result.success, source: result.source, meta: result.meta,
        fix: result.fix, engineVersion: result.engineVersion, resumeSafetyNote: result.resumeSafetyNote,
        diagnosisId: result.diagnosisId, cloudReview: result.cloudReview, offlineDecision: result.offlineDecision };
    const serialized = JSON.stringify({ logs, result: retained, expiresAt: Date.now() + TTL });
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) throw new Error('Incident too large to preserve securely');
    await context.secrets.store(KEY, serialized);
    await context.globalState.update('denpex.pendingReviewAvailable', true);
}

export async function readPendingReview(context: vscode.ExtensionContext): Promise<PendingReview | undefined> {
    try {
        const raw = await context.secrets.get(KEY);
        if (!raw) return undefined;
        const saved = JSON.parse(raw) as PendingReview;
        if (!saved || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() || saved.expiresAt > Date.now() + TTL || typeof saved.logs !== 'string'
            || !saved.result?.fix || Buffer.byteLength(saved.logs, 'utf8') > MAX_LOG_BYTES) {
            await clearPendingReview(context); return undefined;
        }
        return saved;
    } catch { await clearPendingReview(context).catch(() => undefined); return undefined; }
}

export async function clearPendingReview(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(KEY);
    await context.globalState.update('denpex.pendingReviewAvailable', false);
}
