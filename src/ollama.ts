import { buildRewritePrompt, RewritePromptInput, sanitizeReplacement, isLoopbackOllamaUrl, repairObviousContextTypo, repairObviousIdentifierTypo } from "./rewrite";

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  keepAlive: string;
  maxEditLines: number;
}

interface GenerateResponse {
  response?: string;
  error?: string;
}

export async function rewriteWithOllama(
  input: RewritePromptInput,
  original: string,
  options: OllamaOptions,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!isLoopbackOllamaUrl(options.baseUrl)) {
    throw new Error("Ollama URL must be a local http://localhost, 127.0.0.1, or [::1] address.");
  }

  // Prefer a deterministic, zero-latency repair when a diagnostic-named typo
  // has one unambiguous near-match used in the same syntactic role nearby.
  const contextRepair = repairObviousContextTypo(original, input.contextBefore, input.contextAfter, input.diagnostic);
  if (contextRepair !== undefined) return contextRepair;

  const endpoint = new URL("/api/generate", options.baseUrl).toString();
  const generate = async (prompt: string): Promise<string> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        prompt,
        stream: false,
        keep_alive: options.keepAlive,
        options: {
          temperature: 0,
          num_predict: 128,
          num_ctx: 4096,
          repeat_penalty: 1.05,
        },
      }),
      signal,
    });
    const body = (await response.json()) as GenerateResponse;
    if (!response.ok || body.error) throw new Error(body.error || `Ollama request failed with HTTP ${response.status}`);
    return body.response || "";
  };

  const prompt = buildRewritePrompt(input);
  const firstRaw = await generate(prompt);
  const first = sanitizeReplacement(firstRaw, original, options.maxEditLines);
  if (first !== undefined) return first;

  // One bounded retry is allowed only when the local safety gate rejects a
  // malformed answer. Ordinary successful requests never pay this cost.
  const retryPrompt = buildRewritePrompt({
    ...input,
    diagnostic: `${input.diagnostic}\n\nA previous candidate was rejected as an incomplete fragment: ${JSON.stringify(firstRaw.trim())}. Return the COMPLETE corrected CODE_TO_EDIT line. Do not delete any token except the misspelled identifier; replace that identifier in place.`,
  });
  const secondRaw = await generate(retryPrompt);
  return sanitizeReplacement(secondRaw, original, options.maxEditLines)
    ?? repairObviousIdentifierTypo(original, input.language, input.diagnostic);
}
