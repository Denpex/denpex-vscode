/** Runtime generated from worker/offline-evidence-decision.ts during compile. */
const shared = require('../engine/denpex_evidence.cjs') as {
    collectIncidentObservations(logs: string): Array<{ kind: string; line: number; text: string; role: string; rank: number | null; timestamp: string | null }>;
    correlateObservedRanks(sources: Array<{ rank: number | null; logs: string }>): number | null;
};
export const collectIncidentObservations = shared.collectIncidentObservations;
export const correlateObservedRanks = shared.correlateObservedRanks;
