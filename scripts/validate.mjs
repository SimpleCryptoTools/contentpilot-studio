import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const html = readFileSync("index.html", "utf8");
const worker = readFileSync("worker.js", "utf8");

function checkJavaScript(source, label) {
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: source,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(label + " syntax check failed");
  }
  process.stdout.write("PASS " + label + " syntax\n");
}

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]))
  .map(match => match[2])
  .filter(source => source.trim());

if (inlineScripts.length === 0) throw new Error("No inline application script found");
inlineScripts.forEach((source, index) => checkJavaScript(source, "index.html script " + (index + 1)));
checkJavaScript(worker, "worker.js");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) throw new Error("Duplicate HTML IDs: " + duplicates.join(", "));

for (const required of ["calendarForm", "calendarEntries", "savedDraftsList", "outputLanguage"]) {
  if (!html.includes('id="' + required + '"')) throw new Error("Missing required UI element: " + required);
}
for (const required of ["caption:", "hashtags:", "repurpose:", "seo:"]) {
  if (!worker.includes(required)) throw new Error("Missing worker format: " + required);
}
process.stdout.write("PASS unique HTML IDs and required product features\n");

const cname = readFileSync("CNAME", "utf8").trim();
const robots = readFileSync("robots.txt", "utf8");
const sitemap = readFileSync("sitemap.xml", "utf8");
for (const [label, value] of [
  ["GitHub Pages CNAME", cname],
  ["canonical URL", html.includes('<link rel="canonical" href="https://contentpilot.ir/">') ? "ok" : ""],
  ["Open Graph URL", html.includes('<meta property="og:url" content="https://contentpilot.ir/">') ? "ok" : ""],
  ["API subdomain", html.includes('https://api.contentpilot.ir/') ? "ok" : ""],
  ["robots sitemap", robots.includes("https://contentpilot.ir/sitemap.xml") ? "ok" : ""],
  ["sitemap canonical host", sitemap.includes("<loc>https://contentpilot.ir/</loc>") ? "ok" : ""]
]) {
  if (!value) throw new Error("Missing or incorrect " + label);
}
if (cname !== "contentpilot.ir") throw new Error("CNAME must be contentpilot.ir");
process.stdout.write("PASS custom-domain and API-subdomain configuration\n");

const expectedApiUrl = 'const API_URL = "https://api.contentpilot.ir/";';
if (!html.includes(expectedApiUrl)) throw new Error("Frontend API URL must use the dedicated HTTPS API subdomain");
if (html.includes("contentpilot-ai.mohannahaddadi363.workers.dev")) throw new Error("Frontend still references the temporary workers.dev URL");
if (html.includes("simplecryptotools.github.io/contentpilot-studio")) throw new Error("Frontend still references the old GitHub Pages project URL");
const preflightIndex = worker.indexOf('if (request.method === "OPTIONS")');
const methodGuardIndex = worker.indexOf('if (request.method !== "POST")');
if (preflightIndex < 0 || methodGuardIndex < 0 || preflightIndex > methodGuardIndex) {
  throw new Error("Worker must handle CORS preflight before enforcing POST-only API requests");
}
for (const required of [
  'await authenticate(env.DB, request)',
  'PBKDF2',
  'Access-Control-Allow-Headers',
  'reserveGeneration(env.DB, currentUser.id)',
  'https://contentpilot.ir',
  'https://www.contentpilot.ir',
  '"Vary": "Origin"',
  'if (!originAllowed)',
  'detectImageMime(imageResult.image)',
  'imageData: "data:" + imageMime',
  'Content-Length',
  '16 * 1024',
  'readJsonBody(request, 16 * 1024)',
  'request.body.getReader()',
  'totalBytes > maxBytes',
  '415,'
]) {
  if (!worker.includes(required)) throw new Error("Missing Worker security/usage control: " + required);
}
if (worker.includes('"Access-Control-Allow-Origin": "*"')) {
  throw new Error("Worker CORS must not allow every browser origin");
}
if (!html.includes('showToast(t("paymentInactive"))')) throw new Error("Payment UI must remain inactive until a verified payment flow is implemented");
process.stdout.write("PASS API routing, origin allowlist, request bounds and image MIME validation\n");
