import { copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const gitDir = ".git";
if (!existsSync(gitDir)) {
  // No .git in this build context (e.g. inside a Docker image build) — nothing to wire.
  process.exit(0);
}

const hooksDir = path.join(gitDir, "hooks");
mkdirSync(hooksDir, { recursive: true });

const source = path.join("scripts", "git-hooks", "pre-commit");
const target = path.join(hooksDir, "pre-commit");

copyFileSync(source, target);
chmodSync(target, 0o755);

console.log("[prepare] git pre-commit hook installed");
