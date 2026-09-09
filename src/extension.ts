import * as vscode from "vscode";
import { rewriteWithOllama } from "./ollama";
import { simpleGlobMatch } from "./rewrite";

interface RecentEdit {
  uri: string;
  version: number;
  firstLine: number;
  lastLine: number;
  at: number;
}

interface CachedSuggestion {
  uri: string;
  version: number;
  range: vscode.Range;
  original: string;
  replacement: string;
  diagnostic: vscode.Diagnostic;
}

let recentEdit: RecentEdit | undefined;
let cached: CachedSuggestion | undefined;
let timer: NodeJS.Timeout | undefined;
let request: AbortController | undefined;
let generation = 0;
let output: vscode.OutputChannel;
let previewDecoration: vscode.TextEditorDecorationType | undefined;

function config() {
  const c = vscode.workspace.getConfiguration("localNextEdit");
  return {
    enabled: c.get("enabled", true),
    ollamaUrl: c.get("ollamaUrl", "http://localhost:11434"),
    model: c.get("model", "qwen2.5-coder:1.5b"),
    debounceMs: Math.max(300, c.get("debounceMs", 400)),
    maxEditLines: Math.max(1, Math.min(3, c.get("maxEditLines", 3))),
    showInlinePreview: c.get("showInlinePreview", true),
    keepAlive: c.get("keepAlive", "30m"),
    exclude: c.get<string[]>("exclude", []),
  };
}

function cancelWork(clearCache = true): void {
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = undefined;
  request?.abort();
  request = undefined;
  if (clearCache) cached = undefined;
  previewDecoration && vscode.window.visibleTextEditors.forEach((editor) => editor.setDecorations(previewDecoration!, []));
  void vscode.commands.executeCommand("setContext", "localNextEdit.hasSuggestion", false);
}

function showPreview(editor: vscode.TextEditor, item: CachedSuggestion): void {
  if (!previewDecoration || !config().showInlinePreview) return;
  editor.setDecorations(previewDecoration, [{
    range: item.range,
    hoverMessage: new vscode.MarkdownString(`Local rewrite: \`${item.replacement.replace(/`/g, "\\`")}\`\n\n**Tab** accept · **Esc** reject`),
    renderOptions: {
      before: { contentText: "↻ ", color: new vscode.ThemeColor("editorInfo.foreground") },
      after: { contentText: `  → ${item.replacement}`, color: new vscode.ThemeColor("editorGhostText.foreground"), fontStyle: "italic" },
    },
  }]);
}

function isEligibleDocument(document: vscode.TextDocument): boolean {
  const c = config();
  if (!c.enabled || document.isClosed || document.uri.scheme !== "file") return false;
  if (document.lineCount > 20_000) return false;
  return !simpleGlobMatch(document.uri.fsPath, c.exclude);
}

function relevantDiagnostic(document: vscode.TextDocument, edit: RecentEdit): vscode.Diagnostic | undefined {
  return vscode.languages
    .getDiagnostics(document.uri)
    .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
    .filter((d) => d.range.start.line <= edit.lastLine + 2 && d.range.end.line >= edit.firstLine - 2)
    .sort((a, b) => {
      const aDistance = Math.abs(a.range.start.line - edit.lastLine);
      const bDistance = Math.abs(b.range.start.line - edit.lastLine);
      return aDistance - bDistance || a.severity - b.severity;
    })[0];
}

function schedule(delay?: number): void {
  if (timer) clearTimeout(timer);
  const ms = delay ?? config().debounceMs;
  timer = setTimeout(() => void generateSuggestion(), ms);
}

