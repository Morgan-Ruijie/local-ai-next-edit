export interface RewritePromptInput {
  fileName: string;
  language: string;
  contextBefore: string;
  codeToEdit: string;
  contextAfter: string;
  diagnostic: string;
}

export function buildRewritePrompt(input: RewritePromptInput): string {
  return `You are performing a tiny code edit.

Fix CODE_TO_EDIT using the surrounding context and diagnostic.

Rules:
- Make the smallest reasonable correction.
- Preserve indentation and formatting.
- Preserve arguments, string literals, comments, and punctuation unless the diagnostic specifically requires changing them.
- For a misspelled identifier, replace only that identifier and keep the rest of the line byte-for-byte unchanged.
- Do not explain.
- Do not use markdown fences.
- Return only the replacement text for CODE_TO_EDIT.
- If no correction is clearly justified, return the original text unchanged.
- Never add unrelated code.
- The replacement must remain a complete line of code, not a fragment.

Examples:
CODE_TO_EDIT: inport pandas as pd
DIAGNOSTIC: "inport" is not defined
REPLACEMENT: import pandas as pd

CODE_TO_EDIT: pritn("ok")
DIAGNOSTIC: "pritn" is not defined
REPLACEMENT: print("ok")

FILE:
${input.fileName}

LANGUAGE:
${input.language}

CONTEXT BEFORE:
${input.contextBefore || "(none)"}

CODE_TO_EDIT:
${input.codeToEdit}

CONTEXT AFTER:
${input.contextAfter || "(none)"}

DIAGNOSTIC:
${input.diagnostic}

REPLACEMENT:`;
}

export function sanitizeReplacement(raw: string, original: string, maxLines: number): string | undefined {
  let value = raw.replace(/^\uFEFF/, "").trimEnd();
  const fenced = value.match(/^```(?:[\w.+-]+)?\s*\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced) value = fenced[1].trimEnd();
  value = value.replace(/^\s*(?:REPLACEMENT|CODE_TO_EDIT)\s*:\s*/i, "");

  if (!value || value.includes("\u0000")) return undefined;
  const lineCount = value.split(/\r?\n/).length;
  if (lineCount > Math.max(1, Math.min(3, maxLines))) return undefined;

  // The stable VS Code inline-completion API can replace only one line.
  if (original.split(/\r?\n/).length === 1 && lineCount !== 1) return undefined;
  if ((original.match(/^\s*/) || [""])[0] !== (value.match(/^\s*/) || [""])[0]) return undefined;

  // The MVP is for typo-like rewrites. Dropping calls, arguments, strings, or
  // operators is a strong signal that a small model ignored the instruction.
  const structure = (text: string) => text.replace(/[\p{L}\p{N}_\s]/gu, "");
  if (structure(original) !== structure(value)) return undefined;
  if (original.length >= 8 && value.length < original.length * 0.65) return undefined;
  return value;
}

export function isLoopbackOllamaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function simpleGlobMatch(path: string, patterns: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const source = pattern
      .replace(/\\/g, "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${source}$`, "i").test(normalized) || new RegExp(source, "i").test(normalized);
  });
}

const identifierVocabulary: Readonly<Record<string, readonly string[]>> = {
  python: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "print", "raise", "return", "True", "try", "while", "with", "yield"],
  javascript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "let", "new", "return", "switch", "throw", "try", "var", "while"],
  typescript: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "else", "enum", "export", "extends", "finally", "for", "from", "function", "if", "implements", "import", "interface", "let", "new", "return", "switch", "throw", "try", "type", "var", "while"],
  rust: ["as", "async", "await", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
};

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function diagnosticNamesToken(diagnostic: string, token: string): boolean {
  const quoted = [...diagnostic.matchAll(/["'“‘]([A-Za-z_][A-Za-z0-9_]*)["'”’]/g)].map((match) => match[1].toLowerCase());
  if (quoted.length) return quoted.includes(token.toLowerCase());
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(diagnostic);
}

export function repairObviousContextTypo(
  original: string,
  contextBefore: string,
  contextAfter: string,
  diagnostic: string,
): string | undefined {
  const context = `${contextBefore}\n${contextAfter}`;
  const tokens = [...original.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)];
  for (const token of tokens) {
    if (!diagnosticNamesToken(diagnostic, token[0])) continue;
    const tokenEnd = token.index! + token[0].length;
    const isReceiver = /^\s*\./.test(original.slice(tokenEnd));
    const matches = isReceiver
      ? [...context.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\./g)].map((match) => match[1])
      : [...context.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0]);
    const frequencies = new Map<string, number>();
    for (const match of matches) frequencies.set(match, (frequencies.get(match) || 0) + 1);
    const candidates = [...frequencies.entries()]
      .map(([replacement, frequency]) => ({ replacement, frequency, distance: editDistance(token[0], replacement) }))
      .filter((candidate) => candidate.distance > 0 && candidate.distance <= (token[0].length >= 5 ? 2 : 1))
      .sort((a, b) => a.distance - b.distance || b.frequency - a.frequency || a.replacement.localeCompare(b.replacement));
    const best = candidates[0];
    if (!best) continue;
    const tied = candidates[1] && candidates[1].distance === best.distance && candidates[1].frequency === best.frequency;
    if (tied) continue;
    return `${original.slice(0, token.index!)}${best.replacement}${original.slice(tokenEnd)}`;
  }
  return undefined;
}

export function repairObviousIdentifierTypo(original: string, language: string, diagnostic: string): string | undefined {
  const vocabulary = identifierVocabulary[language];
  if (!vocabulary) return undefined;
  const tokens = [...original.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)];
  const candidates: Array<{ token: RegExpMatchArray; replacement: string; distance: number }> = [];
  for (const token of tokens) {
    if (!diagnosticNamesToken(diagnostic, token[0])) continue;
    for (const word of vocabulary) {
      const distance = editDistance(token[0], word);
      if (distance > 0 && distance <= (token[0].length >= 5 ? 2 : 1)) candidates.push({ token, replacement: word, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  if (!candidates[0] || (candidates[1] && candidates[1].distance === candidates[0].distance)) return undefined;
  const best = candidates[0];
  const start = best.token.index!;
  return `${original.slice(0, start)}${best.replacement}${original.slice(start + best.token[0].length)}`;
}

