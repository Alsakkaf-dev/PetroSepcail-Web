import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { auditTokenLiterals } from "./tokenAudit";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("TC-PC08-001 token literal audit", () => {
  it("finds no literal hex/px in packages/ui or apps/ where a token exists for that exact value", () => {
    const violations = auditTokenLiterals(
      repoRoot,
      ["packages/ui/src/components", "apps/store", "apps/admin", "apps/driver"],
      "packages/ui/src/tokens/tokens.generated.css"
    );
    expect(violations).toEqual([]);
  });
});
