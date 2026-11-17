// Pure helpers for "Denpex: Run Fleet Diagnostic on Current File". No vscode import,
// so the report formatting and error routing are unit-tested outside the editor.

export interface FleetDiagnosticResult {
    toolId: string;
    mode?: string;
    detected?: boolean;
    report: Record<string, unknown>;
}

const TOOL_NAMES: Readonly<Record<string, string>> = {
    '01-gpud': 'gpud kernel log and node health',
    '02-gpu-burn-dcgm': 'gpu-burn and DCGM diagnostics',
    '03-nvbandwidth-perftest': 'nvbandwidth and perftest',
    '04-py-spy-ranks': 'py-spy rank stacks',
    '05-nvitop-nvtop': 'nvitop / nvtop snapshot',
    '06-hta-trace': 'Holistic Trace Analysis',
    '07-genai-perf-vllm': 'genai-perf / vLLM benchmark',
    '08-hwloc-lstopo': 'hwloc / lstopo topology',
    '09-lbnl-nhc': 'LBNL Node Health Check',
    '10-superbench-chs': 'SuperBench rack certification',
    '11-dynolog': 'dynolog',
    '12-memray-scalene': 'memray / Scalene memory profile',
    '13-hf-mem-snapshot': 'hf-mem and torchsnapshot',
    '14-nccl-tests-npd': 'nccl-tests and node problem detector',
};

const SEVERITY_RANK: Readonly<Record<string, number>> = { critical: 0, error: 1, warning: 2, warn: 2, info: 3 };

type NextStep = 'connect' | 'upgrade' | 'diagnose' | 'none';

/** The selection when it has content, otherwise the whole document; null when both are blank. */
export function selectFleetInput(documentText: string, selectionText: string): string | null {
    if (selectionText.trim()) return selectionText;
    return documentText.trim() ? documentText : null;
}

export function fleetErrorNextStep(status: number | undefined, code: string | undefined): NextStep {
    if (status === 401 || code === 'AUTH_REQUIRED') return 'connect';
    if (status === 402 || code === 'UPGRADE_REQUIRED') return 'upgrade';
    if (code === 'TOOL_NOT_RECOGNIZED') return 'diagnose';
    return 'none';
}

function oneLine(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findingLine(finding: unknown): { rank: number; text: string } {
    if (typeof finding === 'string') return { rank: 4, text: oneLine(finding) };
    if (finding && typeof finding === 'object') {
        const f = finding as Record<string, unknown>;
        const severity = oneLine(f.severity).toLowerCase();
        const subject = oneLine(f.subject);
        const message = oneLine(f.message ?? f.detail ?? JSON.stringify(f));
        return {
            rank: SEVERITY_RANK[severity] ?? 4,
            text: `${severity ? `**${severity}** ` : ''}${subject ? `${subject}: ` : ''}${message}`,
        };
    }
    return { rank: 4, text: oneLine(finding) };
}

function headline(report: Record<string, unknown>): string | null {
    if (typeof report.verdict === 'string') return `**Verdict:** ${oneLine(report.verdict)}`;
    const overall = report.overall as Record<string, unknown> | undefined;
    if (overall && typeof overall.health === 'string') return `**Node health:** ${oneLine(overall.health)}`;
    return null;
}

/** A longer fence than any backtick run in the content, so report text cannot close the block. */
function fenced(language: string, content: string): string {
    const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}${language}\n${content}\n${fence}`;
}

export function renderFleetReportMarkdown(result: FleetDiagnosticResult): string {
    const name = TOOL_NAMES[result.toolId] ?? result.toolId;
    const lines: string[] = [`# Denpex fleet diagnostic: ${name}`, ''];
    const context = [
        result.detected ? 'Detected from the output.' : 'Tool selected explicitly.',
        result.mode === 'sample' ? 'Ran on the published sample.' : 'Ran on your output.',
        'The report is advisory: confirm before acting on hardware.',
    ];
    lines.push(context.join(' '), '');
    const top = headline(result.report);
    if (top) lines.push(top, '');
    const findings = Array.isArray(result.report.findings) ? result.report.findings : [];
    lines.push('## Findings', '');
    if (!findings.length) {
        lines.push('No findings were reported for this output. See the full report below.');
    } else {
        findings.map(findingLine)
            .map((line, index) => ({ ...line, index }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .forEach((line) => lines.push(`- ${line.text}`));
    }
    lines.push('', '## Full report', '', fenced('json', JSON.stringify(result.report, null, 2)), '');
    return lines.join('\n');
}
