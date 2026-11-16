import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Load the Worker as an ES module without requiring a package.json or Wrangler.
const workerSource = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModuleUrl = "data:text/javascript;base64," + Buffer.from(workerSource).toString("base64");
const worker = (await import(workerModuleUrl)).default;

const env = {}; // These boundary checks must run before DB/AI bindings are needed.
const call = (url, init) => worker.fetch(new Request(url, init), env);

test("allows CORS preflight from the apex frontend", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "OPTIONS",
    headers: { Origin: "https://contentpilot.ir" }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://contentpilot.ir");
  assert.match(response.headers.get("Vary") || "", /Origin/i);
});

test("allows CORS preflight from the www frontend", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "OPTIONS",
    headers: { Origin: "https://www.contentpilot.ir" }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://www.contentpilot.ir");
});

test("rejects an unapproved browser origin", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" }
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("rejects methods other than POST after preflight handling", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "GET",
    headers: { Origin: "https://contentpilot.ir" }
  });
  assert.equal(response.status, 405);
});

test("rejects non-JSON POST bodies", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "text/plain"
    },
    body: "not json"
  });
  assert.equal(response.status, 415);
});

test("rejects requests declaring a body larger than 16 KiB", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "Content-Length": String(16 * 1024 + 1)
    },
    body: "{}"
  });
  assert.equal(response.status, 413);
});
