export const usage = `Usage: npm run dev -- --target <http-or-https-url> [options]

Options:
  --host <address>  Development server address (default: 127.0.0.1)
  --port <number>   Development server port (default: 3000)
  --no-open         Do not open a browser automatically
  --help            Show this help`;

function readOption(arguments_, index, name) {
  const argument = arguments_[index];
  const prefix = `${name}=`;
  if (argument?.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 0 };
  if (argument !== name) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return { value, consumed: 1 };
}

export function parseDevOptions(arguments_) {
  const options = { host: "127.0.0.1", port: 3000, open: true };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") return { help: true };
    if (argument === "--no-open") {
      options.open = false;
      continue;
    }

    const target = readOption(arguments_, index, "--target");
    if (target) {
      if (options.target) throw new Error("--target may only be provided once");
      options.target = target.value;
      index += target.consumed;
      continue;
    }

    const host = readOption(arguments_, index, "--host");
    if (host) {
      if (!host.value) throw new Error("--host requires a value");
      options.host = host.value;
      index += host.consumed;
      continue;
    }

    const port = readOption(arguments_, index, "--port");
    if (port) {
      if (!/^\d+$/.test(port.value)) throw new Error("--port must be an integer from 1 to 65535");
      options.port = Number(port.value);
      if (options.port < 1 || options.port > 65_535) {
        throw new Error("--port must be an integer from 1 to 65535");
      }
      index += port.consumed;
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  if (!options.target) throw new Error("--target is required");
  let target;
  try {
    target = new URL(options.target);
  } catch {
    throw new Error("--target must be a valid HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("--target must use HTTP or HTTPS");
  }
  if (target.username || target.password || target.search || target.hash) {
    throw new Error("--target must not contain credentials, a query, or a URL hash");
  }
  options.target = target.href;
  return options;
}

export function playerHistoryAsset(pathname) {
  const match = pathname.match(/\/player-history(?:-[^/]+)?\.(js|css)$/);
  return match?.[1];
}

export function lanDevelopmentUrls(interfaces, protocol, port) {
  return Object.values(interfaces)
    .flat()
    .filter(
      (address) =>
        address && !address.internal && (address.family === "IPv4" || address.family === 4),
    )
    .map((address) => `${protocol}//${address.address}:${port}`);
}
