import { clarificationChoices } from './clarification-contract';
import * as vscode from 'vscode';
import { DENPEX_WORDMARK_HTML, DENPEX_WORDMARK_CSS } from './brand';
import { DASHBOARD_URL, SITE_URL, attribute, DiagnoseResponse } from './api';

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function nonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

function parseJsonArray(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // Server caps stringified chains at 1200 chars, which can cut mid-object.
        // Recover every complete object we can rather than dropping the section.
        const objects: any[] = [];
        const matches = raw.match(/\{[^{}]*\}/g) || [];
        for (const m of matches) {
            try { objects.push(JSON.parse(m)); } catch { /* skip partial tail */ }
        }
        return objects;
    }
}

function section(title: string, bodyHtml: string, open = false, id?: string): string {
    if (!bodyHtml) return '';
    return `<details${id ? ` id="${escapeHtml(id)}"` : ''}${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary><div class="section-body">${bodyHtml}</div></details>`;
}

function pre(text: unknown): string {
    return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

/**
 * Narrow a nullable wire string to a non-empty string, else undefined.
 * The worker sends `null` (not an absent key) for "no note", and a whitespace-only
 * note would otherwise render an empty warning box that reads as a real warning.
 */
function str(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}

function actionBlock(label: string, command: string | null | undefined, kind: 'exec' | 'copy' = 'copy'): string {
    if (!command) return '';
    const unavailable = /^unavailable:/i.test(command);
    const btns = kind === 'exec'
        ? `<button type="button" class="btn" data-cmd="runInTerminal" data-text="${escapeHtml(command)}">▶ Execute</button><button type="button" class="btn ghost" data-cmd="insertInTerminal" data-text="${escapeHtml(command)}" title="Insert at terminal prompt without executing">$ Insert</button>`
        : '';
    const copy = unavailable ? '' : `<button type="button" class="btn ghost" data-cmd="copy" data-text="${escapeHtml(command)}">Copy</button>`;
    const body = kind === 'exec' ? pre(command) : `<p class="action-copy">${escapeHtml(command)}</p>`;
    return `<div class="action"><div class="action-head"><strong>${escapeHtml(label)}</strong><span class="btns">${btns}${copy}</span></div>${body}</div>`;
}

function confidenceBar(confidence: number): string {
    const pct = Math.max(0, Math.min(100, Math.round(confidence)));
    const tone = pct >= 80 ? 'var(--vscode-testing-iconPassed)' : pct >= 55 ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-editorError-foreground)';
    return `<div class="conf" role="progressbar" aria-label="Diagnosis confidence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="conf-track" aria-hidden="true"><div class="conf-fill" style="width:${pct}%;background:${tone}"></div></div><span>${pct}% confidence</span></div>`;
}

function falseBlameShieldHtml(failureType: string | undefined): string {
    const ft = String(failureType || '').toUpperCase();
    let msg = '';
    if (ft === 'TORCHDYNAMO_GUARD_FAILURE_RECOMPILE_STORM') {
        msg = 'FALSE-BLAME SHIELD (NETWORK & GPU EXONERATED): This is NOT an InfiniBand/RoCE fabric drop or dead GPU. A single rank stalled in TorchDynamo/Triton JIT recompilation after a dynamic shape guard failure while peer ranks timed out in NCCL Watchdog.';
    } else if (ft === 'MOE_ALLTOALL_HOT_EXPERT_LOAD_IMBALANCE') {
        msg = 'FALSE-BLAME SHIELD (GPU SILICON EXONERATED): Do NOT drain or RMA this GPU. Silicon health is normal; ncclKernel_AllToAll stalled because a Hot Expert received skewed token routing load.';
    } else if (ft === 'FP8_MXFP8_AMAX_SCALING_OVERFLOW') {
        msg = 'FALSE-BLAME SHIELD (SILENT DATA CORRUPTION RULED OUT): Do NOT RMA this GPU for NaN loss. The NaN was caused by FP8 E4M3 amax scaling saturation (448.0 ceiling), not a hardware ALU fault.';
    } else if (ft === 'STORAGE' || ft === 'STORAGE_BACKPRESSURE_DISAMBIGUATOR' || ft === 'LUSTRE_METADATA_BOTTLENECK') {
        msg = 'FALSE-BLAME SHIELD (NCCL FABRIC EXONERATED): Do NOT reset NICs or switches. Rank 0 is blocked in Linux kernel D-state (TASK_UNINTERRUPTIBLE) waiting on parallel filesystem checkpoint I/O.';
    } else if (ft === 'RAY_RLHF_POST_TRAINING_TRIAGE') {
        msg = 'FALSE-BLAME SHIELD (GPU HARDWARE EXONERATED): Do NOT cordon this node. The crash was triggered by Ray /dev/shm Plasma Object Store exhaustion or actor RSS memory monitor enforcement.';
    } else if (ft === 'CSP_SPOT_MAINTENANCE_PREEMPTION') {
        msg = 'FALSE-BLAME SHIELD (APPLICATION CODE EXONERATED): Do NOT debug model code or NCCL flags. This job was terminated by a Cloud Provider Spot/Maintenance preemption signal.';
    }
    if (!msg) return '';
    return `<section class="box shield-card" aria-label="False-blame hardware shield">
        <div class="shield-header"><span class="shield-pill">🛡️ FALSE-BLAME SHIELD</span><span class="shield-sub">DO NOT DRAIN OR RMA NODES</span></div>
        <strong class="shield-title">${escapeHtml(msg.split(':')[0])}</strong>
        <p class="shield-body">${escapeHtml(msg.split(':').slice(1).join(':').trim())}</p>
        <div class="shield-actions">
            <button type="button" class="btn" data-cmd="copyIncidentReport">Copy Slack #cluster-alerts proof</button>
            <button type="button" class="btn ghost" data-cmd="startTrial">Start 30-Day Trial in Editor (No Browser)</button>
            <button type="button" class="btn ghost" data-cmd="open" data-text="${escapeHtml(attribute(`${SITE_URL}/pricing#team`, 'pricing'))}">Team Plan ($499/mo · up to 128 GPUs)</button>
        </div>
    </section>`;
}

export function generateIncidentMarkdown(d: DiagnoseResponse): string {
    const fix = d.fix || {};
    const meta = d.meta || {};
    const chain = parseJsonArray(fix.causationChain);
    const initiator = chain.find((c: any) => String(c.role || '').toLowerCase().includes('initiator')) || chain[0];

    const lines: string[] = [
        '### GPU Crash Incident Summary (Denpex)',
        `- **Failure Type**: ${meta.failureType || 'Distributed GPU / ML Incident'}`,
        `- **Diagnosis Tier**: ${meta.tier === 4 ? 'Deep Cloud Analysis' : 'Deterministic Engine'}`,
    ];

    if (initiator && initiator.event) {
        lines.push(`- **Root Cause**: ${initiator.event}`);
    } else if (fix.summary) {
        lines.push(`- **Root Cause**: ${fix.summary}`);
    }

    if (d.costHeadline) {
        lines.push(`- **Impact**: ${d.costHeadline}`);
    }

    if (d.resumeSafetyNote) {
        lines.push(`- **Checkpoint Safety**: ${d.resumeSafetyNote}`);
    }

    if (fix.action) {
        lines.push('\n#### Recommended Fix');
        lines.push('```bash');
        lines.push(fix.action);
        lines.push('```');
    }

    if (fix.fallbackAction) {
        lines.push('\n#### Fallback Action');
        lines.push('```bash');
        lines.push(fix.fallbackAction);
        lines.push('```');
    }

    if (fix.verificationInstructions) lines.push('\n#### Manual verification', fix.verificationInstructions);
    if (fix.verificationCommand) {
        lines.push('\n#### Verification Command');
        lines.push('```bash');
        lines.push(fix.verificationCommand);
        lines.push('```');
    }

    if (fix.evidence?.length) {
        lines.push('\n#### Supporting evidence', ...fix.evidence.map(value => `> ${String(value).replace(/\n/g, '\n> ')}`));
    }
    const applicability = d.forensicReport?.remedyApplicability;
    if (applicability) {
        lines.push('\n#### Applicability and recovery', String(applicability.scope || ''), String(applicability.verification || ''));
    }
    lines.push('\nRecovery is not independently established by this diagnosis.');
    for (const assessment of d.localAssessmentHistory || (d.localAssessment ? [d.localAssessment] : [])) {
        lines.push(`\n#### Operator assessment: ${assessment.outcome}`, assessment.evidence);
    }

    // This report is pasted by the user into Slack or a GitHub PR, so this link is the
    // only one that reaches people who have not installed anything. Attributed for that
    // reason: it is the extension's single measurable word-of-mouth surface.
    lines.push(`\n*Diagnosed with Denpex GPU & ML Crash Diagnostics (${attribute(SITE_URL, 'incident-report')})*`);
    return lines.join('\n');
}

