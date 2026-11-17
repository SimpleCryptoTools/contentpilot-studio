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
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
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
    prepare(sql) { return { sql, bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      calls.push(statements);
      if (calls.length === 1) return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
      return [
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } }
      ];
    }
  };

  const reservation = await (await import(workerModuleUrl)).reserveGeneration(db, "user-1");
  assert.equal(reservation.type, "credit");
  assert.equal(reservation.userId, "user-1");
  assert.equal(typeof reservation.id, "string");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].length, 3);
  assert.ok(calls[1][0].sql.includes("UPDATE wallets"));
  assert.ok(calls[1][0].sql.includes("credits = credits - 1"));
  assert.ok(calls[1][1].sql.includes("INSERT INTO credit_ledger"));
  assert.ok(calls[1][1].sql.includes("WHERE changes() = 1"));
  assert.ok(calls[1][2].sql.includes("INSERT INTO generation_reservations"));
});
test("does not create a credit reservation when the wallet debit changes no row", async () => {
  let batchCalls = 0;
  const db = {
    prepare(sql) { return { sql, bind(...args) { return { sql, args }; } }; },
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
  assert.equal(batchCalls, 2);
});
test("registration works without a Workers AI binding", async () => {
  const batchStatements = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        async run() { return { success: true, meta: { changes: 1 } }; },
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

test("reserves free quota and durable reservation in one D1 batch", async () => {
  const batches = [];
  const db = {
    prepare(sql) {
      return { sql, bind(...args) { return { sql, args }; } };
    },
    async batch(statements) {
      batches.push(statements);
      return [{ success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 1 } }];
    }
  };

  const module = await import(workerModuleUrl);
  const reservation = await module.reserveGeneration(db, "free-user");
  assert.equal(reservation.type, "free");
  assert.equal(reservation.userId, "free-user");
  assert.match(reservation.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof reservation.id, "string");
  assert.equal(reservation.id.length, 36);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.match(batches[0][0].sql, /INSERT INTO usage_daily/);
  assert.ok(batches[0][0].sql.includes("usage_daily.count < ?"));
  assert.match(batches[0][1].sql, /INSERT INTO generation_reservations/);
  assert.ok(batches[0][1].sql.includes("WHERE changes() = 1"));
});
test("free generation refund is guarded by durable reservation state", async () => {
  const batches = [];
  const db = {
    prepare(sql) { return { sql, bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      batches.push(statements);
      return [{ success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 1 } }];
    }
  };
  const module = await import(workerModuleUrl);
  const reservation = { id: "reservation-free", type: "free", userId: "free-user", date: "2026-11-16" };
  const refunded = await module.refundGeneration(db, reservation);

  assert.equal(refunded, true);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.match(batches[0][0].sql, /UPDATE usage_daily/);
  assert.ok(batches[0][0].sql.includes("EXISTS ("));
  assert.match(batches[0][1].sql, /UPDATE generation_reservations/);
  assert.match(batches[0][1].sql, /status = 'refunded'/);
  assert.match(batches[0][1].sql, /status = 'reserved'/);
  assert.ok(batches[0][1].sql.includes("changes() = 1"));
});
test("paid generation refund is guarded and credits wallet plus ledger transactionally", async () => {
  const batches = [];
  const db = {
    prepare(sql) { return { sql, bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  const module = await import(workerModuleUrl);
  const reservation = { id: "reservation-paid", type: "credit", userId: "paid-user", date: "2026-11-16" };
  const refunded = await module.refundGeneration(db, reservation);

  assert.equal(refunded, true);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  assert.match(batches[0][0].sql, /UPDATE wallets/);
  assert.ok(batches[0][0].sql.includes("credits = credits + 1"));
  assert.ok(batches[0][0].sql.includes("EXISTS ("));
  assert.match(batches[0][1].sql, /UPDATE generation_reservations/);
  assert.match(batches[0][1].sql, /status = 'refunded'/);
  assert.ok(batches[0][1].sql.includes("changes() = 1"));
  assert.match(batches[0][2].sql, /INSERT INTO credit_ledger/);
  assert.ok(batches[0][2].sql.includes("WHERE changes() = 1"));
});
test("generation completion only transitions an active reservation once", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind(...args) { return { run: async () => { calls.push({sql,args}); return { meta: { changes: 1 } }; } }; } };
    }
  };
  const module = await import(workerModuleUrl);
  const done = await module.completeGeneration(db, { id: "reservation-1", userId: "user-1" });
  assert.equal(done, true);
  assert.match(calls[0].sql, /status = 'consumed'/);
  assert.match(calls[0].sql, /status = 'reserved'/);
});

test("duplicate generation refund does not apply when reservation is no longer active", async () => {
  const db = {
    prepare(sql) { return { sql, bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      assert.equal(statements.length, 3);
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } }
      ];
    }
  };
  const module = await import(workerModuleUrl);
  const refunded = await module.refundGeneration(db, {
    id: "already-refunded", type: "credit", userId: "user-1", date: "2026-11-16"
  });
  assert.equal(refunded, false);
});

