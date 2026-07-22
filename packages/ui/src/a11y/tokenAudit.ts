// TC-PC08-001 (FR-PC08-001): "no literal hex/px where a token exists" —
// mechanical value-based audit, not a style-linter reimplementation. Reverse-
// maps each generated color/radius token to its literal CSS value, then
// scans real stylesheets (with var(...) calls stripped first, so a token's
// own definition and legitimate var() usage never self-flag) for that
// literal value appearing outside a token declaration.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface TokenViolation {
  file: string;
  line: number;
  value: string;
  token: string;
}

function parseTokenValues(tokensCss: string): Map<string, string> {
  // Only :root-scoped color/radius tokens — these are context-invariant
  // (unlike --font-display/--lh-ar, which legitimately differ under
  // html[lang="en"], so a literal-value match there would be a false
  // positive rather than a real violation).
  const rootBlockMatch = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/);
  const rootBlock = rootBlockMatch?.[1] ?? "";
  const values = new Map<string, string>();
  const declRegex = /--([\w-]+):\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declRegex.exec(rootBlock))) {
    const [, name, rawValue] = match;
    const value = rawValue!.trim();
    // Only single literal hex colors or literal px lengths are collision-
    // prone; gradients/clamp()/font stacks are inherently non-literal.
    if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^\d+px$/.test(value)) {
      values.set(value.toLowerCase(), name!);
    }
  }
  return values;
}

function listCssFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCssFiles(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** Scans `dirs` for literal uses of any color/radius token's own value,
 * excluding the generated token file itself (where the literals are the
 * canonical source, not a violation) and `var(...)` call sites. */
export function auditTokenLiterals(repoRoot: string, dirs: string[], generatedTokensPath: string): TokenViolation[] {
  const tokenValues = parseTokenValues(readFileSync(path.join(repoRoot, generatedTokensPath), "utf8"));
  const violations: TokenViolation[] = [];
  const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
  const pxPattern = /\b\d+px\b/g;

  for (const dir of dirs) {
    for (const file of listCssFiles(path.join(repoRoot, dir))) {
      if (path.resolve(file) === path.resolve(repoRoot, generatedTokensPath)) continue;
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((lineText, idx) => {
        // Strip var(...) calls so a token's own reference form never
        // self-matches (e.g. var(--gold) contains no literal value at all,
        // but this also guards px inside var() fallbacks if any appear).
        const stripped = lineText.replace(/var\([^)]*\)/g, "");
        for (const pattern of [hexPattern, pxPattern]) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(stripped))) {
            const found = m[0].toLowerCase();
            const token = tokenValues.get(found);
            if (token) {
              violations.push({ file: path.relative(repoRoot, file), line: idx + 1, value: m[0], token });
            }
          }
        }
      });
    }
  }
  return violations;
}
