import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { assertEvictionPolicy, RedisEvictionPolicyError } from "./assertEvictionPolicy";

function fakeConnection(infoBody: string): Redis {
  return {
    info: async (_section: string) => infoBody,
  } as unknown as Redis;
}

const NOEVICTION_INFO = `# Memory
used_memory:9943576
used_memory_human:9.48M
maxmemory:1103269725
maxmemory_human:1.03G
maxmemory_policy:noeviction
`;

const VOLATILE_LRU_INFO = `# Memory
used_memory:9943576
maxmemory:1103269725
maxmemory_policy:volatile-lru
`;

const MISSING_POLICY_INFO = `# Memory
used_memory:9943576
maxmemory:1103269725
`;

describe("assertEvictionPolicy", () => {
  it("resolves when maxmemory_policy is noeviction", async () => {
    await expect(assertEvictionPolicy(fakeConnection(NOEVICTION_INFO))).resolves.toBeUndefined();
  });

  it("throws RedisEvictionPolicyError when policy is volatile-lru", async () => {
    await expect(assertEvictionPolicy(fakeConnection(VOLATILE_LRU_INFO)))
      .rejects.toBeInstanceOf(RedisEvictionPolicyError);
    await expect(assertEvictionPolicy(fakeConnection(VOLATILE_LRU_INFO)))
      .rejects.toThrow(/volatile-lru.*noeviction/);
  });

  it("throws when maxmemory_policy field is missing from INFO output", async () => {
    await expect(assertEvictionPolicy(fakeConnection(MISSING_POLICY_INFO)))
      .rejects.toBeInstanceOf(RedisEvictionPolicyError);
    await expect(assertEvictionPolicy(fakeConnection(MISSING_POLICY_INFO)))
      .rejects.toThrow(/Could not read maxmemory_policy/);
  });

  it("trims trailing whitespace from the policy value", async () => {
    const padded = "# Memory\nmaxmemory_policy:noeviction   \n";
    await expect(assertEvictionPolicy(fakeConnection(padded))).resolves.toBeUndefined();
  });
});
