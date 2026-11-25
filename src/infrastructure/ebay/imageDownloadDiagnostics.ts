import { ImageDownloadRefusal } from "./imageDownloadPolicy";

// Operation-local categories only. No server/address, question, packet, URL,
// message, stack, errno or original Error object belongs in this projection.
export const DNS_DIAGNOSTIC_PHASES = ["configuration", "connect", "exchange", "framing", "parse", "combine", "resolution"] as const;
export const DNS_DIAGNOSTIC_REASONS = ["invalid-server", "native-error", "closed", "limit", "invalid-frame", "invalid-message", "negative-incomplete", "inconsistent-answers", "aborted", "deadline"] as const;
export const DNS_NATIVE_CODES = ["EACCES", "EPERM", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL", "EPIPE", "ENOBUFS", "ENOMEM", "EMFILE", "ENFILE", "EINVAL", "ERR_SOCKET_BAD_PORT", "ERR_INVALID_IP_ADDRESS"] as const;
export interface ImageDnsDiagnostic {
  readonly phase: typeof DNS_DIAGNOSTIC_PHASES[number];
  readonly reason: typeof DNS_DIAGNOSTIC_REASONS[number];
  readonly nativeCode: typeof DNS_NATIVE_CODES[number] | null;
}

export function imageDnsDiagnostic(phase: ImageDnsDiagnostic["phase"], reason: ImageDnsDiagnostic["reason"], error?: unknown): Readonly<ImageDnsDiagnostic> {
  let nativeCode: ImageDnsDiagnostic["nativeCode"] = null;
  if (reason === "native-error") {
    try {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (typeof code === "string" && code.length <= 32 && (DNS_NATIVE_CODES as readonly string[]).includes(code)) nativeCode = code as typeof DNS_NATIVE_CODES[number];
    } catch { /* Unreadable/unknown native metadata is not disclosed. */ }
  }
  return Object.freeze({ phase, reason, nativeCode });
}

export class ImageDnsRefusal extends ImageDownloadRefusal {
  readonly dns: Readonly<ImageDnsDiagnostic>;
  constructor(phase: ImageDnsDiagnostic["phase"], reason: ImageDnsDiagnostic["reason"], error?: unknown) {
    super("dns");
    this.dns = imageDnsDiagnostic(phase, reason, error);
  }
}
