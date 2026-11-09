import * as vscode from 'vscode';

/** Traceback locations are context, not proof that every source frame is defective. */
export class DiagnosticsProvider {
    private readonly diagnosticCollection = vscode.languages.createDiagnosticCollection('denpex-tracebacks');
    private generation = 0;
    public getCollection(): vscode.DiagnosticCollection { return this.diagnosticCollection; }
    public async parseTracebacksAndPublish(uri: vscode.Uri): Promise<void> {
        const generation = ++this.generation;
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const diagnostics: vscode.Diagnostic[] = [];
            document.getText().split(/\r?\n/).forEach((line, index) => {
                const match = /File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?/i.exec(line);
                if (!match) return;
                const diagnostic = new vscode.Diagnostic(new vscode.Range(index, 0, index, line.length),
                    `Traceback context: ${match[1]}:${match[2]}${match[3] ? ` in ${match[3].trim()}` : ''}. This frame does not establish the fault location.`,
                    vscode.DiagnosticSeverity.Information);
                diagnostic.source = 'Denpex traceback context';
                diagnostics.push(diagnostic);
            });
            if (generation !== this.generation) return;
            this.diagnosticCollection.clear();
            this.diagnosticCollection.set(uri, diagnostics);
        } catch { /* Unavailable evidence must not interfere with a report. */ }
    }
    public clear(): void { this.generation++; this.diagnosticCollection.clear(); }
    public dispose(): void { this.generation++; this.diagnosticCollection.dispose(); }
}
