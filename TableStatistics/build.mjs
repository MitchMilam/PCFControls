import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const result = await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  target: "es2019",
  define: { "process.env.NODE_ENV": '"production"' },
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/styles.css", "utf8");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Table Statistics</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/tablestatistics.html", html);
console.log(`dist/tablestatistics.html ${(html.length / 1024).toFixed(0)} KB`);
