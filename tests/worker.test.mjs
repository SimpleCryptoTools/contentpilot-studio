import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Load the Worker as an ES module without requiring a package.json or Wrangler.
const workerSource = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const workerModuleUrl = "data:text/javascript;base64," + Buffer.from(workerSource).toString("base64");
const worker = (await import(workerModuleUrl)).default;

const env = {}; // Boundary tests use no live D1 or Workers AI services.
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

test("rejects an oversized streamed body even without Content-Length", async () => {
  const oversizedJson = JSON.stringify({ payload: "x".repeat(16 * 1024) });
  const request = new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json"
    },
    body: oversizedJson
  });
  assert.equal(request.headers.get("Content-Length"), null);
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
});

test("returns a client error for malformed JSON", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json"
    },
    body: "{invalid"
  });
  assert.equal(response.status, 400);
});

test("fails closed for valid JSON when service bindings are missing", async () => {
  const response = await call("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action: "me" })
  });
  assert.equal(response.status, 500);
});

test("uses a transactional D1 batch for credit debit and ledger entry", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => null,
            sql,
            args
          };
        }
      };
    },
    async batch(statements) {
      calls.push(statements);
      return [
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } }
      ];
    }
  };

  const reservation = await (await import(workerModuleUrl)).reserveGeneration(db, "user-1");
  assert.deepEqual(reservation, { type: "credit", userId: "user-1" });
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].sql.includes("UPDATE wallets"));
  assert.ok(calls[0][0].sql.includes("credits = credits - 1"));
  assert.ok(calls[0][1].sql.includes("INSERT INTO credit_ledger"));
  assert.ok(calls[0][1].sql.includes("WHERE changes() = 1"));
});

test("does not create a credit reservation when the wallet debit changes no row", async () => {
  let batchCalls = 0;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return { first: async () => null, sql, args };
        }
      };
    },
    async batch() {
      batchCalls++;
      return [{ success: true, meta: { changes: 0 } }, { success: true, meta: { changes: 0 } }];
    }
  };

  await assert.rejects(
    () => (async () => {
      const module = await import(workerModuleUrl);
      return module.reserveGeneration(db, "user-2");
    })(),
    error => error?.status === 402
  );
  assert.equal(batchCalls, 1);
});


test("registration works without a Workers AI binding", async () => {
  const batchStatements = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (this.sql.includes("INSERT INTO auth_rate_limits")) {
            return { attempts: 1 };
          }
          if (this.sql.includes("SELECT id FROM users")) return null;
          if (this.sql.includes("SELECT credits FROM wallets")) return { credits: 0 };
          if (this.sql.includes("SELECT count FROM usage_daily")) return null;
          throw new Error("Unexpected D1 query in registration test: " + this.sql);
        }
      };
    },
    async batch(statements) {
      batchStatements.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };

  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.10"
    },
    body: JSON.stringify({
      action: "register",
      email: "new-user@example.com",
      password: "correct-horse-battery"
    })
  }), { DB: db });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.user.email, "new-user@example.com");
  assert.equal(typeof payload.accessToken, "string");
  assert.equal(payload.accessToken.length, 64);
  assert.equal(batchStatements.length, 1);
  assert.equal(batchStatements[0].length, 3);
});

test("reserves a free generation before falling back to paid credits", async () => {
  const prepared = [];
  let batchCalls = 0;
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...args) {
          prepared.push({ sql, args });
          return { first: async () => ({ count: 2 }), sql, args };
        }
      };
    },
    async batch() {
      batchCalls++;
      throw new Error("paid-credit batch must not run for a free reservation");
    }
  };

  const module = await import(workerModuleUrl);
  const reservation = await module.reserveGeneration(db, "free-user");
  assert.equal(reservation.type, "free");
  assert.equal(reservation.userId, "free-user");
  assert.match(reservation.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(batchCalls, 0);
  assert.match(prepared[0].sql, /ON CONFLICT\(user_id, action, usage_date\)/);
  assert.match(prepared[0].sql, /usage_daily.count < \?/);
  assert.deepEqual(prepared[0].args.slice(0, 1), ["free-user"]);
});

test("refunds a failed free generation by decrementing its daily reservation", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => { calls.push({ sql, args }); return { success: true }; }
          };
        }
      };
    }
  };
  const module = await import(workerModuleUrl);
  await module.refundGeneration(db, {
    type: "free", userId: "free-user", date: "2026-11-16"
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE usage_daily/);
  assert.match(calls[0].sql, /count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END/);
  assert.deepEqual(calls[0].args, ["free-user", "2026-11-16"]);
});

test("refunds a failed paid generation with a transactional wallet and ledger batch", async () => {
  const batches = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) { return { sql, args }; }
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  const module = await import(workerModuleUrl);
  await module.refundGeneration(db, { type: "credit", userId: "paid-user" });

  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.match(batches[0][0].sql, /UPDATE wallets/);
  assert.match(batches[0][0].sql, /credits = credits \+ 1/);
  assert.match(batches[0][1].sql, /INSERT INTO credit_ledger/);
  assert.match(batches[0][1].sql, /AI generation refund/);
});

test("login rejects unknown accounts after applying hashed IP and email rate limits", async () => {
  const rateKeys = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...args) {
          return {
            run: async () => ({ success: true }),
            first: async () => {
              if (sql.includes("INSERT INTO auth_rate_limits")) {
                rateKeys.push({ key: args[0], raw: args });
                return { attempts: 1 };
              }
              if (sql.includes("FROM users WHERE email")) return null;
              throw new Error("Unexpected login query: " + sql);
            }
          };
        }
      };
    }
  };
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.20"
    },
    body: JSON.stringify({ action: "login", email: "missing@example.com", password: "wrong-password" })
  }), { DB: db });

  assert.equal(response.status, 401);
  assert.equal(rateKeys.length, 2);
  assert.ok(rateKeys.every(entry => !entry.key.includes("missing@example.com")));
  assert.ok(rateKeys.every(entry => !entry.key.includes("192.0.2.20")));
});

test("login is rate limited when the account attempt threshold is exceeded", async () => {
  const rateKeys = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...args) {
          return {
            run: async () => ({ success: true }),
            first: async () => {
              if (sql.includes("INSERT INTO auth_rate_limits")) {
                rateKeys.push(args[0]);
                return { attempts: String(args[0]).includes(":account:") ? 9 : 1 };
              }
              throw new Error("User lookup must not run after rate limiting");
            }
          };
        }
      };
    }
  };
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.21"
    },
    body: JSON.stringify({ action: "login", email: "limited@example.com", password: "wrong-password" })
  }), { DB: db });

  assert.equal(response.status, 429);
  assert.equal(rateKeys.length, 2);
  const payload = await response.json();
  assert.match(payload.error, /۱۵ دقیقه/);
});

