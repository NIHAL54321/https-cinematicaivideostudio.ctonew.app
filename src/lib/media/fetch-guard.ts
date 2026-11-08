/**
 * WHAT THIS SERVER IS WILLING TO FETCH (Phase 8, security block).
 *
 * `ingestStockFootage` fetches a URL that came from a client: `/api/media/select`
 * stores whatever `asset.url` the caller sends, and `/api/media/ingest` then
 * fetches it server-side. Before this module existed the fetch was
 * `fetch(url, { redirect: "follow" })` — no scheme check, no address check, no
 * redirect check and no timeout. A probe on 2026-11-06 proved what that means:
 * an authenticated caller could make the app fetch `http://127.0.0.1:3100/...`,
 * `http://localhost:...`, `http://[::1]/...`, `http://169.254.169.254/...` and
 * `http://10.0.0.1/`, and the bytes came back to the caller (stored in object
 * storage and reported with their size and SHA-256). That is server-side request
 * forgery: the app is a proxy for anything the machine can reach, including its
 * own loopback, its database, and the cloud metadata service.
 *
 * The rule here is an allow-list by address class, checked BEFORE the connection
 * is opened and again for every redirect hop:
 *
 *   - the scheme must be http or https (`file:`, `gopher:`, `data:` are refused);
 *   - the host must resolve, and EVERY address it resolves to must be public:
 *     loopback, private (RFC1918), link-local (169.254/16 — the metadata
 *     service), CGNAT, unique-local IPv6, multicast and the unspecified address
 *     are all refused;
 *   - a redirect is followed by hand, at most MAX_REDIRECTS times, and each hop
 *     is re-checked by the same rule — so a public host that redirects to
 *     127.0.0.1 is refused at the hop, not followed;
 *   - the whole fetch has a deadline, so a host that accepts the connection and
 *     then never answers cannot hold a request open.
 *
 * What this does NOT close, stated rather than blurred: the address is resolved
 * here and the connection is made by `fetch` afterwards, so a DNS name whose
 * answer changes between the two (DNS rebinding, TTL 0) could still reach a
 * private address. Closing that needs the connection pinned to the resolved IP
 * (a custom dispatcher), which this build does not have. It is recorded as an
 * open finding in evidence/phase8_security/FINDINGS.md.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 20_000;

/** Why a URL was refused. `code` is what the API reports; `message` is the sentence. */
export class UnsafeFetchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UnsafeFetchError";
    this.code = code;
  }
}

/** A dotted-quad or IPv6 address that must never be fetched. Null when it is public. */
export function blockedAddressReason(address: string): string | null {
  const bare = address.replace(/^\[|\]$/g, "");
  const family = isIP(bare);

  if (family === 4) {
    const parts = bare.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return `${address} is not a usable IPv4 address`;
    }
    const [a, b] = parts;
    if (a === 0) return `${address} is the unspecified/this-network range (0.0.0.0/8)`;
    if (a === 10) return `${address} is private (10.0.0.0/8)`;
    if (a === 127) return `${address} is loopback (127.0.0.0/8) — the app's own ports are not a media source`;
    if (a === 169 && b === 254) return `${address} is link-local (169.254.0.0/16) — this is the cloud metadata range, never a media source`;
    if (a === 172 && b >= 16 && b <= 31) return `${address} is private (172.16.0.0/12)`;
    if (a === 192 && b === 168) return `${address} is private (192.168.0.0/16)`;
    if (a === 100 && b >= 64 && b <= 127) return `${address} is carrier-grade NAT space (100.64.0.0/10)`;
    if (a === 192 && b === 0 && parts[2] === 0) return `${address} is IETF protocol space (192.0.0.0/24)`;
    if (a === 198 && (b === 18 || b === 19)) return `${address} is benchmarking space (198.18.0.0/15)`;
    if (a >= 224) return `${address} is multicast or reserved (224.0.0.0/4 and above)`;
    return null;
  }

  if (family === 6) {
    const lower = bare.toLowerCase();
    if (lower === "::" || lower === "::0") return `${address} is the unspecified address`;
    if (lower === "::1") return `${address} is loopback — the app's own ports are not a media source`;
    // IPv4-mapped (::ffff:127.0.0.1) is judged by its IPv4 part.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return blockedAddressReason(mapped[1]);
    const head = lower.split(":")[0] ?? "";
    const first = parseInt(head || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return `${address} is unique-local (fc00::/7)`;
    if ((first & 0xffc0) === 0xfe80) return `${address} is link-local (fe80::/10)`;
    if ((first & 0xff00) === 0xff00) return `${address} is multicast (ff00::/8)`;
    return null;
  }

  return `${address} is not an IP address`;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

/**
 * Throws `UnsafeFetchError` unless `raw` is an http(s) URL whose host resolves
 * only to public addresses. Returns the parsed URL when it is acceptable.
 */
export async function assertSafeFetchUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeFetchError("unsafe_url", `"${raw}" is not a URL this build can fetch.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeFetchError(
      "unsafe_scheme",
      `The URL uses the "${url.protocol}" scheme. Only http and https are fetched: a file:, data: or gopher: URL is not a media source and is refused before any request is made.`,
    );
  }
  if (url.username || url.password) {
    throw new UnsafeFetchError("unsafe_url", "The URL carries credentials. Credentials in a media URL are refused rather than sent.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new UnsafeFetchError("unsafe_url", "The URL has no host.");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeFetchError("private_address", `${host} names this machine or an internal service, which is never a media source.`);
  }

  const literal = isIP(host);
  if (literal !== 0) {
    const reason = blockedAddressReason(host);
    if (reason) throw new UnsafeFetchError("private_address", `${reason}. Refused before the connection is opened.`);
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new UnsafeFetchError("unresolvable_host", `${host} could not be resolved (${(err as Error).message}), so it is not fetched.`);
  }
  if (addresses.length === 0) {
    throw new UnsafeFetchError("unresolvable_host", `${host} resolved to no address, so it is not fetched.`);
  }
  for (const entry of addresses) {
    const reason = blockedAddressReason(entry.address);
    if (reason) {
      throw new UnsafeFetchError(
        "private_address",
        `${host} resolves to ${entry.address}, and ${reason}. A hostname that points at this machine or a private network is refused before the connection is opened.`,
      );
    }
  }
  return url;
}

export interface GuardedFetch {
  response: Response;
  /** The URL that actually answered, after any redirects. */
  finalUrl: string;
  /** Every hop, in order, with the address check that was applied. */
  hops: string[];
}

/**
 * fetch() with the address rule applied to the first request AND to every
 * redirect hop, a bounded number of hops, and a deadline for the whole exchange.
 */
export async function guardedFetch(raw: string, init: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<GuardedFetch> {
  const deadline = AbortSignal.timeout(init.timeoutMs ?? FETCH_TIMEOUT_MS);
  const hops: string[] = [];
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertSafeFetchUrl(current);
    hops.push(url.toString());
    const response = await fetch(url, {
      redirect: "manual",
      signal: deadline,
      headers: init.headers,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) {
        throw new UnsafeFetchError("bad_redirect", `${url.toString()} answered ${response.status} with no Location header, so the fetch stops here.`);
      }
      current = new URL(location, url).toString();
      continue;
    }
    return { response, finalUrl: url.toString(), hops };
  }
  throw new UnsafeFetchError(
    "too_many_redirects",
    `The URL redirected more than ${MAX_REDIRECTS} times (${hops.join(" -> ")}); a redirect chain that long is not followed.`,
  );
}
