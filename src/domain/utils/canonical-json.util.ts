import { createHash } from "crypto";

/**
 * Serializes an object into a canonical JSON string with sorted keys recursively.
 * Ensures consistent serialization regardless of key ordering.
 */
export function canonicalJsonStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalJsonStringify(item)).join(",") + "]";
  }

  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Computes SHA-256 hash of the canonical JSON representation of business fields.
 */
export function computePayloadHash(businessPayload: Record<string, any>): string {
  const canonical = canonicalJsonStringify(businessPayload);
  return createHash("sha256").update(canonical).digest("hex");
}