export function renderDiagnosis(input: DiagnoseResponse | undefined, focusSection?: string, showTrialOffer = true, preparedText = ''): string {
    const hasDiagnosis = Boolean(input);
    const d = input || { success: false, source: 'canonical-offline' };
    const fix = d.fix || {};
    const meta = d.meta || {};
    const n = nonce();

    const isLocal = d.source === 'canonical-offline'
        || meta.source === 'canonical-offline'
        || /offline|local/i.test(String(d.source || meta.source || ''));
    const tierLabel = d.source === 'stored-cloud-report' ? 'Saved report' : isLocal ? 'Local diagnosis' : meta.tier === 4 ? 'Deep Analysis' : meta.tier === 2 ? 'Community Match' : meta.tier === 1.5 ? 'Encyclopedia' : meta.tier === 1.6 ? 'Keyword Match' : 'Deterministic Engine';
    const badges = [
        `<span class="badge">${escapeHtml(tierLabel)}</span>`,
        d.costHeadline ? `<span class="badge cost">${escapeHtml(d.costHeadline)}</span>` : '',
    ].filter(Boolean).join(' ');
    const incidentLink = typeof d.diagnosisId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(d.diagnosisId)
        ? `<p><a href="${SITE_URL}/console?open=${encodeURIComponent(d.diagnosisId)}">Open this incident or reinvestigate</a></p>` : '';

    const cloudQuestions=Array.isArray(fix.clarifyingQuestions)?fix.clarifyingQuestions.filter(value=>typeof value==='string').slice(0,4):[];
    const cloudPurpose=cloudQuestions.length || d.forensicReport?.remedyApplicability?.status==='needs-evidence'
        ? 'More facts are needed to distinguish the remaining causes. A cloud review can reassess the supplied evidence, but incomplete logs may still require a specific diagnostic check.'
        : 'Use another review if this recommendation does not fit your installed stack or the attempted change did not resolve the failure. Include the relevant versions and what happened after the attempt.';
    const cloudPurposeHtml=`<p class="meta">${escapeHtml(cloudPurpose)}</p>${cloudQuestions.length?`<ul>${cloudQuestions.map(question=>`<li>${escapeHtml(question)}</li>`).join('')}</ul>`:''}<p class="meta">Cloud review does not independently verify recovery or retrieve unapproved cluster facts. Reopened local reports need the original log supplied again.</p>`;
    const cloudOfferHtml = isLocal ? `<section class="box cloud-review-offer" aria-labelledby="cloud-review-title">
        <h2 id="cloud-review-title">Get a second assessment with cloud review</h2>
        <p>Preview and edit the excerpts you want to share. The cloud assessment returns in this report and may ask for more evidence.</p>
        <button type="button" class="btn" data-cmd="escalateCloud">Preview cloud review</button>
        <p class="meta">Nothing is sent until you approve on the next screen. One account-free review may be available, subject to server limits. Local-only mode blocks uploads. A second assessment does not guarantee a root cause.</p>
    </section>` : '';
    const nextActionHtml = `<section class="next-actions" aria-label="Report actions"><div class="next-heading"><strong>Work with this report locally</strong><span class="meta">Copy, export or prepare feedback in your editor. Nothing is submitted automatically.</span></div>
        <button type="button" class="btn" data-cmd="diagnoseOwnLog">Diagnose a different log</button>
        <button type="button" class="btn ghost" data-cmd="copyIncidentReport">Copy report</button>
        <button type="button" class="btn ghost" data-cmd="prepareLocalFeedback">Prepare feedback locally</button>
        ${!isLocal ? '<button type="button" class="btn ghost" data-cmd="escalateCloud">Preview another cloud review</button><button type="button" class="btn ghost" data-cmd="submitCloudFeedback">Send outcome feedback to Denpex...</button>' : ''}
    </section>`;

    // ── Traceback / causal chain analysis ──
    const chain = parseJsonArray(fix.causationChain);
    const chainHtml = chain.length ? `<ol class="chain">${chain.map((c: any) => `
        <li class="chain-${escapeHtml(String(c.role || '').toLowerCase().replace(/_/g, '-'))}">
            <span class="chain-role">${escapeHtml(c.role || '')}</span>
            <div>${escapeHtml(c.event || '')}</div>
            ${c.evidence ? `<code class="evidence-line">${escapeHtml(c.evidence)}</code>` : ''}
        </li>`).join('')}</ol>` : '';
    const evidence = Array.isArray(fix.evidence) ? [...new Set(fix.evidence.filter(Boolean))] : [];
    const evidenceHtml = evidence.length ? `<ul>${evidence.slice(0, 6).map((e) => `<li><code>${escapeHtml(e)}</code></li>`).join('')}</ul>${evidence.length > 6 ? `<details><summary>Show ${evidence.length - 6} more evidence lines</summary><ul>${evidence.slice(6).map((e) => `<li><code>${escapeHtml(e)}</code></li>`).join('')}</ul></details>` : ''}` : '';
    const tracebackBody = (chainHtml || evidenceHtml)
        ? `${chainHtml}${evidenceHtml ? `<h3>Matched evidence</h3>${evidenceHtml}` : ''}` : '';

    // ── Competing hypotheses ──
    const hyps = parseJsonArray(fix.competingHypotheses);
    const hypsHtml = hyps.length ? `<table><tr><th>Theory</th><th>Score</th><th>Supporting</th><th>Contradicting</th></tr>${hyps.map((h: any) => `
        <tr><td>${escapeHtml(h.theory || '')}</td><td>${escapeHtml(h.score ?? '')}</td><td>${escapeHtml(h.supporting || '')}</td><td>${escapeHtml(h.contradicting || '')}</td></tr>`).join('')}</table>` : '';

    // ── Confidence detail ──
    const fr = d.forensicReport || {};
    const artifacts = Array.isArray(fr.diagnosticArtifacts) ? fr.diagnosticArtifacts.slice(0, 5) : [];
    const artifactHtml = artifacts.length ? section('GPU artifact measurements', artifacts.map((artifact: any) => {
        const names: Record<string, string> = { 'flight-recorder': 'Collective flight recorder', 'memory-snapshot': 'CUDA memory snapshot',
            nsight: 'Nsight kernel trace', checkpoints: 'Checkpoint candidates', stragglers: 'Aligned rank timings' };
        const devices = artifact.module === 'memory-snapshot' && Array.isArray(artifact.metrics?.devices) ? artifact.metrics.devices.slice(0, 256) : [];
        const mib = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${(value / 1048576).toFixed(2)} MiB` : 'Unknown';
        const table = devices.length ? `<div role="region" tabindex="0" aria-label="CUDA memory measurements" style="overflow:auto"><table><caption>Per-device allocator memory</caption><thead><tr><th scope="col">GPU</th><th scope="col">Reserved</th><th scope="col">Requested</th><th scope="col">Awaiting free</th><th scope="col">Inactive</th></tr></thead><tbody>${devices.map((device: any) => `<tr><td>${escapeHtml(device.device)}</td><td>${mib(device.reservedBytes)}</td><td>${mib(device.requestedBytes)}</td><td>${mib(device.awaitingFreeBytes)}</td><td>${mib(device.inactiveBytes)}</td></tr>`).join('')}</tbody></table></div>` : pre(JSON.stringify(artifact.metrics || {}, null, 2));
        const limitations = Array.isArray(artifact.limitations) ? `<ul>${artifact.limitations.map((item: unknown) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
        const findings = Array.isArray(artifact.findings) ? `<ul>${artifact.findings.map((finding: any) => `<li>${escapeHtml(finding.detail)}</li>`).join('')}</ul>` : '';
        return `<p><strong>${escapeHtml(names[artifact.module] || 'GPU artifact')}</strong>: ${artifact.status === 'COMPLETE' ? 'Local inspection completed' : 'Inspection incomplete'}.</p>${table}${findings}${limitations}`;
    }).join(''), true, 'gpu-artifacts') : '';

    const confDetail = fr.confidenceDetail || {};
    const confParts: string[] = [];
    // CALIBRATED value only. This read `meta.confidence`, the raw score, which
    // includes confidence bands whose measured top-1 accuracy does not justify
    // printing a number. The API already decides that and returns
    // `fix.confidenceDisplay: null` to mean "withheld", a distinct claim from
    // "zero", so it is checked with an explicit typeof rather than coerced.
    //
    // When it IS withheld, say so: a missing bar reads as "no confidence data",
    // which understates a verdict the engine is otherwise sure about.
    const displayConfidence = fix.confidenceDisplay;
    if (typeof displayConfidence === 'number') {
        confParts.push(confidenceBar(displayConfidence));
    } else if (fix.confidenceBand) {
        confParts.push(`<p class="muted">Confidence: ${escapeHtml(fix.confidenceBand)}, a precise figure is withheld because this calibration band is not accurate enough to report.</p>`);
    }
    const confList = (label: string, items: unknown) => Array.isArray(items) && items.length
        ? `<h3>${escapeHtml(label)}</h3><ul>${(items as unknown[]).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '';
    confParts.push(confList('Supporting', confDetail.supporting));
    confParts.push(confList('Contradicting', confDetail.contradicting));
    confParts.push(confList('Unknowns', confDetail.unknowns));
    confParts.push(confList('Missing telemetry', confDetail.missingTelemetry));
    const confBody = confParts.filter(Boolean).join('');

    // ── Hardware telemetry ──
    const hwParts: string[] = [];
    const detectors = d.advanced?.detectors || [];
    if (detectors.length) {
        hwParts.push(`<table><tr><th>Detector</th><th>Severity</th><th>Finding</th></tr>${detectors.map((det) =>
            `<tr><td>${escapeHtml(det.title || det.id || '')}</td><td>${escapeHtml(det.severity || '')}</td><td>${escapeHtml(det.summary || '')}</td></tr>`).join('')}</table>`);
    }
    const telemetryEvidence = (fr as any).telemetryEvidence || {};
    if (Array.isArray(telemetryEvidence.indicting) && telemetryEvidence.indicting.length) {
        hwParts.push(`<h3>Indicting signals</h3><ul>${telemetryEvidence.indicting.map((s: string) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul>`);
    }
    if (Array.isArray(telemetryEvidence.exonerating) && telemetryEvidence.exonerating.length) {
        hwParts.push(`<h3>Exonerating signals</h3><ul>${telemetryEvidence.exonerating.map((s: string) => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul>`);
    }
    if (fr.predictiveMaintenance) {
        const pm = fr.predictiveMaintenance;
        hwParts.push(`<p><strong>Predictive maintenance:</strong> ${escapeHtml(pm.metric || '')}, ${escapeHtml(pm.probabilityOfFailure ?? '?')}% failure risk within ${escapeHtml(pm.timeframe || 'N/A')}. ${escapeHtml(pm.recommendation || '')}</p>`);
    }
    if (d.advanced?.predictive?.score) {
        const p = d.advanced.predictive;
        hwParts.push(`<p><strong>Degradation forecast:</strong> score ${escapeHtml(p.score)} (${escapeHtml(p.level || '')}), ${escapeHtml((p.signals || []).join(', '))}</p>`);
    }
    const hwBody = hwParts.join('');

    // ── Recommended actions ladder ──
    const steps = Array.isArray(fix.steps) && fix.steps.length ? `<h3>Full fix procedure</h3><ol>${fix.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : '';
    const planActions = d.executionPlan?.actions || [];
    const planActionKind = str(d.resumeSafetyNote) ? 'copy' : 'exec';
    const planHtml = planActions.length ? `<h3>Closed-loop remediation plan</h3>${planActions.map((a) =>
        actionBlock(`${a.action || 'STEP'}, ${a.reason || ''}`, a.command, planActionKind)).join('')}` : '';
    const applicability = fr.remedyApplicability;
    const applicabilityHtml = applicability && typeof applicability.scope === 'string' && Array.isArray(applicability.prerequisites)
        ? `<div class="action"><h3>${applicability.status === 'needs-evidence' ? 'Evidence needed before a complete remedy' : 'When this recommendation applies'}</h3><p>${escapeHtml(applicability.scope)}</p><ul>${applicability.prerequisites.map((value:unknown)=>`<li>${escapeHtml(value)}</li>`).join('')}</ul><p><strong>Recovery check:</strong> ${escapeHtml(applicability.verification)}</p><p>This recommendation does not authorize remote execution or certify workload recovery.</p></div>` : '';
    const actionsBody = [
        applicabilityHtml,
        incidentLink,
        actionBlock('Primary fix', fix.action),
        actionBlock('If that doesn\'t work', fix.fallbackAction),
        actionBlock('Emergency mitigation', fix.emergencyAction),
        fix.verificationInstructions ? `<div class="action"><strong>Manual verification</strong><p>${escapeHtml(fix.verificationInstructions)}</p></div>` : actionBlock('Verify the fix', fix.verificationCommand),
        fix.prevention ? `<div class="action"><strong>Prevention</strong><p>${escapeHtml(fix.prevention)}</p></div>` : '',
        steps,
        planHtml,
    ].filter(Boolean).join('');

    // ── Advisories ──
    const advisories = d.advisory || [];
    const advBody = advisories.length ? advisories.map((a) =>
        `<div class="advisory advisory-${escapeHtml(a.severity || 'info')}"><strong>${escapeHtml(a.summary || '')}</strong><p>${escapeHtml(a.action || '')}</p></div>`).join('') : '';

    // ── Alternatives ──
    const alts = fix.alternatives || [];
    const altBody = alts.length ? `<ul>${alts.map((a) => `<li><strong>${escapeHtml(a.title || a.failureType || '')}</strong>${typeof a.confidence === 'number' ? ` (${escapeHtml(a.confidence)}%)` : ''}</li>`).join('')}</ul>` : '';

    // ── Sources ──
    const refs = [...(d.communityRefs || []), ...(d.researchRefs || [])];
    const refBody = refs.length ? `<ul>${refs.map((r) => `<li><a href="#" data-cmd="open" data-text="${escapeHtml((r as any).url || '')}">${escapeHtml(r.title || (r as any).url || '')}</a> <span class="dim">${escapeHtml((r as any).source || '')}</span></li>`).join('')}</ul>` : '';

    // ── Prior incident / clarifying questions ──
    const prior = d.priorIncident?.note ? `<div class="advisory advisory-info"><strong>You've hit this before</strong><p>${escapeHtml(d.priorIncident.note)}</p>${d.priorIncident.action ? pre(d.priorIncident.action) : ''}</div>` : '';
    // Structured questions preferred; the plain list is the fallback for an older worker.
    // `(Recommended)` is emitted ONLY for an `action` question: recommending an answer
    // to a question of fact returns the hinted answer instead of the observed one, and
    // the next verdict is then built on an observation nobody made.
    const choices = clarificationChoices(fix.clarifyingChoices, fix.clarifyingQuestions);
    const questionsHtml = choices.length ? `<form id="clarification-form" class="advisory"><h2>Help narrow this down</h2><p>Answer what you observed. Choosing a check does not establish its result.</p>${choices.map((q,index) => `<fieldset data-question-id="${escapeHtml(q.id)}"><legend>${escapeHtml(q.question)}</legend>${q.options.map(o => `<label class="clarification-card"><input type="radio" name="clarification-${index}" value="${escapeHtml(o.id)}"><span>${escapeHtml(o.label)}${o.recommended && q.kind === 'action' ? ' <strong>(Recommended)</strong>' : ''}${o.detail ? `<small>${escapeHtml(o.detail)}</small>` : ''}</span></label>`).join('')}<label class="clarification-card"><input type="radio" name="clarification-${index}" value="custom"><span>Type your own answer...</span></label><label class="custom-answer" hidden>Your observed answer<textarea maxlength="4000" aria-label="Your answer to ${escapeHtml(q.question)}"></textarea></label></fieldset>`).join('')}<button type="submit" class="btn">Submit answers</button><p id="clarification-status" role="status" aria-live="polite"></p></form>` : '';

    // ── Checkpoint resume safety ──
    // This panel renders an unconditional "Restart from Checkpoint" button. If the
    // engine says the checkpoint may be poisoned and we do not show that, the button
    // is a one-click way to resume onto corrupt state and lose the run. The warning
    // is rendered ABOVE the fold (before the action ladder) and again at the button.
    const resumeSafety = str(d.resumeSafetyNote);
    const inferenceOnly = /^(INFERENCE_|VLLM_|TENSORRT_)/i.test(meta.failureType || '');
    const genericUnknownCheckpoint = inferenceOnly && Boolean(resumeSafety) && /unknown|not applicable/i.test(resumeSafety || '') && !/corrupt|poison|unsafe|invalid/i.test(resumeSafety || '');
    const resumeSafetyHtml = genericUnknownCheckpoint
        ? section('Checkpoint information (if applicable)', `<p>${escapeHtml(resumeSafety)}</p>`)
        : resumeSafety
        ? `<div class="advisory advisory-critical"><strong>⛔ Checkpoint safety, read before restarting</strong><p>${escapeHtml(resumeSafety)}</p></div>`
        : '';
    const resumeFrom = str(fix.resumeFrom) ?? str(d.resumeFrom);
    const checkpointRestartReady = d.checkpointIntegrity?.isSafe === true && Boolean(resumeFrom);
    const resumeFromHtml = resumeFrom
        ? `<div class="advisory"><strong>Resume from</strong><p>${escapeHtml(resumeFrom)}</p></div>`
        : '';

    // Shown only when a numeric confidence was withheld, so the reader learns the
    // engine declined to commit rather than seeing a blank where a score should be.
    const confidenceBand = str(d.confidenceBand) ?? str(fix.confidenceBand);

    // Detection site ≠ origin site. Without this the reader blames the node that logged.
    const originNote = str(d.originNote);
    const originHtml = originNote
        ? `<div class="advisory advisory-warning"><strong>Detection ≠ origin</strong><p>${escapeHtml(originNote)}</p></div>`
        : '';

    // ── The honesty trail ──
    const contradictions = (d.contradictions || []).filter(Boolean);
    const ranked = d.rankedHypotheses || [];
    const secondaryHw = str(d.secondaryHardwareNote);
    const trailBody = [
        contradictions.length
            ? `<h3>Why not the obvious answer (rejected on evidence)</h3><ul>${contradictions.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
            : '',
        secondaryHw
            ? `<h3>Also found, real, but not the root cause</h3><p>${escapeHtml(secondaryHw)}</p><p class="dim">Do not raise an RMA on this alone.</p>`
            : '',
        ranked.length
            ? `<h3>Leading hypotheses</h3><ul>${ranked.map((h) => {
                const conf = typeof h.confidence === 'number' ? ` <span class="dim">(${escapeHtml(h.confidence)}%)</span>` : '';
                const ev = (label: string, xs?: string[]) => xs && xs.length
                    ? `<span class="evidence-line">${label}: ${escapeHtml(xs.join('; '))}</span>` : '';
                return `<li><strong>${escapeHtml(h.label || h.key || 'hypothesis')}</strong>${conf}${ev('For', h.evidenceFor)}${ev('Against', h.evidenceAgainst)}</li>`;
            }).join('')}</ul>`
            : '',
    ].filter(Boolean).join('');

    const remainingNote = typeof d.remaining === 'number' && isFinite(d.remaining)
        ? `<p class="meta">${d.remaining} free diagnos${d.remaining === 1 ? 'is' : 'es'} remaining today · <a href="#" data-cmd="open" data-text="${escapeHtml(attribute(DASHBOARD_URL, 'panel'))}">denpex.com/dashboard</a></p>`
        : '';

    const initiatingEvent = chain.find((event: any) => /initiator|root.cause/i.test(String(event.role || '')));
    const structuredInitiator = d.initiator;
    const hasStructuredInitiator = structuredInitiator && (typeof structuredInitiator.rank === 'number' || Boolean(structuredInitiator.node));
    const initiatingLabel = initiatingEvent?.event || (hasStructuredInitiator
        ? [typeof structuredInitiator.rank === 'number' ? `Rank ${structuredInitiator.rank}` : '', structuredInitiator.node].filter(Boolean).join(' on ')
        : 'Not established');
    const incidentOverview = `<section class="incident-overview" aria-label="Incident overview">
        <div><span class="metric-label">Analysis</span><strong>${isLocal ? 'Local engine' : 'Cloud review'}</strong><span class="meta">${isLocal ? 'No log upload' : 'Requested cloud analysis'}</span></div>
        <div><span class="metric-label">Evidence</span><strong>${evidence.length} matched lines</strong><span class="meta">${chain.length} causal events</span></div>
        <div><span class="metric-label">Initiating event</span><strong>${escapeHtml(initiatingLabel)}</strong><span class="meta">${initiatingEvent || hasStructuredInitiator ? 'Attributed from this log' : 'Do not infer a rank without evidence'}</span></div>
    </section>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<title>Denpex investigation</title>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
    :root {
        --denpex-bg: #151515;
        --denpex-surface: #1C1C1C;
        --denpex-surface-alt: #222222;
        --denpex-border: #333333;
        --denpex-border-mid: #3A3A3A;
        --denpex-text-main: #E5E5E5;
        --denpex-text-mid: #A8A8A8;
        --denpex-text-dim: #8E8E8E;
        --denpex-accent: #CC5A37;
        --denpex-accent-text: #D6795C;
        --denpex-accent-sub: #241410;
        --denpex-green: #4ADE80;
        --denpex-green-sub: #052E16;
        --denpex-mono: #D1FAE5;
        --denpex-code-bg: #101010;
    }
    body.vscode-light {
        --denpex-bg: var(--vscode-editor-background);
        --denpex-surface: var(--vscode-editorWidget-background);
        --denpex-surface-alt: var(--vscode-sideBar-background);
        --denpex-border: var(--vscode-widget-border);
        --denpex-border-mid: var(--vscode-widget-border);
        --denpex-text-main: var(--vscode-editor-foreground);
        --denpex-text-mid: var(--vscode-descriptionForeground);
        --denpex-text-dim: var(--vscode-descriptionForeground);
        --denpex-accent-text: #9e351d;
        --denpex-accent-sub: #f9ebe6;
        --denpex-green: #15803d;
        --denpex-green-sub: #dcfce7;
        --denpex-mono: var(--vscode-editor-foreground);
        --denpex-code-bg: var(--vscode-textCodeBlock-background);
    }
    body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--denpex-text-main); background-color: var(--denpex-bg); line-height: 1.55; }
    h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; color: #E5E5E5; }
    body.vscode-light h1, body.vscode-light h2, body.vscode-light strong { color: var(--vscode-editor-foreground); }
    h2 { font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; color: #E5E5E5; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--denpex-text-dim); margin: 14px 0 6px; font-weight: 500; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 500; background: #1C1C1C; color: #D4D4D4; border: 1px solid #333333; margin-right: 4px; }
    .badge.type { color: var(--denpex-accent-text); background: rgba(204, 90, 55, 0.08); border-color: rgba(204, 90, 55, 0.28); }
    .badge.cost { background: rgba(239, 68, 68, 0.08); color: #F87171; border-color: rgba(239, 68, 68, 0.28); }
    .badge.dim.dim { opacity: 0.7; }
    .box { border: 1px solid var(--denpex-border); padding: 18px 20px; border-radius: 12px; margin: 14px 0; background: var(--denpex-surface); }
    .shield-card { border: 1px solid rgba(34, 197, 94, 0.32); background: #17201A; }
    .shield-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .shield-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; background: #052E16; border: 1px solid #16A34A; color: #4ADE80; font: 600 10.5px/1.3 ui-monospace, monospace; }
    .shield-sub { font: 500 10.5px/1.2 ui-monospace, monospace; color: var(--denpex-text-dim); letter-spacing: 0.05em; }
    .shield-title { display: block; color: #E5E5E5; font-size: 13.5px; font-weight: 600; margin-bottom: 4px; }
    .shield-body { margin: 0 0 12px !important; font-size: 13px !important; color: #BDBDBD; line-height: 1.55; }
    .shield-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
    details { border: 1px solid var(--denpex-border); border-radius: 12px; margin: 10px 0; background: var(--denpex-surface); overflow: hidden; }
    summary { cursor: pointer; padding: 12px 16px; font-weight: 500; user-select: none; font-size: 13px; color: #E5E5E5; background: var(--denpex-surface); }
    summary:hover { background: #222222; }
    .section-body { padding: 12px 16px 16px; border-top: 1px solid var(--denpex-border); }
    pre { white-space: pre-wrap; word-break: break-word; background: #181818; color: #D4D4D4; border: 1px solid #2B2B2B; padding: 12px 14px; border-radius: 8px; margin: 8px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #D4D4D4; background: #181818; border: 1px solid #2B2B2B; padding: 1px 6px; border-radius: 5px; font-size: 0.9em; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    th, td { border: 1px solid var(--denpex-border); padding: 7px 10px; text-align: left; vertical-align: top; }
    th { background: #181818; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--denpex-text-dim); }
    .btn { background: #231915; color: #E5E5E5; font-weight: 500; font-size: 12.5px; border: 1px solid rgba(204, 90, 55, 0.42); padding: 6px 13px; border-radius: 8px; cursor: pointer; margin-left: 6px; transition: background 0.15s ease, border-color 0.15s ease; }
    .btn:hover { background: #2C1E19; border-color: #D6795C; }
    .btn.ghost { background: transparent; color: #D4D4D4; border: 1px solid #333333; font-weight: 500; }
    .btn.ghost:hover { background: #242424; border-color: #454545; }
    body.vscode-light .btn.ghost { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn.cloud { margin-left: 0; font-weight: 500; }
    .choice-list { list-style: none; padding-left: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 6px; }
    .choice-list li { display: flex; align-items: center; gap: 8px; }
    .choice-btn { margin-left: 0 !important; font-size: 0.9em; padding: 4px 10px; }
    .choice-recommended { border: 1px solid var(--vscode-testing-iconPassed); background: var(--vscode-button-background); }
    .next-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 20px 0; padding: 16px 18px; border: 1px solid var(--denpex-border); border-radius: 12px; background: var(--denpex-surface); }
    .next-actions .btn { margin-left: 0; }
    .next-heading { display: flex; flex-direction: column; width: 100%; margin-bottom: 4px; }
    .cloud-option { width: 100%; margin-top: 10px; }
    .cloud-option p { margin: 8px 14px; }
    .cloud-option .btn { margin: 0 0 10px 14px; }
    .action { margin: 10px 0; }
    .action-head { display: flex; justify-content: space-between; align-items: center; }
    .action-copy { margin: 6px 0 14px; padding: 11px 14px; border-radius: 8px; background: #181818; color: #D1FAE5; border: 1px solid #2B2B2B; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .section-body code { overflow-wrap: anywhere; }
    .chain { list-style: none; padding-left: 0; }
    .chain li { border: 1px solid #2B2B2B; border-left: 3px solid #454545; padding: 12px 14px; margin: 8px 0; background: #181818; border-radius: 8px; }
    .chain-root-cause { border-left-color: #F87171 !important; }
    .chain-downstream-symptom { border-left-color: #D97706 !important; }
    .chain-role { font-family: ui-monospace, monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--denpex-text-dim); }
    .chain-root-cause .chain-role { color: #F87171; }
    .chain-downstream-symptom .chain-role { color: #FBBF24; }
    .evidence-line { display: block; margin-top: 6px; opacity: 0.9; font-size: 11.5px; }
    .advisory { border: 1px solid var(--denpex-border); border-radius: 10px; padding: 12px 15px; margin: 10px 0; background: #181818; }
    .advisory-critical { border-color: rgba(239, 68, 68, 0.35); background: #1D1414; }
    .advisory-warning { border-color: rgba(217, 119, 6, 0.35); }
    .conf { display: inline-flex; align-items: center; gap: 10px; margin: 4px 0 12px; padding: 6px 12px; border-radius: 999px; background: #1C1C1C; border: 1px solid #333333; min-width: 220px; font-family: ui-monospace, monospace; font-size: 11.5px; color: #BDBDBD; }
    .conf-track { flex: 1; height: 6px; border-radius: 999px; background: #2B2B2B; overflow: hidden; }
    .conf-fill { height: 100%; border-radius: 999px; }
    body.vscode-light { --denpex-choice-accent:#9B3E12; }
    body.vscode-high-contrast, body.vscode-high-contrast-light { --denpex-choice-accent:var(--vscode-contrastActiveBorder,var(--vscode-focusBorder)); }
    .clarification-card { display:flex; gap:10px; border:1px solid #757575; border-radius:8px; padding:12px; margin:8px 0; cursor:pointer; }
    .clarification-card:has(input:checked) { border-color:var(--denpex-choice-accent,#E87952); background:#CC5A371A; outline:1px solid var(--denpex-choice-accent,#E87952); }
    .clarification-card span, #clarification-form legend { min-width:0; overflow-wrap:anywhere; }
    .clarification-card input { accent-color:var(--denpex-choice-accent,#E87952); }
    .clarification-card strong { color:inherit; }
    .clarification-card small { display:block; margin-top:4px; }
    #clarification-form fieldset { min-width:0; border:0; padding:0; margin:14px 0; }
    #clarification-form textarea { width:100%; min-height:70px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-contrastBorder,#757575); border-radius:6px; padding:10px; font:inherit; }
    .clarification-card:focus-within { outline:2px solid var(--denpex-choice-accent,#E87952); outline-offset:2px; }
    .meta { color: var(--vscode-descriptionForeground); }
    a { color: var(--denpex-accent-text, #D6795C); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; }
    .console-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 0 24px; border-bottom: 1px solid #262626; background: #151515; }
    .brand { font-size: 16px; font-weight: 600; letter-spacing: -.4px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .brand > .meta { color: var(--denpex-text-dim); font-weight: 400; font-size: 12px; }
    ${DENPEX_WORDMARK_CSS}
    .header-pills { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0; }
    .status-pill { display: inline-flex; align-items: center; gap: 6px; font: 500 11.5px/1.2 var(--vscode-font-family); color: #D4D4D4; }
    .status-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #22C55E; }
    .console-header .meta { font-size: 12px; color: var(--denpex-text-dim); }
    .console-shell { display: block; min-height: calc(100vh - 48px); }
    .console-nav { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; margin: 0; padding: 0; background: transparent; position: relative; }
    .nav-label { display: none; }
    .metric-label, .eyebrow { display: block; font-size: 10.5px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; color: var(--denpex-text-dim); margin-bottom: 6px; }
    .eyebrow { color: var(--denpex-accent-text); }
    .console-nav a, .console-nav button { display: inline-flex; align-items: center; width: auto; margin: 0; padding: 5px 9px; border: 1px solid transparent; border-radius: 6px; text-align: left; background: transparent; color: var(--denpex-text-dim); text-decoration: none; font: 400 12px/1.3 var(--vscode-font-family); cursor: pointer; }
    .console-nav a:hover, .console-nav button:hover { color: #E5E5E5; background: #1C1C1C; border-color: #2B2B2B; }
    .nav-note { display: none; }
    .console-content { min-width: 0; width: 100%; max-width: 980px; padding: 16px 24px 48px; margin: 0 auto; }
    .title-row { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin-bottom: 4px; }
    h1 { font-size: 20px; letter-spacing: -.4px; }
    .incident-overview { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 12px; margin: 16px 0; }
    .incident-overview > div { padding: 14px 16px; border: 1px solid var(--denpex-border); border-radius: 12px; background: var(--denpex-surface); min-width: 0; }
    .incident-overview strong { display: block; font-size: 15px; font-weight: 600; color: #E5E5E5; margin-top: 2px; overflow-wrap: anywhere; }
    .incident-overview .meta { display: block; margin-top: 4px; font-size: 11px; color: var(--denpex-text-dim); }
    .investigation-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .investigation-grid > div { min-width: 0; }
    .box { margin-top: 0; padding: 16px 18px; border-radius: 12px; }
    .box p { font-size: 13.5px; color: #BDBDBD; line-height: 1.6; margin-bottom: 0; }
    details { border-radius: 12px; }
    details.report-composer { margin-top: 0; border-color: rgba(204, 90, 55, 0.32); }
    summary { padding: 12px 16px; }
    .chain li { position: relative; padding: 12px 14px; margin: 0 0 8px; border-left-width: 3px; background: #181818; border-radius: 8px; }
    .chain-role { display: block; margin-bottom: 4px; opacity: 1; }
    .btn { min-height: 30px; padding: 6px 12px; margin: 4px 0; border-radius: 8px; font: 500 12.5px/1.3 var(--vscode-font-family); }
    .action-head { flex-wrap: wrap; gap: 8px; }
    .action-copy, pre { padding: 11px 14px; }
    .action { padding-bottom: 12px; border-bottom: 1px solid #262626; }
    .next-actions { margin-top: 20px; }
    .cloud-review-offer { border: 1px solid rgba(204, 90, 55, 0.32); }
    .cloud-review-offer .btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 3px; }
    :focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 3px; }
    .console-header, .action-head { flex-wrap: wrap; }
    .console-content, .investigation-grid > div, .box { min-width: 0; }
    p, strong, summary, .action-copy { overflow-wrap: anywhere; }
    .btn { white-space: normal; max-width: 100%; }
    textarea { max-width: 100%; }
    .console-nav details { margin: 0; border: 0; background: transparent; display: inline-block; position: relative; overflow: visible; }
    .console-nav details summary { padding: 5px 9px; font-size: 12px; font-weight: 400; color: var(--denpex-text-dim); background: transparent; }
    #recommended-actions, #causal-chain { scroll-margin-top: 20px; }
    @media (max-width: 1000px) { .investigation-grid { grid-template-columns: 1fr; } }
    @media (max-width: 700px) { .console-shell { grid-template-columns: 1fr; } .console-nav { border-right: 0; border-bottom: 1px solid var(--vscode-widget-border); padding: 10px; display: flex; flex-wrap: wrap; gap: 4px; } .console-nav a, .console-nav button { width: auto; } .console-nav .nav-label, .nav-note { display: none; } .console-content { padding: 16px; } .incident-overview { grid-template-columns: 1fr; } }
    @media (forced-colors: active) {
        body, .meta, .nav-note, .nav-label, .metric-label, .eyebrow, .muted, .dim { color: CanvasText; background-color: Canvas; }
        .console-nav, .console-header, .box, .section-body, .action-copy, pre { color: CanvasText; background-color: Canvas; }
        .console-nav a, .console-nav button, .brand span, .badge { color: CanvasText; background-color: Canvas; }
        .btn, .btn.ghost, textarea { color: ButtonText !important; background-color: ButtonFace !important; border-color: ButtonText; }
        .incident-overview > div, details, .box { border-color: CanvasText; }
    }
</style>
</head>
<body>
    <header class="console-header"><div class="brand">${DENPEX_WORDMARK_HTML}<span class="meta">console</span></div><nav class="console-nav" aria-label="Console navigation">
        <span class="nav-label">Investigation</span>
        <a href="#overview">Overview</a>
        ${hasDiagnosis ? '<a href="#causal-chain">Evidence and causality</a><a href="#recommended-actions">Fix and verification</a>' : ''}
        <button type="button" data-cmd="diagnoseOwnLog">Diagnose another log</button>
        <button type="button" data-cmd="reopenSaved">Saved investigations</button>
        <details><summary>Account workspace</summary>
        <button type="button" data-cmd="open" data-text="${escapeHtml(attribute(DASHBOARD_URL, 'dashboard'))}">Dashboard (website)</button>
        <button type="button" data-cmd="openFleet">Fleet</button>
        <button type="button" data-cmd="openTopology">Topology</button>
        <p class="nav-note">Fleet and topology require an eligible signed-in account and connected telemetry.</p>
        <button type="button" data-cmd="open" data-text="${escapeHtml(attribute(`${DASHBOARD_URL}?evaluate=incident#first-incident`, 'first_customer'))}">Evaluate my own incident</button>
        <p class="nav-note">Compare a recorded answer with your known remedy, then prove one connected workload's notification and report. This opens the website and does not upload a log.</p>
        </details>
    </nav><div class="header-pills"><span class="status-pill">${isLocal ? 'Status' : 'Cloud'}</span><span class="meta">${d.source === 'stored-cloud-report' ? 'Saved report' : isLocal ? 'Local engine · 0 uploads' : 'Cloud session'}</span></div></header>
    <div class="console-shell">
    <main class="console-content" id="overview">
    ${hasDiagnosis ? '<details class="report-composer"><summary>Paste another log or ask about this result</summary>' : ''}
    <section aria-labelledby="composer-title" class="box">
        ${hasDiagnosis ? '<h2 id="composer-title">Continue investigating</h2>' : '<h1 id="composer-title">Denpex console</h1>'}
        <p>Unlimited local log diagnosis. Cloud review is a separate, optional action.</p>
        <form id="console-input-form">
            <label for="console-input">Paste a log to diagnose</label>
            <textarea id="console-input" rows="6" placeholder="Paste the error and surrounding lines" style="display:block;width:100%;margin:10px 0;padding:12px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-focusBorder));font:inherit;resize:vertical">${escapeHtml(preparedText)}</textarea>
            <button type="submit" class="btn">Diagnose log locally</button>
            <button type="button" class="btn ghost" data-cmd="consoleSample">Try a sample</button>
            <p id="console-status" role="status" aria-live="polite"></p>
        </form>
    </section>
    ${hasDiagnosis ? '</details>' : ''}
    ${hasDiagnosis ? `
    <div class="title-row"><div><span class="eyebrow">Incident investigation</span><h1>Diagnosis</h1></div><div>${badges}</div></div>
    <p class="meta"><strong>${d.localAssessment?.outcome === 'recovered' ? 'Recovery verified (operator reported)' : d.localAssessment?.outcome === 'failed' ? 'Needs evidence after unsuccessful recommendation' : d.forensicReport?.remedyApplicability?.status === 'needs-evidence' || !fix.action ? 'Needs evidence' : 'Recommendation ready'}</strong>. ${d.localAssessment?.outcome === 'recovered' ? 'Your assessment is recorded, not independently certified by Denpex.' : 'Recovery not checked by Denpex.'}</p>
    ${d.localAssessment ? `<div class="box"><h2>Last recovery assessment</h2><p>${escapeHtml(d.localAssessment.evidence)}</p><p class="meta">The original diagnosis remains below. Add a new log for reinvestigation.</p></div>` : ''}
    ${d.localAssessmentHistory?.length ? section('Recovery assessment history', d.localAssessmentHistory.map(assessment=>`<p><strong>${escapeHtml(assessment.outcome)}</strong>: ${escapeHtml(assessment.evidence)}</p>`).join('')) : ''}
    ${incidentOverview}
    ${typeof displayConfidence === 'number'
        ? confidenceBar(displayConfidence)
        : confidenceBand
            ? `<p class="meta">Confidence withheld, below the evidence bar (${escapeHtml(confidenceBand)} band).</p>`
            : ''}
    ${falseBlameShieldHtml(meta.failureType)}

    <div class="box">
        <h2 style="margin-top:0;font-size:1em">${artifacts.length ? 'Observed artifact findings' : 'Likely cause'}</h2>
        <p>${escapeHtml(fix.summary || 'No root cause identified.')}</p>
    </div>

    <section class="box" aria-labelledby="first-check-title"><h2 id="first-check-title">Evidence and next check</h2>
        ${evidence.length ? `<p><code>${escapeHtml(evidence[0])}</code></p>` : '<p>The supplied log does not yet establish a cause.</p>'}
        <div class="action" style="border-bottom:0;padding-bottom:0;margin-bottom:0"><div class="action-head"><span class="meta">Passive verification check (read-only)</span>${fix.verificationCommand ? `<button type="button" class="btn ghost" data-cmd="copy" data-text="${escapeHtml(String(fix.verificationCommand))}">Copy check</button>` : ''}</div><p class="action-copy" style="margin-bottom:0">${escapeHtml(d.offlineDecision?.nextChecks?.[0] || fix.verificationInstructions || fix.verificationCommand || 'Collect the first error, surrounding timestamps and affected rank or device before making changes.')}</p></div></section>
    ${resumeSafetyHtml}
    ${cloudOfferHtml}
    ${d.cloudReview ? `<section class="box" aria-label="Assessment comparison"><h2>Cloud assessment of this incident</h2><p>Preceding finding: ${escapeHtml(d.cloudReview.originalSummary)}</p><p>${escapeHtml(d.cloudReview.note)}</p><button type="button" class="btn ghost" data-cmd="originalAssessment">Show preceding report</button></section>` : ''}
    ${d.qualityReview ? section('Automated evidence checks', `<p>${escapeHtml(d.qualityReview.status)}. Correctness remains unverified.</p><ul>${d.qualityReview.flags.map(flag => `<li>${escapeHtml(flag.replace(/_/g, ' '))}</li>`).join('')}</ul><p>No flags or model agreement does not prove a root cause.</p>`) : ''}
    ${d.teamContinuation ? `<section class="box" aria-labelledby="team-title"><h2 id="team-title">Continue with your team</h2><p>Request a 30-day company evaluation for further cloud review and shared incident history. Work-email verification is required. No card or automatic subscription.</p><p>Your incident can be saved in encrypted local storage with a 24-hour expiry. Expired data is deleted when Denpex opens or checks it. Returning never uploads automatically.</p><button type="button" class="btn" data-cmd="requestTeamEvaluation">Request evaluation</button><button type="button" class="btn ghost" data-cmd="connectPendingAccount">Connect an existing account</button><button type="button" class="btn ghost" data-cmd="resumePendingReview">Resume saved incident</button></section>` : ''}
    ${originHtml}
    ${prior}
    ${questionsHtml}

    <div class="investigation-grid"><div>
    ${artifactHtml}
    ${section('Detailed remediation', actionsBody || pre(fix.action || 'Check logs for details.'), true, 'recommended-actions')}
    </div><div>
    ${section('Evidence and causal chain', tracebackBody || '<p>No causal chain or matched evidence was returned. Collect the initiating error before attributing a rank.</p>', true, 'causal-chain')}
    </div></div>
    ${nextActionHtml}
    <section class="box" aria-labelledby="followup-title"><h2 id="followup-title">Ask about this result</h2><p class="meta">Local mode stays on this machine. Connected cloud follow-ups continue the same incident after an editable preview and Send approval.</p><label for="followup-input">Question about cause, evidence or verification</label><textarea id="followup-input" rows="2" placeholder="What evidence supports this?" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-focusBorder);padding:10px;font:inherit"></textarea><button type="button" id="ask-local" class="btn">Ask about this diagnosis</button><div id="local-conversation" role="log" aria-label="Local follow-up conversation" aria-live="polite"></div></section>
    <section class="box" aria-labelledby="save-title"><h2 id="save-title">Keep this investigation</h2><p class="meta">Save only when you choose. Saved reports include evidence excerpts and stay on the extension host until deleted.</p><button type="button" class="btn" data-cmd="saveInvestigation">Save locally</button><button type="button" class="btn ghost" data-cmd="exportInvestigation">Export report</button><button type="button" class="btn ghost" data-cmd="reopenSaved">Reopen</button><button type="button" class="btn ghost" data-cmd="assessRecovery">Record recovery result</button><button type="button" class="btn ghost" data-cmd="deleteSaved">Delete saved report</button></section>
    ${trailBody ? section('Why this answer (audit trail)', trailBody) : ''}
    ${section('Competing Hypotheses', hypsHtml)}
    ${section('Confidence & Calibration', confBody)}
    ${section('Hardware Telemetry', hwBody)}
    ${section('Advisories', advBody)}
    ${section('Alternative Diagnoses', altBody)}
    ${section('Sources & Research', refBody)}
    ${meta.failureType ? section('Technical details', `<p>Pattern: ${escapeHtml(meta.failureType)}</p>${meta.source ? `<p>Engine source: ${escapeHtml(meta.source)}</p>` : ''}`) : ''}

    ${resumeFromHtml}
    ${resumeSafety && !genericUnknownCheckpoint ? `<div class="advisory advisory-critical"><strong>⛔ Do not restart until you have read the checkpoint safety warning above.</strong></div>` : ''}
    <p class="meta">
        ${checkpointRestartReady ? '<button type="button" class="btn ghost" data-cmd="restartCheckpoint">Review checkpoint restart command</button>' : !inferenceOnly ? '<span class="meta">Checkpoint restart unavailable until a specific checkpoint has supporting integrity evidence.</span>' : ''}
        ${/XID|ECC|NVLINK|PCIE|GPU_FALLEN|GPU_GSP|HARDWARE/i.test(meta.failureType || '') ? '<button class="btn ghost" data-cmd="generateRma">Generate hardware support report</button>' : ''}
        <button class="btn ghost" data-cmd="open" data-text="${escapeHtml(attribute(DASHBOARD_URL, 'dashboard'))}">Open Dashboard</button>
    </p>
    ${remainingNote}
    ` : '<section class="box"><h2>Start with your log. See the evidence.</h2><p>Paste a traceback from any rank, or run the bundled OOM cascade. The report will show the initiating event, supporting lines, safe next actions, and any uncertainty. Nothing is uploaded by local diagnosis.</p></section>'}
    </main></div>

    <script nonce="${n}">
        const vscode = acquireVsCodeApi();
        const input = document.getElementById('console-input');
        const status = document.getElementById('console-status');
        const form = document.getElementById('console-input-form');
        let busy = false;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (busy) return;
            if (input.value.trim().length < 6) { status.textContent = 'Paste at least 6 characters of error context.'; return; }
            busy = true;
            status.textContent = 'Diagnosing locally. Your log stays on this machine.';
            vscode.postMessage({ command: 'diagnoseConsoleInput', text: input.value });
        });
        const clarification = document.getElementById('clarification-form');
        clarification?.addEventListener('change', () => {
            clarification.querySelectorAll('fieldset').forEach(group => {
                group.querySelector('.custom-answer').hidden = group.querySelector('input:checked')?.value !== 'custom';
            });
        });
        clarification?.addEventListener('submit', event => {
            event.preventDefault();
            if (busy) return;
            const answers = Array.from(clarification.querySelectorAll('fieldset')).flatMap(group => {
                const selected = group.querySelector('input:checked');
                if (!selected) return [];
                const text = selected.value === 'custom' ? group.querySelector('textarea').value.trim() : '';
                return selected.value === 'custom' && !text ? [] : [{questionId:group.dataset.questionId,optionId:selected.value,text}];
            });
            if (!answers.length) {document.getElementById('clarification-status').textContent='Choose an answer or enter your own.';return;}
            busy = true;
            clarification.querySelectorAll('input,textarea,button').forEach(control => control.disabled=true);
            vscode.postMessage({command:'submitClarifyingAnswers',text:JSON.stringify(answers)});
        });
        const followup = document.getElementById('followup-input');
        document.getElementById('ask-local')?.addEventListener('click', () => {
            if (!followup.value.trim() || busy) return;
            busy=true;
            followup.disabled=true;
            document.getElementById('ask-local').disabled=true;
            vscode.postMessage({ command: 'askLocalFollowUp', text: followup.value });
        });
        window.addEventListener('message', (event) => {
            if (event.data?.command === 'consoleReady') { busy = false; followup.disabled=false;document.getElementById('ask-local').disabled=false; status.textContent = event.data.text || ''; clarification?.querySelectorAll('input,textarea,button').forEach(control => control.disabled=false); if(event.data.collectEvidence){clarification?.remove();input.focus();} }
            if (event.data?.command === 'localFollowUp') {
                busy=false;followup.disabled=false;document.getElementById('ask-local').disabled=false;
                const turn = document.createElement('section');
                const question = document.createElement('strong');
                question.textContent = event.data.question;
                const answer = document.createElement('p');
                answer.style.whiteSpace = 'pre-wrap';
                answer.textContent = event.data.text;
                turn.append(question, answer);
                document.getElementById('local-conversation').append(turn);
                followup.value = '';
            }
        });
        document.addEventListener('click', (e) => {
            const anchor = e.target.closest('a[href^="#"]:not([data-cmd])');
            if (anchor) {
                const target = document.getElementById(anchor.getAttribute('href').slice(1));
                if (target) { if (target.tagName === 'DETAILS') target.open = true; }
            }
            const el = e.target.closest('[data-cmd]');
            if (!el) return;
            e.preventDefault();
            vscode.postMessage({
                command: el.dataset.cmd,
                qid: el.dataset.qid || '',
                oid: el.dataset.oid || '',
                question: el.dataset.question || '',
                text: el.dataset.text || '',
                reason: el.dataset.reason || '',
            });
        });
        const focusSection = ${JSON.stringify(focusSection || '')};
        if (focusSection) {
            const target = document.getElementById(focusSection);
            if (target) {
                target.open = true;
                target.scrollIntoView({ block: 'start' });
            }
        }
    </script>
</body>
</html>`;
}

let currentPanel: vscode.WebviewPanel | undefined;
let currentMessageHandler: Parameters<typeof showDiagnosisPanel>[1] | undefined;

export function showDiagnosisPanel(
    d: DiagnoseResponse | undefined,
    onMessage: (message: { command: string; text?: string; reason?: string; qid?: string; oid?: string; question?: string }) => void,
    focusSection?: string,
    showTrialOffer = true,
    preparedText = '',
): vscode.WebviewPanel {
    currentMessageHandler = onMessage;
    if (currentPanel) {
        currentPanel.title = 'Denpex: Console';
        currentPanel.webview.html = renderDiagnosis(d, focusSection, showTrialOffer, preparedText);
        currentPanel.reveal(vscode.ViewColumn.Active, true);
        return currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
        'denpexDiagnosis',
        'Denpex: Console',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    currentPanel = panel;
    panel.onDidDispose(() => {
        if (currentPanel === panel) { currentPanel = undefined; currentMessageHandler = undefined; }
    });
    panel.webview.html = renderDiagnosis(d, focusSection, showTrialOffer, preparedText);
    panel.webview.onDidReceiveMessage((message) => currentMessageHandler?.(message));
    return panel;
}
