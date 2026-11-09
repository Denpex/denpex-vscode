import * as path from 'path';
import * as vscode from 'vscode';
import { collectIncidentObservations, correlateObservedRanks } from './offline-decision';

export interface LogLineInfo {
    rank: number; timestamp: string | null; rawText: string; lineNumber: number;
    isError: boolean; isWatchdogTimeout: boolean;
}
export interface RankAnalysis {
    rank: number; uri: vscode.Uri; totalLines: number; errorCount: number;
    firstErrorLine: LogLineInfo | null; isPatientZero: boolean; readError?: string;
}
export interface MultiRankReport { ranks: RankAnalysis[]; patientZeroRank: number | null; summary: string }

export async function analyzeMultiRankLogs(fileUris: vscode.Uri[]): Promise<MultiRankReport> {
    const sources = await Promise.all(fileUris.map(async uri => {
        const name = path.basename(uri.fsPath).match(/(?:rank[._-]?|gpu[._-]?)(\d+)/i);
        let rank = name ? Number(name[1]) : -1;
        try {
            if ((await vscode.workspace.fs.stat(uri)).size > 16 * 1024 * 1024) throw new Error('Oversized log');
            const logs = (await vscode.workspace.openTextDocument(uri)).getText();
            const observations = collectIncidentObservations(logs);
            const identities = [...new Set(observations.map(item => item.rank).filter((value): value is number => value !== null))];
            if (rank < 0 && identities.length === 1) rank = identities[0];
            if (identities.length > 1 || identities.length === 1 && rank >= 0 && identities[0] !== rank) rank = -1;
            const faults = observations.filter(item => item.role === 'fault');
            const relevant = faults.length ? faults : observations.filter(item => item.role === 'symptom');
            relevant.sort((a, b) => a.timestamp && b.timestamp ? Date.parse(a.timestamp.replace(',', '.')) - Date.parse(b.timestamp.replace(',', '.')) : a.line - b.line);
            const first = relevant[0];
            return { logs, report: { rank, uri, totalLines: logs.split(/\r?\n/).length,
                errorCount: new Set(observations.filter(item => item.role !== 'context').map(item => item.line)).size,
                firstErrorLine: first ? { rank, timestamp: first.timestamp, rawText: first.text, lineNumber: first.line,
                    isError: first.role === 'fault', isWatchdogTimeout: first.kind === 'watchdog' } : null,
                isPatientZero: false } as RankAnalysis };
        } catch {
            return { logs: '', report: { rank, uri, totalLines: 0, errorCount: 0, firstErrorLine: null,
                isPatientZero: false, readError: 'Could not read this log. Select an accessible text file under 16 MiB.' } as RankAnalysis };
        }
    }));
    const patientZeroRank = sources.some(source => source.report.readError) ? null : correlateObservedRanks(sources.map(source => ({ rank: source.report.rank < 0 ? null : source.report.rank, logs: source.logs })));
    const ranks = sources.map(source => ({ ...source.report, isPatientZero: patientZeroRank !== null && source.report.rank === patientZeroRank }));
    return { ranks, patientZeroRank, summary: patientZeroRank === null
        ? 'Initiating rank unresolved. Collect explicit failure events, consistent identities and aligned clocks; timeout reporters alone do not establish ownership.'
        : `Candidate initiating failure: Rank ${patientZeroRank}. Shared offline evidence rules found an explicit fault. Clock alignment and causal ownership still require verification.` };
}
