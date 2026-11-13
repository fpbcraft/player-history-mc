import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { dioramaWebFiles, pinnedDioramaRef } from "../diorama-preview-assets.mjs";
const tar = (name: string) => {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write("00000000001\0", 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, Buffer.from("x"), Buffer.alloc(511), Buffer.alloc(1024)]));
};
it("pins the hosted Diorama frontend to the same full commit as browser CI", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  expect(pinnedDioramaRef(workflow)).toMatch(/^[0-9a-f]{40}$/);
  expect(() => pinnedDioramaRef("repository: fpbcraft/diorama\nref: master")).toThrow();
});
it("rejects traversing archive paths and incomplete frontend exports", () => {
  expect(() => dioramaWebFiles(tar("repo/src/main/resources/diorama/web/../../secret.js"))).toThrow(
    "Unsafe",
  );
  expect(() => dioramaWebFiles(tar("repo/src/main/resources/diorama/web/index.html"))).toThrow(
    "missing",
  );
});
