import { describe, expect, it } from "bun:test";
import { canonicalJsonStringify, computePayloadHash } from "../../src/domain/utils/canonical-json.util";

describe("Canonical JSON & Hash", () => {
  it("generates identical canonical json and hash regardless of property key order", () => {
    const obj1 = {
      providerId: "provider-a",
      roundId: "round-1",
      kind: "BET",
      money: { currency: "BRL", amount: "25.00" },
    };

    const obj2 = {
      kind: "BET",
      money: { amount: "25.00", currency: "BRL" },
      providerId: "provider-a",
      roundId: "round-1",
    };

    expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
    expect(computePayloadHash(obj1)).toBe(computePayloadHash(obj2));
  });

  it("produces different hash when values differ", () => {
    const obj1 = { providerId: "provider-a", amount: "25.00" };
    const obj2 = { providerId: "provider-a", amount: "25.01" };

    expect(computePayloadHash(obj1)).not.toBe(computePayloadHash(obj2));
  });
});