test("login rejects unknown accounts after applying hashed IP and email rate limits", async () => {
  const rateKeys = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        run: async () => ({ success: true }),
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
        run: async () => ({ success: true }),
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



async function testPasswordHash(password, saltHex) {
  const salt = new Uint8Array((saltHex.match(/.{2}/g) || []).map(pair => parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

test("successful login creates a hashed-token session and returns the account snapshot", async () => {
  const salt = "00112233445566778899aabbccddeeff";
  const password = "correct-horse-battery";
  const passwordHash = await testPasswordHash(password, salt);
  const batches = [];
  const sqlCalls = [];
  const db = {
    prepare(sql) {
      sqlCalls.push(sql);
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() {
          if (sql.includes("INSERT INTO auth_rate_limits")) return { attempts: 1 };
          if (sql.includes("FROM users WHERE email")) {
            return { id: "user-login", email: "login@example.com", password_hash: passwordHash, password_salt: salt, status: "active" };
          }
          if (sql.includes("SELECT credits FROM wallets")) return { credits: 7 };
          if (sql.includes("SELECT count FROM usage_daily")) return { count: 1 };
          throw new Error("Unexpected successful-login query: " + sql);
        }
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.30"
    },
    body: JSON.stringify({ action: "login", email: "LOGIN@example.com", password })
  }), { DB: db });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.user, { id: "user-login", email: "login@example.com" });
  assert.equal(payload.credits, 7);
  assert.equal(payload.freeRemaining, 2);
  assert.equal(typeof payload.accessToken, "string");
  assert.equal(payload.accessToken.length, 64);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.match(batches[0][0].sql, /DELETE FROM sessions/);
  assert.match(batches[0][1].sql, /INSERT INTO sessions/);
  assert.ok(!sqlCalls.some(sql => /SELECT token_hash FROM sessions/.test(sql)));
});

test("logout revokes the supplied bearer session by deleting its token hash", async () => {
  const deleted = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => { deleted.push({ sql, args }); return { success: true, meta: { changes: 1 } }; }
          };
        }
      };
    }
  };
  const token = "a".repeat(64);
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ action: "logout" })
  }), { DB: db });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(deleted.length, 1);
  assert.match(deleted[0].sql, /DELETE FROM sessions WHERE token_hash = \?/);
  assert.equal(deleted[0].args[0].length, 64);
  assert.notEqual(deleted[0].args[0], token);
});

test("authenticated me returns account, wallet and remaining free quota", async () => {
  const token = "b".repeat(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...args) {
          return {
            first: async () => {
              if (sql.includes("FROM sessions s")) {
                assert.equal(args[0], tokenHash);
                return { id: "user-me", email: "me@example.com", status: "active" };
              }
              if (sql.includes("SELECT credits FROM wallets")) return { credits: 4 };
              if (sql.includes("SELECT count FROM usage_daily")) return { count: 2 };
              if (sql.includes("SELECT email FROM users")) return { email: "me@example.com" };
              throw new Error("Unexpected me query: " + sql);
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
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ action: "me" })
  }), { DB: db });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.id, "user-me");
  assert.equal(payload.user.email, "me@example.com");
  assert.equal(payload.credits, 4);
  assert.equal(payload.freeRemaining, 1);
  assert.equal(payload.freeDailyLimit, 3);
  assert.ok(queries.some(sql => sql.includes("FROM sessions s")));
});

test("login rejects a wrong password without creating a session", async () => {
  const salt = "ffeeddccbbaa99887766554433221100";
  const passwordHash = await testPasswordHash("the-correct-password", salt);
  let batchCalls = 0;
  const db = {
    prepare(sql) {
      return {
        run: async () => ({ success: true }),
        bind() {
          return {
            run: async () => ({ success: true }),
            first: async () => {
              if (sql.includes("INSERT INTO auth_rate_limits")) return { attempts: 1 };
              if (sql.includes("FROM users WHERE email")) {
                return { id: "user-wrong-pass", email: "wrong@example.com", password_hash: passwordHash, password_salt: salt, status: "active" };
              }
              throw new Error("Unexpected wrong-password query: " + sql);
            }
          };
        }
      };
    },
    async batch() { batchCalls++; return []; }
  };
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.31"
    },
    body: JSON.stringify({ action: "login", email: "wrong@example.com", password: "incorrect-password" })
  }), { DB: db });

  assert.equal(response.status, 401);
  assert.equal(batchCalls, 0);
});


