import type { DiagnoseResponse } from './api';

/** Extracts recorded findings only. This is not a generative chat model. */
export function answerLocalFollowUp(question: string, diagnosis?: DiagnoseResponse): string {
    if (!diagnosis) return 'Diagnose a log first. Local follow-ups can explain its cause, evidence, fix, and checkpoint safety without sending data to a model.';
    const fix = diagnosis.fix || {};
    if (/checkpoint|resum|restart|safe/i.test(question)) {
        return [diagnosis.resumeSafetyNote, diagnosis.resumeFrom ? `Resume evidence: ${diagnosis.resumeFrom}` : 'Checkpoint integrity has not been established by this answer. Verify checksums and manifests before resuming.'].filter(Boolean).join('\n\n');
    }
    if (/evidence|why|proof|line/i.test(question)) {
        return fix.evidence?.length ? `Matched evidence from this diagnosis:\n\n${fix.evidence.join('\n\n')}` : 'This diagnosis did not return matched evidence. Collect the initiating error before attributing a cause.';
    }
    if (/verify|verification|test/i.test(question)) return fix.verificationCommand || 'No safe automated verification command was established from this evidence.';
    if (/fix|action|repair|next|mitigat/i.test(question)) return [fix.action, fix.fallbackAction, fix.emergencyAction].filter(Boolean).join('\n\n') || 'No remediation was established from this evidence.';
    if (/cause|first|rank|happen|summary/i.test(question)) return fix.summary || 'No root cause was established from this evidence.';
    return 'Local follow-ups explain recorded findings, not arbitrary questions. Ask what failed first, why, which evidence supports it, how to fix it, how to verify it, or whether the checkpoint is safe. General reasoning requires explicitly choosing cloud review.';
}
