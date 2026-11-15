import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const html = readFileSync("index.html", "utf8");
const worker = readFileSync("worker.js", "utf8");

function checkJavaScript(source, label) {
  const result = spawnSync(process.execPath, ["--check"], {
    input: source,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(label + " syntax check failed");
  }
  process.stdout.write("PASS " + label + " syntax\n");
}

const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
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
