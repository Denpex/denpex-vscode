/**
 * Rank map and crash cost, computed on this machine from the log the user diagnosed.
 *
 * This mirrors `observeRanks` and `longestCollectiveWaitMs` in `worker/slack-free-tools.ts`
 * so the editor and Slack show the same picture of the same log; a parity test holds the
 * two together. Nothing here is uploaded, and every value comes from the log itself. When
 * the log does not state something (the world size, a timeout length) it is left out
 * rather than guessed.
 */

export interface RankObservation {
    /** Ranks with an error line that is not a collective timeout. */
    errored: number[];
    /** Ranks whose only signal is a timeout waiting on a collective. */
    timedOut: number[];
    /** World size, only when the log states it. */
    worldSize: number | null;
}

export interface LogInsights {
    ranks: RankObservation;
    /** Longest collective timeout the log reports, in milliseconds. */
    longestWaitMs: number | null;
}

const MAX_RANK = 65535;
const RANK_IN_LINE = /\[rank\s*(\d{1,5})\]|\brank\s*[:=#]?\s*(\d{1,5})\b/i;
const TIMEOUT_LINE = /Watchdog caught collective|collective operation timeout|WorkNCCL\(|timed out waiting|Timeout\(ms\)|ran for \d+ milliseconds/i;
const ERROR_LINE = /error|exception|traceback|out of memory|OutOfMemory|\bXid\b|fault|abort|SIGSEGV|SIGKILL|segmentation|illegal|NaN|\bfailed\b/i;

export function observeRanks(logs: string): RankObservation {
    const errored = new Set<number>();
    const timedOut = new Set<number>();
    for (const line of String(logs || '').split(/\r?\n/)) {
        const m = line.match(RANK_IN_LINE);
        if (!m) continue;
        const rank = Number(m[1] ?? m[2]);
        if (!Number.isInteger(rank) || rank < 0 || rank > MAX_RANK) continue;
        if (TIMEOUT_LINE.test(line)) timedOut.add(rank);
        else if (ERROR_LINE.test(line)) errored.add(rank);
    }
    for (const r of errored) timedOut.delete(r);
    const sizeMatch = String(logs || '').match(/\b(\d{1,5})\s+ranks\b|\bworld[_ ]?size\s*[:=]?\s*(\d{1,5})\b/i);
    let worldSize = sizeMatch ? Number(sizeMatch[1] ?? sizeMatch[2]) : null;
    const highest = Math.max(-1, ...errored, ...timedOut);
    if (worldSize !== null && (!Number.isInteger(worldSize) || worldSize < 1 || worldSize <= highest || worldSize > 16384)) worldSize = null;
    return { errored: [...errored].sort((a, b) => a - b), timedOut: [...timedOut].sort((a, b) => a - b), worldSize };
}

export function longestCollectiveWaitMs(logs: string): number | null {
    let longest: number | null = null;
    for (const m of String(logs || '').matchAll(/ran for (\d{1,9}) milliseconds|Timeout\(ms\)\s*=\s*(\d{1,9})/gi)) {
        const ms = Number(m[1] ?? m[2]);
        if (Number.isFinite(ms) && ms > 0 && (longest === null || ms > longest)) longest = ms;
    }
    return longest;
}

/** Insights worth showing, or undefined for a single-GPU or rank-free log. */
export function computeLogInsights(logs: string): LogInsights | undefined {
    const ranks = observeRanks(logs);
    if (ranks.errored.length === 0 || ranks.errored.length + ranks.timedOut.length < 2) return undefined;
    return { ranks, longestWaitMs: longestCollectiveWaitMs(logs) };
}

export const GRID_MAX = 256;
const PER_ROW = 16;

function rankList(ranks: number[], limit = 12): string {
    const shown = ranks.slice(0, limit).join(', ');
    return ranks.length > limit ? `${shown} (+${ranks.length - limit} more)` : shown;
}

function oneDecimal(n: number): string {
    return (Math.round(n * 10) / 10).toLocaleString('en-US');
}

/** Plain-language crash cost, or null without a stated world size. */
export function crashCostSentence(insights: LogInsights): string | null {
    const gpus = insights.ranks.worldSize;
    if (gpus === null) return null;
    const waitMs = insights.longestWaitMs;
    if (waitMs === null) return `Every hour this ${gpus}-GPU job is down costs ${gpus} GPU-hours.`;
    const minutes = waitMs / 60000;
    const minLabel = minutes >= 10 ? Math.round(minutes).toString() : oneDecimal(minutes);
    return `All ${gpus} GPUs sat idle in a ${minLabel}-minute collective timeout, so at least ${oneDecimal((gpus * waitMs) / 3_600_000)} GPU-hours were burned before the job died.`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Webview HTML for the rank map and crash cost. Colour is never the only signal: each
 * cell carries a text label, and the legend names the ranks in words.
 */
export function renderLogInsightsHtml(insights: LogInsights | undefined): string {
    if (!insights) return '';
    const { ranks } = insights;
    const errored = new Set(ranks.errored);
    const timedOut = new Set(ranks.timedOut);
    let grid = '';
    if (ranks.worldSize !== null && ranks.worldSize <= GRID_MAX) {
        const rows: string[] = [];
        for (let start = 0; start < ranks.worldSize; start += PER_ROW) {
            const cells: string[] = [];
            for (let r = start; r < Math.min(ranks.worldSize, start + PER_ROW); r++) {
                const state = errored.has(r) ? 'error' : timedOut.has(r) ? 'waited' : 'clean';
                const label = state === 'error' ? `rank ${r}: error` : state === 'waited' ? `rank ${r}: timed out waiting` : `rank ${r}: no error in this log`;
                cells.push(`<span class="rank-cell rank-${state}" role="img" aria-label="${label}" title="${label}"></span>`);
            }
            rows.push(`<div class="rank-row"><span class="rank-row-label" aria-hidden="true">${start}</span>${cells.join('')}</div>`);
        }
        grid = `<div class="rank-grid" role="group" aria-label="Rank map of ${ranks.worldSize} ranks">${rows.join('')}</div>`;
    }
    const legend = [
        `<li><span class="rank-cell rank-error" aria-hidden="true"></span> Error: rank ${esc(rankList(ranks.errored))}</li>`,
        ranks.timedOut.length ? `<li><span class="rank-cell rank-waited" aria-hidden="true"></span> Timed out waiting on a collective: rank ${esc(rankList(ranks.timedOut))}</li>` : '',
        ranks.worldSize !== null && ranks.worldSize <= GRID_MAX ? `<li><span class="rank-cell rank-clean" aria-hidden="true"></span> No error in this log (${ranks.worldSize} ranks total)</li>` : '',
    ].join('');
    const sizeNote = ranks.worldSize === null ? '<p class="meta">The log does not state the world size, so only the named ranks are listed.</p>' : '';
    const cost = crashCostSentence(insights);
    const costHtml = cost ? `<p><strong>Cost of this crash:</strong> ${esc(cost)}</p>` : '';
    return `<section class="box" aria-labelledby="rank-map-title"><h2 id="rank-map-title">Rank map</h2><p class="meta">Built on this machine from the ranks this log names.</p>${grid}<ul class="rank-legend">${legend}</ul>${sizeNote}${costHtml}</section>`;
}

export const LOG_INSIGHTS_CSS = `
.rank-grid{display:flex;flex-direction:column;gap:3px;margin:10px 0}
.rank-row{display:flex;align-items:center;gap:3px}
.rank-row-label{width:34px;text-align:right;margin-right:6px;font-family:var(--vscode-editor-font-family);font-size:11px;opacity:.85}
.rank-cell{display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid #757575;vertical-align:middle}
.rank-error{background:#E5484D}
.rank-waited{background:#F5A524}
.rank-clean{background:#D9D9D9}
.rank-legend{list-style:none;padding:0;margin:8px 0}
.rank-legend li{margin:4px 0}
`;
