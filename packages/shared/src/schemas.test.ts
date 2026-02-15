import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./schemas";

describe("healthResponseSchema", () => {
  it("accepts a valid health payload", () => {
    const parsed = healthResponseSchema.parse({ status: "ok" });
    expect(parsed.status).toBe("ok");
  });

  it("rejects an invalid health payload", () => {
    const parsed = healthResponseSchema.safeParse({ status: "down" });
    expect(parsed.success).toBe(false);
  });
});
