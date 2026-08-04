import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { auditTokenLiterals } from "./tokenAudit";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("TC-PC08-001 token literal audit", () => {
  it("finds no literal hex/px in packages/ui or apps/ where a token exists for that exact value", () => {
    // apps/supplier was missing from this list, which is exactly how it came
    // to carry literal #ddd borders, #666 muted text and a hardcoded #1a7f4e
    // "success" green that no token ever defined — unnoticed, because nothing
    // looked. Every app is audited now.
    const violations = auditTokenLiterals(
      repoRoot,
      [
        "packages/ui/src/components",
        // The icon system carries its own stylesheet outside components/.
        "packages/ui/src/icons",
        "apps/store",
        "apps/admin",
        "apps/driver",
        "apps/supplier",
        "packages/app-shell/src"
      ],
      "packages/ui/src/tokens/tokens.generated.css"
    );
    expect(violations).toEqual([]);
  });
});
