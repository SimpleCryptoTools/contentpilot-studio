/**
 * ContentPilot Studio Worker
 * Bindings required in Cloudflare production:
 *   AI  -> Workers AI
 *   DB  -> D1 database (contentpilot-db)
 *
 * Expected D1 tables (already created by the user):
 *   users, sessions, wallets, orders, credit_ledger, usage_daily
 *
 * The auth_rate_limits table is created automatically on the first
 * register/login request.
 *
 * Security notes:
 * - Text/image generation requires a valid session.
 * - Passwords are PBKDF2-SHA-256 hashed with a unique random salt.
 * - Session tokens are random and only their SHA-256 hashes are stored.
 * - Each account receives 3 combined text/image generations per UTC day.
 * - After the free daily quota, one purchased credit is consumed per generation.
 * - No payment/top-up action is exposed until a verified provider flow is added.
 */

const MODEL_TEXT = "@cf/qwen/qwen3-30b-a3b-fp8";
const MODEL_IMAGE = "@cf/black-forest-labs/flux-1-schnell";
const FREE_DAILY_LIMIT = 3;
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 100000;
const encoder = new TextEncoder();

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: corsHeaders
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJsonBody(request, maxBytes) {
  if (!request.body) throw httpError(400, "بدنه درخواست خالی است.");
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw httpError(413, "حجم درخواست بیش از حد مجاز است.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
  } catch (_) {
    throw httpError(400, "ساختار JSON درخواست معتبر نیست.");
  }
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength || 32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function derivePasswordHash(password, saltHex) {
  const saltBytes = new Uint8Array(
    (saltHex.match(/.{2}/g) || []).map(pair => parseInt(pair, 16))
  );
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function detectImageMime(base64) {
  // Decode only a short prefix to identify the actual image format without
  // allocating a second full-size copy of the generated image.
  let prefix;
  try {
    prefix = atob(base64.slice(0, 32));
  } catch (_) {
    return null;
  }
  const byte = index => prefix.charCodeAt(index);
  const isPng = prefix.length >= 8 &&
    byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4e &&
    byte(3) === 0x47 && byte(4) === 0x0d && byte(5) === 0x0a &&
    byte(6) === 0x1a && byte(7) === 0x0a;
  const isJpeg = prefix.length >= 3 &&
    byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
  const isWebp = prefix.length >= 12 &&
    prefix.slice(0, 4) === "RIFF" && prefix.slice(8, 12) === "WEBP";
  if (isPng) return "image/png";
  if (isJpeg) return "image/jpeg";
  if (isWebp) return "image/webp";
  return null;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function readBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer ([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureAuthRateLimitTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      rate_key TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    )
  `).run();
}

async function bumpRateLimit(db, rateKey, maxAttempts, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const resetBefore = now - windowSeconds;
  const row = await db.prepare(`
    INSERT INTO auth_rate_limits (rate_key, window_started_at, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(rate_key) DO UPDATE SET
      attempts = CASE
        WHEN auth_rate_limits.window_started_at <= ? THEN 1
        ELSE auth_rate_limits.attempts + 1
      END,
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at
        ELSE auth_rate_limits.window_started_at
      END
    RETURNING attempts
  `).bind(rateKey, now, resetBefore, resetBefore).first();

  return Number(row?.attempts || 0) <= maxAttempts;
}

export async function enforceAuthRateLimit(db, request, email, action) {
  await ensureAuthRateLimitTable(db);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown-client";
  const normalizedEmail = String(email || "unknown").trim().toLowerCase();
  const ipKey = await sha256(`cp:${action}:ip:${ip}`);
  const accountKey = await sha256(`cp:${action}:account:${normalizedEmail}`);

  // Per-IP and per-email limits. Raw IP/email are never stored in this table.
  const ipAllowed = await bumpRateLimit(
    db,
    `${action}:ip:${ipKey}`,
    action === "register" ? 10 : 25,
    15 * 60
  );
  const accountAllowed = await bumpRateLimit(
    db,
    `${action}:account:${accountKey}`,
    action === "register" ? 4 : 8,
    15 * 60
  );

  // Occasional cleanup of old hashed counters.
  if (Math.floor(Date.now() / 1000) % 17 === 0) {
    const cutoff = Math.floor(Date.now() / 1000) - 2 * 86400;
    await db.prepare(
      "DELETE FROM auth_rate_limits WHERE window_started_at < ?"
    ).bind(cutoff).run();
  }

  if (!ipAllowed || !accountAllowed) {
    throw httpError(
      429,
      "تعداد تلاش‌ها زیاد است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کن."
    );
  }
}

async function getAccountSnapshot(db, userId, email) {
  const today = utcDateString();
  const [wallet, usage] = await Promise.all([
    db.prepare("SELECT credits FROM wallets WHERE user_id = ?")
      .bind(userId).first(),
    db.prepare(`
      SELECT count FROM usage_daily
      WHERE user_id = ? AND action = 'generation' AND usage_date = ?
    `).bind(userId, today).first()
  ]);

  const used = Number(usage?.count || 0);
  return {
    ok: true,
    user: { id: userId, email },
    credits: Number(wallet?.credits || 0),
    freeRemaining: Math.max(0, FREE_DAILY_LIMIT - used),
    freeDailyLimit: FREE_DAILY_LIMIT
  };
}

async function authenticate(db, request) {
  const token = readBearerToken(request);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT u.id, u.email, u.status
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, now).first();
}

export async function reserveGeneration(db, userId) {
  const today = utcDateString();
  const reservationId = crypto.randomUUID();

  // The quota increment and durable reservation record commit together.
  // changes() prevents a reservation row when the free quota was exhausted.
  const freeResults = await db.batch([
    db.prepare(`
      INSERT INTO usage_daily (user_id, action, usage_date, count)
      VALUES (?, 'generation', ?, 1)
      ON CONFLICT(user_id, action, usage_date)
      DO UPDATE SET count = count + 1
      WHERE usage_daily.count < ?
    `).bind(userId, today, FREE_DAILY_LIMIT),
    db.prepare(`
      INSERT INTO generation_reservations
        (id, user_id, reservation_type, usage_date, status, created_at, updated_at)
      SELECT ?, ?, 'free', ?, 'reserved', unixepoch(), unixepoch()
      WHERE changes() = 1
    `).bind(reservationId, userId, today)
  ]);

  if (Number(freeResults?.[0]?.meta?.changes || 0) === 1) {
    return { id: reservationId, type: "free", userId, date: today };
  }

  const paidReservationId = crypto.randomUUID();
  // Debit, ledger entry and durable reservation are one D1 transaction.
  const paidResults = await db.batch([
    db.prepare(`
      UPDATE wallets
      SET credits = credits - 1, updated_at = unixepoch()
      WHERE user_id = ? AND credits > 0
    `).bind(userId),
    db.prepare(`
      INSERT INTO credit_ledger (user_id, order_id, credit_change, reason)
      SELECT ?, NULL, -1, 'AI generation'
      WHERE changes() = 1
    `).bind(userId),
    db.prepare(`
      INSERT INTO generation_reservations
        (id, user_id, reservation_type, usage_date, status, created_at, updated_at)
      SELECT ?, ?, 'credit', ?, 'reserved', unixepoch(), unixepoch()
      WHERE changes() = 1
    `).bind(paidReservationId, userId, today)
  ]);

  if (Number(paidResults?.[0]?.meta?.changes || 0) !== 1) {
    throw httpError(
      402,
      "سهمیه رایگان امروز تمام شده و اعتبار خریداری‌شده‌ای نداری."
    );
  }

  return { id: paidReservationId, type: "credit", userId, date: today };
}

export async function completeGeneration(db, reservation) {
  if (!reservation?.id) return false;
  const result = await db.prepare(`
    UPDATE generation_reservations
    SET status = 'consumed', updated_at = unixepoch()
    WHERE id = ? AND user_id = ? AND status = 'reserved'
  `).bind(reservation.id, reservation.userId).run();
  return Number(result?.meta?.changes || 0) === 1;
}

export async function refundGeneration(db, reservation) {
  if (!reservation?.id) return false;

  if (reservation.type === "free") {
    const results = await db.batch([
      db.prepare(`
        UPDATE generation_reservations
        SET status = 'refunded', updated_at = unixepoch()
        WHERE id = ? AND user_id = ? AND status = 'reserved'
      `).bind(reservation.id, reservation.userId),
      db.prepare(`
        UPDATE usage_daily
        SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END
        WHERE user_id = ? AND action = 'generation' AND usage_date = ?
          AND changes() = 1
      `).bind(reservation.userId, reservation.date)
    ]);
    return Number(results?.[0]?.meta?.changes || 0) === 1;
  }

  if (reservation.type === "credit") {
    const results = await db.batch([
      db.prepare(`
        UPDATE generation_reservations
        SET status = 'refunded', updated_at = unixepoch()
        WHERE id = ? AND user_id = ? AND status = 'reserved'
      `).bind(reservation.id, reservation.userId),
      db.prepare(`
        UPDATE wallets
        SET credits = credits + 1, updated_at = unixepoch()
        WHERE user_id = ? AND changes() = 1
      `).bind(reservation.userId),
      db.prepare(`
        INSERT INTO credit_ledger (user_id, order_id, credit_change, reason)
        SELECT ?, NULL, 1, 'AI generation refund'
        WHERE changes() = 1
      `).bind(reservation.userId)
    ]);
    return Number(results?.[0]?.meta?.changes || 0) === 1;
  }

  return false;
}

async function getUsageSnapshot(db, userId) {
  const snapshot = await getAccountSnapshot(
    db,
    userId,
    (await db.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first())?.email || ""
  );
  return {
    credits: snapshot.credits,
    freeRemaining: snapshot.freeRemaining,
    freeDailyLimit: snapshot.freeDailyLimit
  };
}

export default {
  async fetch(request, env) {
    // Browser access is limited to the production frontend origins.
    // Requests without an Origin header (for example, trusted server-side
    // tools) are not treated as browser cross-origin requests. CORS is not
    // authentication: protected endpoints still validate bearer sessions.
    const allowedOrigins = new Set([
      "https://contentpilot.ir",
      "https://www.contentpilot.ir"
    ]);
    const requestOrigin = request.headers.get("Origin");
    const originAllowed = !requestOrigin || allowedOrigins.has(requestOrigin);
    const corsHeaders = {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    };
    if (requestOrigin && originAllowed) {
      corsHeaders["Access-Control-Allow-Origin"] = requestOrigin;
    }

    // Reject browser origins outside the explicit production allowlist.
    // This is a browser boundary only; bearer authentication remains required.
    if (!originAllowed) {
      return jsonResponse(
        { error: "مبدأ درخواست مجاز نیست." },
        403,
        corsHeaders
      );
    }

    // Always answer preflight before parsing a body or checking authentication.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "لطفاً درخواست POST بفرستید." },
        405,
        corsHeaders
      );
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return jsonResponse(
        { error: "نوع محتوای درخواست باید JSON باشد." },
        415,
        corsHeaders
      );
    }
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 16 * 1024) {
      return jsonResponse(
        { error: "حجم درخواست بیش از حد مجاز است." },
        413,
        corsHeaders
      );
    }

    let reservation = null;
    let userForRefund = null;

    try {
      const body = await readJsonBody(request, 16 * 1024);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw httpError(400, "اطلاعات ارسالی معتبر نیست.");
      }

      if (!env.DB) {
        throw httpError(500, "اتصال دیتابیس تنظیم نشده است.");
      }

      const action = String(body.action || "text").trim();

      // REGISTER
      if (action === "register") {
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw httpError(400, "یک ایمیل معتبر وارد کن.");
        }
        if (password.length < 10 || password.length > 128) {
          throw httpError(400, "رمز عبور باید بین ۱۰ تا ۱۲۸ نویسه باشد.");
        }

        await enforceAuthRateLimit(env.DB, request, email, "register");

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1"
        ).bind(email).first();
        if (existing) {
          throw httpError(409, "این ایمیل قبلاً ثبت شده است. وارد حساب شو.");
        }

        const userId = crypto.randomUUID();
        const salt = randomHex(16);
        const hash = await derivePasswordHash(password, salt);
        const accessToken = randomHex(32);
        const tokenHash = await sha256(accessToken);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + SESSION_DAYS * 86400;

        try {
          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO users (id, email, password_hash, password_salt, status)
              VALUES (?, ?, ?, ?, 'active')
            `).bind(userId, email, hash, salt),
            env.DB.prepare(`
              INSERT INTO wallets (user_id, credits) VALUES (?, 0)
            `).bind(userId),
            env.DB.prepare(`
              INSERT INTO sessions (token_hash, user_id, expires_at)
              VALUES (?, ?, ?)
            `).bind(tokenHash, userId, expiresAt)
          ]);
        } catch (error) {
          if (String(error?.message || "").toLowerCase().includes("unique")) {
            throw httpError(409, "این ایمیل قبلاً ثبت شده است. وارد حساب شو.");
          }
          throw error;
        }

        const snapshot = await getAccountSnapshot(env.DB, userId, email);
        snapshot.accessToken = accessToken;
        return jsonResponse(snapshot, 201, corsHeaders);
      }

      // LOGIN
      if (action === "login") {
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (email.length > 254 || password.length > 128 || !email) {
          throw httpError(400, "ایمیل یا رمز عبور معتبر نیست.");
        }

        await enforceAuthRateLimit(env.DB, request, email, "login");

        const user = await env.DB.prepare(`
          SELECT id, email, password_hash, password_salt, status
          FROM users WHERE email = ? COLLATE NOCASE LIMIT 1
        `).bind(email).first();

        if (!user || user.status !== "active") {
          throw httpError(401, "ایمیل یا رمز عبور اشتباه است.");
        }

        const candidateHash = await derivePasswordHash(password, user.password_salt);
        if (!constantTimeEqual(candidateHash, user.password_hash)) {
          throw httpError(401, "ایمیل یا رمز عبور اشتباه است.");
        }

        const accessToken = randomHex(32);
        const tokenHash = await sha256(accessToken);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + SESSION_DAYS * 86400;

        await env.DB.batch([
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?")
            .bind(user.id, now),
          env.DB.prepare(`
            INSERT INTO sessions (token_hash, user_id, expires_at)
            VALUES (?, ?, ?)
          `).bind(tokenHash, user.id, expiresAt)
        ]);

        const snapshot = await getAccountSnapshot(env.DB, user.id, user.email);
        snapshot.accessToken = accessToken;
        return jsonResponse(snapshot, 200, corsHeaders);
      }

      // LOGOUT
      if (action === "logout") {
        const token = readBearerToken(request);
        if (token) {
          await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
            .bind(await sha256(token)).run();
        }
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // ALL OTHER ACTIONS REQUIRE A VALID SESSION.
      const currentUser = await authenticate(env.DB, request);
      if (!currentUser || currentUser.status !== "active") {
        throw httpError(401, "برای استفاده از ابزار ابتدا وارد حساب خود شو.");
      }
      userForRefund = currentUser.id;

      // ACCOUNT SNAPSHOT
      if (action === "me") {
        return jsonResponse(
          await getAccountSnapshot(env.DB, currentUser.id, currentUser.email),
          200,
          corsHeaders
        );
      }

      // IMAGE GENERATION
      if (action === "image") {
        const prompt = String(body.prompt || body.topic || "").trim();
        const imageType = String(body.imageType || "post").trim();

        if (!prompt) throw httpError(400, "توضیح تصویر را وارد کن.");
        if (prompt.length > 1400) {
          throw httpError(400, "توضیح تصویر بیش از حد طولانی است.");
        }
        if (!env.AI) {
          throw httpError(500, "اتصال هوش مصنوعی تنظیم نشده است.");
        }

        reservation = await reserveGeneration(env.DB, currentUser.id);

        const styles = {
          post: "Square social media advertising image, balanced composition.",
          story: "Portrait social media story composition with safe margins.",
          product: "Premium commercial product photography with studio lighting.",
          cover: "Cinematic video cover composition with professional lighting."
        };

        const imagePrompt = `
Create a high-quality professional marketing image.
Purpose: ${styles[imageType] || styles.post}
Main subject: ${prompt}
Use beautiful lighting, refined composition, realistic details and harmonious colors.
Do not include text, logos, watermarks or signatures.
Create only the visual image.
`;

        const imageResult = await env.AI.run(MODEL_IMAGE, {
          prompt: imagePrompt,
          steps: 4
        });

        if (!imageResult || typeof imageResult.image !== "string" || !imageResult.image) {
          throw new Error("Image model returned no image.");
        }
        const imageMime = detectImageMime(imageResult.image);
        if (!imageMime) {
          throw new Error("Image model returned an unsupported or invalid image format.");
        }

        const usage = await getUsageSnapshot(env.DB, currentUser.id);
        if (!await completeGeneration(env.DB, reservation)) {
          throw new Error("Could not finalize the generation reservation.");
        }
        reservation = null;
        return jsonResponse({
          imageData: "data:" + imageMime + ";base64," + imageResult.image,
          imageType,
          usage
        }, 200, corsHeaders);
      }

      // TEXT GENERATION (default action and action=text)
      if (action !== "text") {
        throw httpError(400, "عملیات درخواستی شناخته نشد.");
      }

      const topic = String(body.topic || "").trim();
      const kind = String(body.kind || "social").trim();
      const outputLanguage = String(body.outputLanguage || body.language || "en").toLowerCase();
      const supportedLanguages = {
        en: "English", fa: "Persian", es: "Spanish", fr: "French",
        de: "German", pt: "Portuguese", ar: "Arabic", hi: "Hindi",
        ja: "Japanese", it: "Italian", tr: "Turkish"
      };
      if (!supportedLanguages[outputLanguage]) {
        throw httpError(400, "زبان خروجی پشتیبانی نمی‌شود.");
      }
      const language = outputLanguage;

      if (!topic) throw httpError(400, "لطفاً موضوع محتوا را وارد کن.");
      if (topic.length > 500) {
        throw httpError(400, "موضوع باید کمتر از ۵۰۰ نویسه باشد.");
      }
      if (!env.AI) {
        throw httpError(500, "اتصال هوش مصنوعی تنظیم نشده است.");
      }

      reservation = await reserveGeneration(env.DB, currentUser.id);

      const formats = {
        social: "a polished social media post",
        video: "a short-form video script with hook, scenes, voice-over and call to action",
        product: "a persuasive, factual product description with benefits and call to action",
        ideas: "exactly five distinct, actionable content ideas",
        caption: "an engaging caption with a strong opening and natural call to action",
        hashtags: "relevant niche, audience and broad hashtags; never claim live trend data",
        story: "five social story frames with concise on-screen copy and interaction ideas",
        ad: "three advertising copy variations with different hooks and calls to action",
        email: "a marketing email with subject, preview text, body and one call to action",
        blog: "a structured blog article with title, introduction, headings and conclusion",
        seo: "an SEO title, meta description, URL slug and search-intent outline",
        reply: "an empathetic customer-support reply; do not invent policies, refunds or order facts",
        repurpose: "a content repurposing kit for Instagram, TikTok, LinkedIn and an email newsletter"
      };
      const contentType = formats[kind] || formats.social;
      const languageName = supportedLanguages[language];
      const systemPrompt = `You are an expert multilingual content strategist and copywriter. Write naturally and idiomatically in ${languageName}. Respect cultural context and local conventions. Return only the final deliverable. Never reveal reasoning or planning. Do not invent facts, statistics, prices, testimonials, product claims, legal promises or policies. Do not make unsupported medical or financial claims. If essential facts are missing, use clearly marked placeholders instead of guessing. Make the result useful, specific and ready for human review before publishing.`;
      const userPrompt = `/no_think\n\nTopic / source material: ${topic}\nDeliverable: ${contentType}\nOutput language: ${languageName}\n\nUse clear structure, concise language and platform-appropriate formatting. Never pretend to have checked live trends, search volume or analytics. Return only the finished content in ${languageName}.`;

      const result = await env.AI.run(MODEL_TEXT, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1400,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        repetition_penalty: 1.08
      });

      let generatedText = "";
      if (typeof result?.response === "string") {
        generatedText = result.response;
      } else if (typeof result?.choices?.[0]?.message?.content === "string") {
        generatedText = result.choices[0].message.content;
      }
      generatedText = generatedText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (!generatedText) throw new Error("AI returned an empty response.");

      const usage = await getUsageSnapshot(env.DB, currentUser.id);
      if (!await completeGeneration(env.DB, reservation)) {
        throw new Error("Could not finalize the generation reservation.");
      }
      reservation = null;
      return jsonResponse({ text: generatedText, usage }, 200, corsHeaders);

    } catch (error) {
      console.error("ContentPilot Worker error:", error);

      if (reservation && userForRefund) {
        try {
          await refundGeneration(env.DB, reservation);
        } catch (refundError) {
          console.error("Generation refund error:", refundError);
        }
      }

      const status = Number(error?.status) || 500;
      const message = status === 401 || status === 402 || status === 409 || status === 429
        ? error.message
        : status === 400
          ? error.message
          : "تولید محتوا انجام نشد. اتصال هوش مصنوعی یا دیتابیس را بررسی کن.";

      return jsonResponse({ error: message }, status, corsHeaders);
    }
  }
};