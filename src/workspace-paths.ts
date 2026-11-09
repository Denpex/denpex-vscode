export const WORKSPACE_READ_PATHS = new Set([
    '/api/monitor/status', '/api/monitor/incidents', '/api/fleet/reliability', '/api/fleet/readiness',
    '/api/fleet/change-correlation', '/api/predictive/scores', '/api/fleet/node-health',
    '/api/verification/outcomes', '/api/fleet/incidents', '/api/fleet/reliability-report',
    '/api/fleet/multicloud', '/api/mfu/history', '/api/fleet/evidence',
    '/api/fleet/rma-payload', '/api/fleet/capacity-report',
    '/api/preflight/benchmarks',
]);

export function isWorkspaceReadPath(path: unknown): path is string {
    if (typeof path !== 'string' || path.length > 2048 || !path.startsWith('/api/') || path.includes('#')) return false;
    const url = new URL(path, 'https://api.denpex.com');
    return url.origin === 'https://api.denpex.com' && (WORKSPACE_READ_PATHS.has(url.pathname) || /^\/api\/preflight\/benchmark\/[a-zA-Z0-9-]{1,64}$/.test(url.pathname));
}

export const WORKSPACE_WRITE_PATHS = new Set(['/api/incidents/ack', '/api/incidents/snooze', '/api/alerts/resolve']);
export function isWorkspaceWriteRequest(path: unknown, body: unknown): boolean {
    if (typeof path !== 'string') return false;
    if (!WORKSPACE_WRITE_PATHS.has(path)) return false;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const data = body as Record<string, unknown>;
    if (typeof data.incidentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.incidentId)) return false;
    const keys = Object.keys(data);
    if (path === '/api/incidents/ack') return keys.every(key => ['incidentId','acknowledged'].includes(key)) && (data.acknowledged === undefined || typeof data.acknowledged === 'boolean');
    if (path === '/api/incidents/snooze') return keys.every(key => ['incidentId','minutes'].includes(key)) && [0,60].includes(data.minutes as number);
    return keys.every(key => ['incidentId','diagnosisId','humanConfirmed','reason'].includes(key)) && typeof data.diagnosisId === 'string'
        && /^[a-zA-Z0-9_-]{8,64}$/.test(data.diagnosisId) && data.humanConfirmed === true && typeof data.reason === 'string' && data.reason.trim().length > 0 && data.reason.length <= 500;
}
