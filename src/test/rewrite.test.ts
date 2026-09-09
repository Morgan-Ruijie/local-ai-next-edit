import test from "node:test";
import assert from "node:assert/strict";
import { buildRewritePrompt, isLoopbackOllamaUrl, repairObviousContextTypo, repairObviousIdentifierTypo, sanitizeReplacement, simpleGlobMatch } from "../rewrite";

test("builds a strict replacement-only prompt", () => {
  const prompt = buildRewritePrompt({
    fileName: "x.py", language: "python", contextBefore: "", codeToEdit: "pritn('x')", contextAfter: "", diagnostic: "not defined",
  });
  assert.match(prompt, /Return only the replacement text/);
  assert.match(prompt, /CODE_TO_EDIT:\npritn\('x'\)/);
});

test("sanitizes a fenced model response", () => {
  assert.equal(sanitizeReplacement("```python\nprint('x')\n```", "pritn('x')", 3), "print('x')");
  assert.equal(sanitizeReplacement("a\nb", "a", 3), undefined);
  assert.equal(sanitizeReplacement("pritn", "pritn('x')", 3), undefined);
});

test("allows only local Ollama endpoints", () => {
  assert.equal(isLoopbackOllamaUrl("http://localhost:11434"), true);
  assert.equal(isLoopbackOllamaUrl("http://127.0.0.1:11434"), true);
  assert.equal(isLoopbackOllamaUrl("https://example.com"), false);
});

test("matches default excluded paths", () => {
  assert.equal(simpleGlobMatch("C:/x/node_modules/a.js", ["**/node_modules/**"]), true);
  assert.equal(simpleGlobMatch("C:/x/main.py", ["**/node_modules/**"]), false);
});

test("safely repairs a unique diagnostic-named keyword typo", () => {
  assert.equal(repairObviousIdentifierTypo("inport numpy as np", "python", "'inport' is not defined"), "import numpy as np");
  assert.equal(repairObviousIdentifierTypo("value = thing", "python", "unrelated diagnostic"), undefined);
});

test("repairs an undefined dotted receiver from repeated nearby usage", () => {
  const context = "plt.plot(x, y)\nplt.savefig('x.png')\nnp.array(values)";
  assert.equal(repairObviousContextTypo("pkt.show()", context, "", "未定义“pkt”"), "plt.show()");
  assert.equal(repairObviousContextTypo("pkt.show()", "abc.run()\ndef.run()", "", "未定义“pkt”"), undefined);
});
