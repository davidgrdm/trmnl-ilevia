// Exécute plugin/transform.js en local, comme le ferait TRMNL.
// Les horaires métro sont lus dans docs/metro/ (au lieu de GitHub Pages) ;
// bus/tram et perturbations sont interrogés en vrai sur l'open data MEL.
//
// Usage : node dev/run-transform.mjs [fichier-réglages.json] > dev/data.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "plugin/transform.js"), "utf8");
const settingsFile = process.argv[2] || join(root, "dev/settings.example.json");
const settings = JSON.parse(readFileSync(settingsFile, "utf8"));

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const m = /\/metro\/([^/?]+\.json)$/.exec(String(url));
  if (m && String(url).includes("REPLACE_ME")) {
    try {
      const body = readFileSync(join(root, "docs/metro", decodeURIComponent(m[1])), "utf8");
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }
  return realFetch(url, opts);
};

const run = new Function(`${src}\nreturn run;`)();
const input = { trmnl: { plugin_settings: { custom_fields_values: settings }, user: { time_zone_iana: "Europe/Paris" } } };
const t0 = Date.now();
const out = await run(input);
console.error(`transform: ${Date.now() - t0} ms`);
console.log(JSON.stringify(out, null, 2));
