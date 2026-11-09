export interface ClipboardReport<T> { result: T; logs: string; }
export class ClipboardCoordinator<T> {
    private busy = false;
    private cached: {key: string; report: ClipboardReport<T>} | undefined;
    async run(key: string, actions: { analyze: () => Promise<ClipboardReport<T> | undefined>; reopen: (report: ClipboardReport<T>) => void; confirmReanalysis: () => Promise<boolean>; alreadyRunning: () => void }): Promise<void> {
        if (this.busy) { actions.alreadyRunning(); return; }
        this.busy = true;
        try {
            if (this.cached?.key === key) {
                actions.reopen(this.cached.report);
                if (!await actions.confirmReanalysis()) return;
            }
            const report = await actions.analyze();
            if (report) this.cached = { key, report };
        } finally { this.busy = false; }
    }
}
