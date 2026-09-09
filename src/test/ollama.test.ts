import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rewriteWithOllama } from "../ollama";

test("passes keep_alive and sanitizes a local Ollama response", async () => {
  let received = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => { received += chunk; });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ response: "print(\"hello\")\n" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const result = await rewriteWithOllama(
      { fileName: "x.py", language: "python", contextBefore: "", codeToEdit: "pritn(\"hello\")", contextAfter: "", diagnostic: "not defined" },
      "pritn(\"hello\")",
      { baseUrl: `http://127.0.0.1:${address.port}`, model: "qwen2.5-coder:1.5b", keepAlive: "30m", maxEditLines: 3 },
      new AbortController().signal,
    );
    assert.equal(result, 'print("hello")');
    assert.equal(JSON.parse(received).keep_alive, "30m");
    assert.equal(JSON.parse(received).options.num_predict, 128);
  } finally {
    server.close();
  }
});

test("aborts an in-flight request", async () => {
  const server = createServer(() => { /* Deliberately never respond. */ });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();

  try {
    const pending = rewriteWithOllama(
      { fileName: "x.py", language: "python", contextBefore: "", codeToEdit: "bad", contextAfter: "", diagnostic: "bad" },
      "bad",
      { baseUrl: `http://127.0.0.1:${address.port}`, model: "qwen2.5-coder:1.5b", keepAlive: "30m", maxEditLines: 3 },
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
