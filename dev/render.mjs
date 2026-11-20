// Rend les 4 gabarits avec dev/data.json et le CSS officiel TRMNL, dans dev/preview/.
// Usage : node dev/render.mjs [data.json]
import { Liquid } from "liquidjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(process.argv[2] || join(root, "dev/data.json"), "utf8"));
const engine = new Liquid();
const shared = readFileSync(join(root, "plugin/shared.liquid"), "utf8");
const layouts = ["full", "half_horizontal", "half_vertical", "quadrant"];
mkdirSync(join(root, "dev/preview"), { recursive: true });

const dev = { og: [800, 480], x: [1872, 1404], portrait: [480, 800], "x-portrait": [1404, 1872] }[process.argv[3] || "og"];
data.trmnl = { ...(data.trmnl || {}), device: { width: dev[0], height: dev[1] } };
const views = {};
for (const l of layouts) {
  const tpl = shared + readFileSync(join(root, `plugin/${l}.liquid`), "utf8");
  views[l] = await engine.parseAndRender(tpl, data);
}

const head = `<meta charset="utf-8"><link rel="stylesheet" href="https://trmnl.com/css/latest/plugins.css"><script src="https://trmnl.com/js/latest/plugins.js"></script>
<style>body{margin:0;padding:20px;background:#ddd;font-family:sans-serif} .frame{margin:0 0 28px} h2{font:600 14px sans-serif;margin:0 0 6px}</style>`;
// Variante d'écran : og (800x480), x (TRMNL X 1040x780), portrait (OG tourné)
const device = process.argv[3] || "og";
const screenClass = { og: "screen", x: "screen screen--v2 screen--lg screen--density-2x", portrait: "screen screen--portrait", "x-portrait": "screen screen--v2 screen--lg screen--portrait" }[device];
const screen = (inner) => `<div class="environment trmnl"><div class="${screenClass}" style="transform:none">${inner}</div></div>`;
const page = `<!doctype html><html><head>${head}<title>Aperçu Ilévia TRMNL</title></head><body>
<div class="frame"><h2>full</h2>${screen(`<div class="view view--full">${views.full}</div>`)}</div>
<div class="frame"><h2>half_horizontal ×2</h2>${screen(`<div class="mashup mashup--1Tx1B"><div class="view view--half_horizontal">${views.half_horizontal}</div><div class="view view--half_horizontal">${views.half_horizontal}</div></div>`)}</div>
<div class="frame"><h2>half_vertical ×2</h2>${screen(`<div class="mashup mashup--1Lx1R"><div class="view view--half_vertical">${views.half_vertical}</div><div class="view view--half_vertical">${views.half_vertical}</div></div>`)}</div>
<div class="frame"><h2>quadrant ×4</h2>${screen(`<div class="mashup mashup--2x2">${Array(4).fill(`<div class="view view--quadrant">${views.quadrant}</div>`).join("")}</div>`)}</div>
</body></html>`;
const out = device === "og" ? "index.html" : `${device}.html`;
writeFileSync(join(root, "dev/preview", out), page);
console.log(`dev/preview/${out}`);
