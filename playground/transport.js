export const DIRECT_MODELS_URL = "https://api.typesafe.ai/v1/models";
export const DIRECT_SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

const LOCAL_RELAY_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeRelayBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new TypeError("Enter the URL of a relay you control.");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Relay URL is not a valid URL.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Relay URL must not contain credentials, a query string, or a fragment.");
  }

  const isLocal = LOCAL_RELAY_HOSTS.has(url.hostname);
  const isWorkersDev =
    url.protocol === "https:" &&
    url.hostname.toLowerCase().endsWith(".workers.dev");

  if (!isLocal && !isWorkersDev) {
    throw new TypeError(
      "For this static Playground, relay URLs are limited to HTTPS *.workers.dev or localhost.",
    );
  }

  if (isLocal && !["http:", "https:"].includes(url.protocol)) {
    throw new TypeError("Local relay URL must use HTTP or HTTPS.");
  }

  if (!isLocal && url.protocol !== "https:") {
    throw new TypeError("Remote relay URL must use HTTPS.");
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new TypeError("Relay URL must point to the relay origin, without an extra path.");
  }

  return url.origin;
}

export function resolveApiEndpoint({ transport, relayBaseUrl = "", path }) {
  if (path !== "/v1/models" && path !== "/v1/systemone") {
    throw new TypeError("Unsupported TypeSafe API path.");
  }

  if (transport === "direct") {
    return path === "/v1/models" ? DIRECT_MODELS_URL : DIRECT_SYSTEM_ONE_URL;
  }

  if (transport !== "relay") {
    throw new TypeError("Unknown Playground transport.");
  }

  return `${normalizeRelayBaseUrl(relayBaseUrl)}${path}`;
}


export function resolveRelayEndpoint({ relayBaseUrl = "", path }) {
  if (path !== "/health" && path !== "/v1/models" && path !== "/v1/systemone") {
    throw new TypeError("Unsupported JEV relay path.");
  }
  return `${normalizeRelayBaseUrl(relayBaseUrl)}${path}`;
}

export function isBrowserNetworkFailure(error) {
  return (
    error instanceof TypeError &&
    /failed to fetch|networkerror|load failed/i.test(error.message || "")
  );
}
