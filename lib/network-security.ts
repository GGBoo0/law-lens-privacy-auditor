import dns from "node:dns";

const MAX_URL_CHARS = 2_048;
const DNS_TIMEOUT_MS = 4_000;

const blockedHostSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
  ".invalid",
  ".test",
  ".example",
  ".onion",
];

function normalizeHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .split("%")[0];
}

function parseIpv4(value: string) {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  ) {
    return null;
  }
  return parts.map(Number);
}

function ipv4Number(parts: number[]) {
  return (
    ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 +
    parts[3]
  );
}

function inIpv4Cidr(parts: number[], base: string, prefix: number) {
  const baseParts = parseIpv4(base);
  if (!baseParts) return false;
  const size = 2 ** (32 - prefix);
  return Math.floor(ipv4Number(parts) / size) === Math.floor(ipv4Number(baseParts) / size);
}

export function isPublicIpv4(value: string) {
  const parts = parseIpv4(value);
  if (!parts) return false;

  const blockedRanges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return !blockedRanges.some(([base, prefix]) =>
    inIpv4Cidr(parts, base, prefix),
  );
}

function parseIpv6(value: string) {
  let normalized = normalizeHostname(value);
  if (!normalized.includes(":")) return null;

  const dottedTail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (dottedTail) {
    const ipv4 = parseIpv4(dottedTail[1]);
    if (!ipv4) return null;
    normalized = normalized.slice(0, -dottedTail[1].length) +
      `${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  if (normalized.indexOf("::") !== normalized.lastIndexOf("::")) return null;
  const hasCompression = normalized.includes("::");
  const [leftRaw, rightRaw = ""] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (
    [...left, ...right].some((group) => !/^[\da-f]{1,4}$/i.test(group))
  ) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) {
    return null;
  }
  return [
    ...left.map((group) => Number.parseInt(group, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((group) => Number.parseInt(group, 16)),
  ];
}

export function isPublicIpv6(value: string) {
  const words = parseIpv6(value);
  if (!words) return false;

  const allZero = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const uniqueLocal = (words[0] & 0xfe00) === 0xfc00;
  const linkLocal = (words[0] & 0xffc0) === 0xfe80;
  const multicast = (words[0] & 0xff00) === 0xff00;
  const documentation = words[0] === 0x2001 && words[1] === 0x0db8;
  const teredo = words[0] === 0x2001 && words[1] === 0;
  const sixToFour = words[0] === 0x2002;
  const translation =
    words[0] === 0x0064 &&
    words[1] === 0xff9b &&
    (words[2] === 0 || words[2] === 1);
  const ipv4Mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const ipv4Compatible = words.slice(0, 6).every((word) => word === 0);

  if (
    allZero ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    multicast ||
    documentation ||
    teredo ||
    sixToFour ||
    translation
  ) {
    return false;
  }

  if (ipv4Mapped || ipv4Compatible) {
    const embedded = `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
    return isPublicIpv4(embedded);
  }
  return true;
}

export function normalizeAndAssertPublicUrl(value: string | URL) {
  const raw = typeof value === "string" ? value.trim() : value.toString();
  if (!raw || raw.length > MAX_URL_CHARS) {
    throw new Error("웹사이트 주소는 2,048자 이하여야 합니다.");
  }
  const candidate =
    typeof value === "string" && !/^[a-z][a-z\d+.-]*:\/\//i.test(raw)
      ? `https://${raw}`
      : raw;
  const url = new URL(candidate);
  url.hash = "";

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("http 또는 https 주소만 분석할 수 있습니다.");
  }
  if (url.username || url.password) {
    throw new Error("로그인 정보가 포함된 주소는 분석할 수 없습니다.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("일반 웹 포트(80, 443)의 공개 페이지를 입력해 주세요.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname === "localhost" ||
    hostname === "metadata" ||
    hostname === "metadata.google.internal" ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("공개 인터넷에 있는 웹사이트만 분석할 수 있습니다.");
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && !isPublicIpv4(hostname)) {
    throw new Error("사설·예약 IP 주소는 분석할 수 없습니다.");
  }
  if (hostname.includes(":") && !isPublicIpv6(hostname)) {
    throw new Error("사설·예약 IPv6 주소는 분석할 수 없습니다.");
  }
  return url;
}

function dnsErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code);
}

async function queryDnsOverHttps(hostname: string, type: "A" | "AAAA") {
  const endpoint = new URL("https://dns.google/resolve");
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", type);
  const response = await fetch(endpoint, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error("공개 DNS 확인에 실패했습니다.");
  const result = (await response.json()) as {
    Status?: number;
    Answer?: Array<{ type?: number; data?: string }>;
  };
  if (result.Status !== 0 && result.Status !== 3) {
    throw new Error("공개 DNS 확인에 실패했습니다.");
  }
  const numericType = type === "A" ? 1 : 28;
  return (result.Answer ?? [])
    .filter((answer) => answer.type === numericType && answer.data)
    .map((answer) => answer.data as string);
}

async function queryDns(hostname: string, type: "A" | "AAAA") {
  const lookup =
    type === "A"
      ? dns.promises.resolve4(hostname)
      : dns.promises.resolve6(hostname);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const results = await Promise.race([
      lookup,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new DOMException("DNS timeout", "TimeoutError")),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
    const addresses = results.filter((address) =>
      type === "A" ? Boolean(parseIpv4(address)) : Boolean(parseIpv6(address)),
    );
    if (!addresses.length && results.length) {
      return queryDnsOverHttps(hostname, type);
    }
    return addresses;
  } catch (error) {
    const code = dnsErrorCode(error);
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    return queryDnsOverHttps(hostname, type);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function assertPublicDns(url: URL) {
  normalizeAndAssertPublicUrl(url);
  const hostname = normalizeHostname(url.hostname);
  if (parseIpv4(hostname) || hostname.includes(":")) return;

  let addresses: string[];
  try {
    const [ipv4, ipv6] = await Promise.all([
      queryDns(hostname, "A"),
      queryDns(hostname, "AAAA"),
    ]);
    addresses = [...ipv4, ...ipv6];
  } catch {
    throw new Error(
      "도메인의 공개 DNS 주소를 안전하게 확인하지 못했습니다. 원문 직접 입력을 이용해 주세요.",
    );
  }
  if (!addresses.length) {
    throw new Error("공개 DNS 주소가 확인되는 웹사이트만 분석할 수 있습니다.");
  }
  if (
    addresses.some((address) =>
      address.includes(":")
        ? !isPublicIpv6(address)
        : !isPublicIpv4(address),
    )
  ) {
    throw new Error("내부·사설 IP로 연결되는 도메인은 분석할 수 없습니다.");
  }
}

export async function readUtf8Stream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  sizeError: string,
) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(sizeError);
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