async function generateSuggestion(explicit = false): Promise<void> {
  timer = undefined;
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isEligibleDocument(editor.document)) return;

  const document = editor.document;
  const edit = recentEdit;
  if (!edit || edit.uri !== document.uri.toString() || edit.version !== document.version) return;
  if (!explicit && Date.now() - edit.at < config().debounceMs - 20) {
    schedule(config().debounceMs);
    return;
  }

  const diagnostic = relevantDiagnostic(document, edit);
  if (!diagnostic) return;

  const line = Math.max(0, Math.min(document.lineCount - 1, diagnostic.range.start.line));
  const lineText = document.lineAt(line).text;
  if (!lineText.trim() || lineText.length > 500) return;

  const range = new vscode.Range(line, 0, line, lineText.length);
  const beforeStart = Math.max(0, line - 30);
  const afterEnd = Math.min(document.lineCount, line + 16);
  const before = document.getText(new vscode.Range(beforeStart, 0, line, 0)).trimEnd();
  const after = line + 1 < afterEnd
    ? document.getText(new vscode.Range(line + 1, 0, afterEnd, 0)).trimEnd()
    : "";

  request?.abort();
  const controller = new AbortController();
  request = controller;
  const currentGeneration = ++generation;
  const c = config();
  output.appendLine(`[request] ${document.fileName}:${line + 1} — ${diagnostic.message}`);

  try {
    const replacement = await rewriteWithOllama(
      {
        fileName: document.fileName.split(/[\\/]/).pop() || document.fileName,
        language: document.languageId,
        contextBefore: before,
        codeToEdit: lineText,
        contextAfter: after,
        diagnostic: diagnostic.message,
      },
      lineText,
      {
        baseUrl: c.ollamaUrl,
        model: c.model,
        keepAlive: c.keepAlive,
        maxEditLines: c.maxEditLines,
      },
      controller.signal,
    );

    if (controller.signal.aborted || currentGeneration !== generation) return;
    const active = vscode.window.activeTextEditor;
    if (!replacement || replacement === lineText || !active || active.document.uri.toString() !== edit.uri || active.document.version !== edit.version) {
      output.appendLine("[skip] Model returned no safe change.");
      return;
    }

    cached = { uri: edit.uri, version: edit.version, range, original: lineText, replacement, diagnostic };
    output.appendLine(`[suggest] ${JSON.stringify(lineText)} -> ${JSON.stringify(replacement)}`);
    showPreview(active, cached);
    await vscode.commands.executeCommand("setContext", "localNextEdit.hasSuggestion", true);
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
  } catch (error) {
    if (!controller.signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[error] ${message}`);
    }
  } finally {
    if (request === controller) request = undefined;
  }
}

function inlineItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  _context: vscode.InlineCompletionContext,
  token: vscode.CancellationToken,
): vscode.InlineCompletionItem[] {
  const item = cached;
  if (token.isCancellationRequested || !item) return [];
  if (item.uri !== document.uri.toString() || item.version !== document.version || !item.range.contains(position)) return [];
  if (document.getText(item.range) !== item.original) return [];

  const completion = new vscode.InlineCompletionItem(item.replacement, item.range);
  completion.filterText = item.original;
  return [completion];
}

function codeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
  const item = cached;
  if (!item || item.uri !== document.uri.toString() || item.version !== document.version || !item.range.intersection(range)) return [];
  if (document.getText(item.range) !== item.original) return [];

  const action = new vscode.CodeAction("Apply Local AI rewrite", vscode.CodeActionKind.QuickFix);
  action.isPreferred = false;
  action.diagnostics = [item.diagnostic];
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, item.range, item.replacement);
  action.edit = edit;
  return [action];
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Local AI Next Edit", { log: true });
  previewDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: false,
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
  });
  context.subscriptions.push(output);
  context.subscriptions.push(previewDecoration);
  void vscode.commands.executeCommand("setContext", "localNextEdit.hasSuggestion", false);

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (!event.contentChanges.length || !isEligibleDocument(event.document)) return;
    const firstLine = Math.min(...event.contentChanges.map((change) => change.range.start.line));
    const lastLine = Math.max(...event.contentChanges.map((change) => change.range.end.line + change.text.split(/\r?\n/).length - 1));
    cancelWork();
    recentEdit = {
      uri: event.document.uri.toString(),
      version: event.document.version,
      firstLine,
      lastLine,
      at: Date.now(),
    };
    schedule();
  }));

  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics((event) => {
    if (!recentEdit || Date.now() - recentEdit.at > 4_000) return;
    if (event.uris.some((uri) => uri.toString() === recentEdit?.uri)) schedule(50);
  }));

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => cancelWork()));
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!cached) return;
    if (cached.uri !== event.textEditor.document.uri.toString() || !cached.range.contains(event.selections[0].active)) cancelWork();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("localNextEdit")) cancelWork();
  }));

  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ scheme: "file" }, {
    provideInlineCompletionItems: inlineItems,
  }));

  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
    provideCodeActions: codeActions,
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));

  context.subscriptions.push(vscode.commands.registerCommand("localNextEdit.trigger", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const line = editor.selection.active.line;
    recentEdit = { uri: editor.document.uri.toString(), version: editor.document.version, firstLine: line, lastLine: line, at: 0 };
    cancelWork();
    recentEdit = { uri: editor.document.uri.toString(), version: editor.document.version, firstLine: line, lastLine: line, at: 0 };
    await generateSuggestion(true);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("localNextEdit.clearSuggestion", () => cancelWork()));
  context.subscriptions.push(vscode.commands.registerCommand("localNextEdit.acceptSuggestion", async () => {
    const editor = vscode.window.activeTextEditor;
    const item = cached;
    if (!editor || !item || item.uri !== editor.document.uri.toString() || item.version !== editor.document.version || editor.document.getText(item.range) !== item.original) {
      cancelWork();
      return;
    }
    cancelWork();
    await editor.edit((builder) => builder.replace(item.range, item.replacement), { undoStopBefore: true, undoStopAfter: true });
  }));
  output.appendLine("Ready. Automatic requests are limited to recent edits near Error/Warning diagnostics.");
}

export function deactivate(): void {
  cancelWork();
}

