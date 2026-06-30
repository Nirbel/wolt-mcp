import { readFile, writeFile } from "node:fs/promises";

const bundleUrl = new URL("../dist/server.js", import.meta.url);
const bundle = await readFile(bundleUrl, "utf8");
const normalized = bundle.replace(/[\t ]+$/gm, "");

if (normalized !== bundle) {
  await writeFile(bundleUrl, normalized);
}
