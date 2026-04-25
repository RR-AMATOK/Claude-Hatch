/**
 * Tests for src/util/hash.ts — SHA-256 + canonical JSON (DEC-018)
 *
 * Acceptance criteria (DEC-018 §8):
 *   - sha256("") is a known 64-char hex string
 *   - sha256 of the same input always returns the same string
 *   - canonicalJson produces sorted keys at all depths
 *   - Two structurally equal objects with different key insertion order
 *     produce the same canonicalJson and therefore the same sha256
 *   - Arrays preserve order
 */

import { describe, it, expect } from "vitest";
import { sha256, canonicalJson } from "./hash.js";

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe("sha256", () => {
  it("returns a 64-character lowercase hex string", () => {
    const digest = sha256("hello");
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("empty string has known digest", () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb924" +
      "27ae41e4649b934ca495991b7852b855"
    );
  });

  it("is deterministic — same input → same output across calls", () => {
    const a = sha256("test input");
    const b = sha256("test input");
    expect(a).toBe(b);
  });

  it("different inputs produce different digests", () => {
    expect(sha256("foo")).not.toBe(sha256("bar"));
  });

  it("accepts a Buffer", () => {
    const strDigest = sha256("hello");
    const bufDigest = sha256(Buffer.from("hello", "utf8"));
    expect(bufDigest).toBe(strDigest);
  });

  it("is case-sensitive — 'Hello' ≠ 'hello'", () => {
    expect(sha256("Hello")).not.toBe(sha256("hello"));
  });
});

// ---------------------------------------------------------------------------
// canonicalJson
// ---------------------------------------------------------------------------

describe("canonicalJson", () => {
  it("serialises a flat object with keys in sorted order", () => {
    const result = canonicalJson({ z: 1, a: 2, m: 3 });
    // Keys should appear in alphabetical order: a, m, z
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("serialises a nested object with recursively sorted keys", () => {
    const obj = { outer: { z: 1, a: 2 }, foo: "bar" };
    const result = canonicalJson(obj);
    // outer and foo are sorted (foo < outer); inside outer: a < z
    expect(result).toBe('{"foo":"bar","outer":{"a":2,"z":1}}');
  });

  it("preserves array element order", () => {
    const obj = { arr: [3, 1, 2], key: "val" };
    const result = canonicalJson(obj);
    expect(result).toBe('{"arr":[3,1,2],"key":"val"}');
  });

  it("is deterministic — DEC-018 requirement", () => {
    // Core acceptance criterion: two events with identical payloads
    // always produce the same canonical JSON.
    const event1 = {
      id: "01HTEST000000000000001",
      type: "tokens.delta",
      ts: "2026-04-17T12:00:00.000Z",
      petId: "pet-1",
      source: "hook",
      payload: { tokens: 1000 },
      prevHash: "",
    };
    const event2 = {
      // Same content, different key insertion order
      prevHash: "",
      source: "hook",
      petId: "pet-1",
      ts: "2026-04-17T12:00:00.000Z",
      type: "tokens.delta",
      id: "01HTEST000000000000001",
      payload: { tokens: 1000 },
    };
    expect(canonicalJson(event1)).toBe(canonicalJson(event2));
  });

  it("two equal objects always hash to the same sha256 (DEC-018 acceptance criterion §8)", () => {
    const a = { z: 9, a: 1, payload: { beta: true, alpha: false } };
    const b = { a: 1, payload: { alpha: false, beta: true }, z: 9 };
    expect(sha256(canonicalJson(a))).toBe(sha256(canonicalJson(b)));
  });

  it("handles null values", () => {
    const result = canonicalJson({ petId: null, value: 42 });
    expect(result).toBe('{"petId":null,"value":42}');
  });

  it("handles primitive inputs (not objects)", () => {
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
  });

  it("handles empty object", () => {
    expect(canonicalJson({})).toBe("{}");
  });

  it("handles empty array", () => {
    expect(canonicalJson([])).toBe("[]");
  });
});
