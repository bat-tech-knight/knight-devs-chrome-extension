#!/usr/bin/env node
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "build", "extension");

const common = {
  bundle: true,
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "info",
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, "src/background.ts")],
    outfile: path.join(outDir, "background.js"),
    format: "esm",
  });

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, "src/content/index.ts")],
    outfile: path.join(outDir, "content.js"),
    format: "iife",
  });

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, "src/popup/index.ts")],
    outfile: path.join(outDir, "popup.js"),
    format: "iife",
  });

  fs.copyFileSync(path.join(root, "manifest.json"), path.join(outDir, "manifest.json"));

  const popupSrc = path.join(root, "src/popup/popup.html");
  let popupHtml = fs.readFileSync(popupSrc, "utf8");
  popupHtml = popupHtml.replace(
    /<script\s+src="[^"]*"\s*>\s*<\/script>/i,
    '<script src="popup.js"></script>'
  );
  fs.writeFileSync(path.join(outDir, "popup.html"), popupHtml, "utf8");

  console.log(`Extension bundle ready: ${path.relative(root, outDir)}`);
}

await main();
