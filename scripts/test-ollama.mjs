const baseUrl = process.env.OLLAMA_URL || "http://localhost:11434";
const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:1.5b";
const { rewriteWithOllama } = await import("../dist/ollama.js");

const cases = [
  ["inport numpy as np", "Invalid syntax: 'inport' is not defined", "import numpy as np", "(none)"],
  ["import nimpy as np", "Import 'nimpy' could not be resolved", "import numpy as np", "inport numpy as np"],
  ['pritn("hello")', "'pritn' is not defined", 'print("hello")', "inport numpy as np\nimport nimpy as np"],
  ["pkt.show()", "未定义“pkt”", "plt.show()", "plt.plot(x, y)\nplt.savefig('x.png')"],
];

for (const [code, diagnostic, expected, contextBefore] of cases) {
  const input = {
    fileName: "test.py",
    language: "python",
    contextBefore,
    codeToEdit: code,
    contextAfter: "",
    diagnostic,
  };
  const actual = await rewriteWithOllama(input, code, { baseUrl, model, keepAlive: "30m", maxEditLines: 3 }, new AbortController().signal);
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"}: ${JSON.stringify(code)} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  if (!pass) process.exitCode = 1;
}

