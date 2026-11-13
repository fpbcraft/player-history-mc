import { gunzipSync } from "node:zlib";

export const pinnedDioramaRef = (workflow) => {
  const ref = workflow.match(/repository:\s*fpbcraft\/diorama\s*\n\s*ref:\s*([0-9a-f]{40})\b/)?.[1];
  if (!ref) throw Error("The Diorama browser fixture must pin a full Git commit");
  return ref;
};

/** Read only regular frontend files; archive paths never become filesystem paths unchecked. */
export const dioramaWebFiles = (archive) => {
  const tar = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 });
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString()
        .replace(/\0.*$/s, "");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(text(124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
      throw Error("Invalid Diorama source archive");
    const prefix = "/src/main/resources/diorama/web/",
      at = name.indexOf(prefix);
    if (at > 0 && [0, 48].includes(header[156])) {
      const file = name.slice(at + prefix.length);
      if (
        !file ||
        file
          .split("/")
          .some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")
      )
        throw Error("Unsafe frontend archive path");
      if (/\.(html|js|css|fsh|png|svg|json)$/.test(file))
        files.set(file, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  for (const required of [
    "index.html",
    "overlay-api.js",
    "map-controls.js",
    "web-markers.js",
    "web-fog.js",
    "fog-gpu.js",
    "fog-mask.js",
    "fog-mask-task.js",
    "fog-mask-worker.js",
    "fog-coverage.js",
    "fog-reveal.js",
    "fog.fsh",
    "fog-noise.png",
  ])
    if (!files.has(required)) throw Error(`Standalone Diorama frontend is missing ${required}`);
  return files;
};
