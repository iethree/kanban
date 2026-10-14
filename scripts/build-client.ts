// Bundles the frontend into ./dist for Workers static assets.
import { $ } from "bun";

await $`rm -rf dist`;

const result = await Bun.build({
  entrypoints: ["./src/client/index.html"],
  outdir: "./dist",
  minify: true,
  publicPath: "/",
  env: "disable",
  // Fonts are copied in below rather than inlined into the CSS as data URIs.
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const fonts = "node_modules/@fontsource-variable/inter/files";
await Bun.write("dist/fonts/inter-latin.woff2", Bun.file(`${fonts}/inter-latin-wght-normal.woff2`));
await Bun.write("dist/fonts/inter-latin-ext.woff2", Bun.file(`${fonts}/inter-latin-ext-wght-normal.woff2`));

for (const out of result.outputs) console.log(`  ${out.path.replace(process.cwd() + "/", "")}  ${(out.size / 1024).toFixed(1)} KB`);
