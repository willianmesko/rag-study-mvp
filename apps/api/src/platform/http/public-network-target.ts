import { Resolver } from "node:dns/promises";
import { BlockList, isIPv4 } from "node:net";

const maxUrlLength = 1_000;
export type PublicNetworkTargetErrorCode = "invalid_url" | "unsafe_destination" | "dns_failed";
const errorMessages: Record<PublicNetworkTargetErrorCode, string> = {
  invalid_url: "Enter a valid HTTPS URL without credentials or a custom port.",
  unsafe_destination: "The URL must point to a public website.",
  dns_failed: "The website could not be resolved to a public IPv4 address.",
};
export class PublicNetworkTargetError extends Error {
  constructor(readonly code: PublicNetworkTargetErrorCode) {
    super(errorMessages[code]);
    this.name = "PublicNetworkTargetError";
  }
}

// Block IANA special-purpose, multicast, and reserved ranges. Azure's platform
// virtual address is also blocked even though it uses a publicly assigned IP.
const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["168.63.129.16", 32], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24],
  ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

export function parseTarget(value: string, base?: URL): URL {
  // Reject parser corrections that could obscure the authority, including an
  // explicit but empty credentials segment that URL.username would discard.
  const absolute = /^https:\/\//i.test(value);
  const authority = /^(?:https:)?\/\/([^/?#]+)/i.exec(value)?.[1];
  const hasAuthority = absolute || value.startsWith("//");
  if (value.length > maxUrlLength || /[\u0000-\u0020\u007f\\]/.test(value)
    || (hasAuthority && (!authority || authority.includes("@")))
    || (!absolute && (!base || /^[a-z][a-z\d+.-]*:/i.test(value)))) {
    throw new PublicNetworkTargetError("invalid_url");
  }
  let url: URL;
  try { url = new URL(value, base); }
  catch { throw new PublicNetworkTargetError("invalid_url"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password)
    throw new PublicNetworkTargetError("invalid_url");

  const hostname = url.hostname.replace(/\.$/, "");
  if (isIPv4(hostname) || hostname.startsWith("[") || /(?:^|\.)(?:localhost|local|internal|home\.arpa|onion)$/.test(hostname))
    throw new PublicNetworkTargetError("unsafe_destination");
  if (!hostname.includes(".") || hostname.length > 253
    || !hostname.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)))
    throw new PublicNetworkTargetError("invalid_url");

  url.hostname = hostname;
  url.hash = "";
  if (url.href.length > maxUrlLength) throw new PublicNetworkTargetError("invalid_url");
  return url;
}

export async function resolvePublicAddress(hostname: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // A records only. The socket connects directly to the vetted IPv4 address.
  const resolver = new Resolver({ tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  let addresses: string[];
  try { addresses = await resolver.resolve4(hostname + "."); }
  catch { throw new PublicNetworkTargetError("dns_failed"); }
  finally { signal.removeEventListener("abort", cancel); }
  if (!addresses.length) throw new PublicNetworkTargetError("dns_failed");
  if (addresses.some((address) => !isIPv4(address) || blockedIpv4.check(address, "ipv4")))
    throw new PublicNetworkTargetError("unsafe_destination");
  return addresses[0]!;
}