test("falls back to a paid credit with a durable reservation when free quota is exhausted", async () => {
  const batches = [];
  const db = {
    prepare(sql) {
      return { sql, bind(...args) { return { sql, args }; } };
    },
    async batch(statements) {
      batches.push(statements);
      if (batches.length === 1) return [{ success: true, meta: { changes: 0 } }, { success: true, meta: { changes: 0 } }];
      return [
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } }
      ];
    }
  };
  const module = await import(workerModuleUrl);
  const reservation = await module.reserveGeneration(db, "quota-user");

  assert.equal(reservation.type, "credit");
  assert.equal(reservation.userId, "quota-user");
  assert.equal(typeof reservation.id, "string");
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 2);
  assert.equal(batches[1].length, 3);
  assert.match(batches[1][0].sql, /UPDATE wallets/);
  assert.match(batches[1][1].sql, /INSERT INTO credit_ledger/);
  assert.match(batches[1][2].sql, /INSERT INTO generation_reservations/);
});
test("registration rejects an existing email without creating a second account", async () => {
  let registrationBatches = 0;
  const db = {
    prepare(sql) {
      return {
        sql,
        run: async () => ({ success: true }),
        bind(...args) {
          return {
            first: async () => {
              if (sql.includes("INSERT INTO auth_rate_limits")) return { attempts: 1 };
              if (sql.includes("SELECT id FROM users")) return { id: "existing-user" };
              throw new Error("Unexpected duplicate-registration query: " + sql);
            },
            run: async () => ({ success: true, meta: { changes: 0 } })
          };
        }
      };
    },
    async batch() { registrationBatches++; return []; }
  };
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.40"
    },
    body: JSON.stringify({ action: "register", email: "taken@example.com", password: "valid-password-123" })
  }), { DB: db });

  assert.equal(response.status, 409);
  assert.equal(registrationBatches, 0);
});

test("registration rejects a short password before touching D1", async () => {
  let databaseCalls = 0;
  const db = {
    prepare() {
      databaseCalls++;
      throw new Error("D1 must not be queried for invalid registration input");
    }
  };
  const response = await worker.fetch(new Request("https://api.contentpilot.ir/", {
    method: "POST",
    headers: {
      Origin: "https://contentpilot.ir",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action: "register", email: "short-pass@example.com", password: "tiny" })
  }), { DB: db });

  assert.equal(response.status, 400);
  assert.equal(databaseCalls, 0);
});

test("free generation duplicate refund does not decrement quota twice", async () => {
  let batchCount = 0;
  const db = {
    prepare(sql) { return { sql, bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      batchCount++;
      assert.equal(statements.length, 2);
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    }
  };
  const module = await import(workerModuleUrl);
  const refunded = await module.refundGeneration(db, {
    id: "already-refunded-free",
    type: "free",
    userId: "user-1",
    date: "2026-11-16"
  });
  assert.equal(refunded, false);
  assert.equal(batchCount, 1);
});

test("generation completion returns false when reservation is already finalized", async () => {
  let executedSql = "";
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            run: async () => {
              executedSql = sql;
              return { meta: { changes: 0 } };
            }
          };
        }
      };
    }
  };
  const module = await import(workerModuleUrl);
  const completed = await module.completeGeneration(db, {
    id: "already-finalized",
    userId: "user-1"
  });
  assert.equal(completed, false);
  assert.match(executedSql, /status = 'reserved'/);
});

test("invalid generation reservation types cannot trigger a refund", async () => {
  let databaseTouched = false;
  const db = {
    prepare() {
      databaseTouched = true;
      throw new Error("Database must not be touched for invalid reservation types");
    },
    async batch() {
      databaseTouched = true;
      throw new Error("Database must not be touched for invalid reservation types");
    }
  };
  const module = await import(workerModuleUrl);
  const refunded = await module.refundGeneration(db, {
    id: "unknown-type",
    type: "unknown",
    userId: "user-1",
    date: "2026-11-16"
  });
  assert.equal(refunded, false);
  assert.equal(databaseTouched, false);
});


test("auth rate-limit cleanup runs on the scheduled event, not during authentication requests", async () => {
  const calls = [];
  let waited = null;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => {
              calls.push({ sql, args });
              return { success: true, meta: { changes: 2 } };
            }
          };
        }
      };
    }
  };
  worker.scheduled({}, { DB: db }, {
    waitUntil(promise) { waited = promise; }
  });
  assert.ok(waited instanceof Promise);
  await waited;
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /DELETE FROM auth_rate_limits WHERE window_started_at < \?/);
  assert.equal(calls[0].args.length, 1);
  assert.ok(Number.isInteger(calls[0].args[0]));
});

test("scheduled auth cleanup safely skips when D1 is unavailable", async () => {
  let waitUntilCalled = false;
  await worker.scheduled({}, {}, {
    waitUntil() { waitUntilCalled = true; }
  });
  assert.equal(waitUntilCalled, false);
});
