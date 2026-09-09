import {
  cleanOutput,
  copyStyles,
  createFrontendBuild,
  verifyBundleSize,
  watchStyles,
} from "./frontend-build.mjs";

const watching = process.argv.slice(2).includes("--watch");
const unsupported = process.argv.slice(2).filter((argument) => argument !== "--watch");
if (unsupported.length > 0) throw new Error(`Unsupported argument: ${unsupported[0]}`);

await cleanOutput();
const build = await createFrontendBuild();
await build.rebuild();
await copyStyles();
const bundleSize = await verifyBundleSize();
console.log(`Built player-history.js (${bundleSize} bytes) and player-history.css`);

if (watching) {
  await build.watch();
  watchStyles({
    onSuccess: () => console.log("Updated player-history.css"),
    onError: (error) => console.error("Stylesheet build failed:", error),
  });
} else {
  await build.dispose();
}
