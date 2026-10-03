import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const source = process.env.VISUAL_SOURCE;
const pagesRoot = process.env.PAGES_ROOT;
const target = process.env.VISUAL_TARGET;
const label = process.env.VISUAL_LABEL;
const sha = process.env.SOURCE_SHA;
const runUrl = process.env.RUN_URL;
const repoUrl = process.env.REPOSITORY_URL;
const previewUrl = process.env.PREVIEW_URL;

if (!source || !pagesRoot || !target || !label || !sha || !runUrl || !repoUrl || !previewUrl) {
  throw new Error("Missing visual Pages environment");
}
if (!/^(main|pr\/\d+)$/.test(target)) throw new Error(`Invalid visual target: ${target}`);

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const titleFromFile = (name) =>
  name
    .replace(/\.png$/i, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const targetRoot = join(pagesRoot, target);
await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

const sourceFiles = await readdir(source);
const screenshots = sourceFiles.filter((name) => name.endsWith(".png")).sort();
for (const name of [...screenshots, "report.json"]) {
  if (sourceFiles.includes(name)) await cp(join(source, name), join(targetRoot, name));
}

const generatedAt = new Date().toISOString();
const prMatch = /^pr\/(\d+)$/.exec(target);
const prNumber = prMatch ? Number(prMatch[1]) : null;
const commitUrl = `${repoUrl}/commit/${sha}`;
const pullUrl = prNumber ? `${repoUrl}/pull/${prNumber}` : null;

const pageLinks = [
  '<a href="../../">All previews</a>',
  pullUrl ? `<a href="${escapeHtml(pullUrl)}">PR #${prNumber}</a>` : null,
  `<a href="${escapeHtml(commitUrl)}">Commit ${escapeHtml(sha.slice(0, 8))}</a>`,
  `<a href="${escapeHtml(runUrl)}">CI run</a>`,
  sourceFiles.includes("report.json") ? '<a href="./report.json">report.json</a>' : null,
]
  .filter(Boolean)
  .join(" · ");

const cards = screenshots
  .map(
    (name) => `
      <article class="shot">
        <header><strong>${escapeHtml(titleFromFile(name))}</strong></header>
        <a href="./${encodeURIComponent(name)}">
          <img src="./${encodeURIComponent(name)}" alt="${escapeHtml(titleFromFile(name))} screenshot">
        </a>
      </article>`,
  )
  .join("\n");

await writeFile(
  join(targetRoot, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(label)} · Player History visual tests</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0d1117; color: #e6edf3; }
    main { width: min(1500px, calc(100% - 32px)); margin: 32px auto 64px; }
    h1 { margin-bottom: 6px; }
    .meta { color: #8b949e; margin-bottom: 28px; }
    .meta a { color: #58a6ff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(560px, 100%), 1fr)); gap: 22px; }
    .shot { overflow: hidden; border: 1px solid #30363d; border-radius: 10px; background: #161b22; }
    .shot header { padding: 10px 14px; border-bottom: 1px solid #30363d; }
    .shot a { display: block; }
    .shot img { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(label)}</h1>
    <div class="meta">${pageLinks}<br>Published ${escapeHtml(generatedAt)}</div>
    <div class="grid">${cards || "<p>No screenshots were generated.</p>"}</div>
  </main>
</body>
</html>`,
);

const manifestPath = join(pagesRoot, "previews.json");
let manifest = { previews: [] };
try {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  if (Array.isArray(parsed?.previews)) manifest = parsed;
} catch {}

const entry = {
  target,
  label,
  sha,
  runUrl,
  previewUrl,
  generatedAt,
  ...(prNumber ? { prNumber } : {}),
};
manifest.previews = manifest.previews.filter((candidate) => candidate?.target !== target);
manifest.previews.push(entry);

const mainEntry = manifest.previews.find((candidate) => candidate.target === "main");
const prEntries = manifest.previews
  .filter((candidate) => candidate.target !== "main")
  .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)))
  .slice(0, 40);
manifest.previews = [...(mainEntry ? [mainEntry] : []), ...prEntries];

const keptTargets = new Set(manifest.previews.map((candidate) => candidate.target));
const prRoot = join(pagesRoot, "pr");
try {
  for (const name of await readdir(prRoot)) {
    if (!keptTargets.has(`pr/${name}`)) await rm(join(prRoot, name), { recursive: true, force: true });
  }
} catch {}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const previewCards = manifest.previews
  .map((item) => {
    const kind = item.target === "main" ? "Baseline" : `PR #${item.prNumber}`;
    return `
      <article class="preview">
        <div>
          <span class="kind">${escapeHtml(kind)}</span>
          <h2><a href="./${escapeHtml(item.target)}/">${escapeHtml(item.label)}</a></h2>
          <p><code>${escapeHtml(item.sha.slice(0, 8))}</code> · ${escapeHtml(item.generatedAt)}</p>
        </div>
        <a class="open" href="./${escapeHtml(item.target)}/">Open screenshots →</a>
      </article>`;
  })
  .join("\n");

await writeFile(
  join(pagesRoot, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Player History visual tests</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0d1117; color: #e6edf3; }
    main { width: min(980px, calc(100% - 32px)); margin: 40px auto 72px; }
    h1 { margin-bottom: 6px; }
    .intro { color: #8b949e; margin: 0 0 30px; }
    .preview { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px 20px; margin: 12px 0; border: 1px solid #30363d; border-radius: 10px; background: #161b22; }
    .preview h2 { margin: 5px 0; font-size: 18px; }
    .preview h2 a, .open { color: #58a6ff; text-decoration: none; }
    .preview p { margin: 0; color: #8b949e; font-size: 13px; }
    .kind { color: #8b949e; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .open { white-space: nowrap; }
    code { color: #c9d1d9; }
    @media (max-width: 640px) { .preview { align-items: flex-start; flex-direction: column; gap: 10px; } }
  </style>
</head>
<body>
  <main>
    <h1>Player History visual tests</h1>
    <p class="intro">Deterministic browser screenshots published by CI for main and recent pull requests.</p>
    ${previewCards || "<p>No visual previews have been published yet.</p>"}
  </main>
</body>
</html>`,
);

await writeFile(join(pagesRoot, ".nojekyll"), "");
await writeFile(join(pagesRoot, ".player-history-visual-pages"), "managed by CI\n");
console.log(`Published ${screenshots.length} screenshots to ${target}`);
