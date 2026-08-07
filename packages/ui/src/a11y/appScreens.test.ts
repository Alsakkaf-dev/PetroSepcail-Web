// The Phase 9 accessibility and quality sweep, written down as a gate rather
// than performed once and forgotten.
//
// Everything here was checked by hand at least once across the 64 screens.
// Checking it by hand is how it stays true until the next screen lands; this
// file is how it stays true after that. It is deliberately a small set of
// mechanically-decidable rules with no false positives — the things a human
// reviewer should never have to look for again.
//
// What it cannot check, and what still needs a person with a browser: whether
// the focus order matches the visual order, whether a live region actually
// announces, whether a 44px target is reachable with a thumb, and whether any
// of it reads correctly in Arabic. Those are in the per-screen definition of
// done and they are not met yet for a single screen.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const APP_ROOTS = [
  "apps/store/app",
  "apps/store/components",
  "apps/admin/app",
  "apps/driver/app",
  "apps/driver/components",
  "apps/supplier/app",
  "apps/supplier/components"
];

function listTsx(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsx(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function appFiles(): Array<{ file: string; source: string }> {
  return APP_ROOTS.flatMap((root) =>
    listTsx(path.join(repoRoot, root)).map((file) => ({
      file: path.relative(repoRoot, file).split(path.sep).join("/"),
      source: readFileSync(file, "utf8")
    }))
  );
}

/** Strip block and line comments so a rule quoted in prose is not a hit. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("Phase 9 — the screen sweep", () => {
  const files = appFiles();

  it("scans a plausible number of screens (guards against the walker silently finding nothing)", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("has no inline style objects in any app", () => {
    // The gate the whole overhaul was measured against: 324 at the start.
    // Dynamic values go through a packages/ui primitive that sets the custom
    // property internally — Progress, Reveal, Bar, MapMarker.
    const offenders = files
      .filter(({ source }) => withoutComments(source).includes("style={{"))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("has no raw <table> in any app", () => {
    // 17 at the start. DataTable carries the sticky header, the sort state,
    // the pagination and the phone layout; a bare <table> carries none of it
    // and overflows the viewport at 360px.
    const offenders = files
      .filter(({ source }) => /<table[\s>]/.test(withoutComments(source)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("gives every image an alt attribute", () => {
    // An <img> with no alt is announced by its file name. `alt=""` is a
    // legitimate answer for decoration and is what this asks for.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      const tags = withoutComments(source).match(/<img\b[^>]*>/g) ?? [];
      for (const tag of tags) {
        if (!/\balt=/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("writes no literal colour into app source", () => {
    // Colour belongs in a stylesheet, keyed to a token. A hex in a .tsx is a
    // value that no contrast assertion will ever see.
    //
    // One exemption, and it is real: `viewport.themeColor` is read by the
    // browser's own chrome before any stylesheet has loaded, so `var(--blue)`
    // is not resolvable there. All four layouts carry the literal with that
    // reason written beside it.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      for (const line of withoutComments(source).split("\n")) {
        if (line.includes("themeColor")) continue;
        for (const match of line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
          if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(match)) {
            offenders.push(`${file}: ${match}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives every screen a first-level heading", () => {
    // A screen with no h1 is a screen a screen-reader user cannot orient in.
    //
    // Deliberately "at least one", not "exactly one": several screens return
    // early with a different heading per state — the driver's stock count is
    // "Start count" before submission and "Count submitted" after, which is
    // one h1 at runtime and two in the source. No static rule can tell that
    // apart from a genuine duplicate, and a rule with false positives is a
    // rule people learn to skip.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      if (!file.endsWith("/page.tsx")) continue;
      const stripped = withoutComments(source);
      const count = (stripped.match(/level=\{1\}/g) ?? []).length + (stripped.match(/<h1[\s>]/g) ?? []).length;
      // A screen may delegate its heading entirely — an auth gate renders
      // AuthShell, which carries its own.
      const delegates = /AuthShell|LoginGate|LoginForm|Route(Loading|Error|NotFound)/.test(stripped);
      if (count === 0 && !delegates) offenders.push(`${file}: no first-level heading`);
    }
    expect(offenders).toEqual([]);
  });

  it("never renders a bare API status string where a label belongs", () => {
    // `NOT_LOGGED_IN`, `CREDIT_LIMIT_EXCEEDED` and friends are registry codes.
    // They reach a screen through messageFor()/isApiError(), never as text.
    //
    // Matched against JSX text only: the inner run may hold no punctuation
    // that would make it code, which is what keeps a generic type argument
    // spanning two lines out of the results.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      const stripped = withoutComments(source);
      for (const match of stripped.match(/>[ \t]*[A-Z][A-Z_]{6,}[ \t]*</g) ?? []) {
        offenders.push(`${file}: ${match.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("puts no user-facing copy in app source", () => {
    // Every string a person reads comes from packages/i18n through t(). This
    // replaced four divergent app dictionaries and 41 inline
    // `locale === "ar" ? … : …` ternaries, and it is the reason a key can be
    // translated once rather than hunted for in four apps.
    //
    // JSX text is matched only when it closes its own tag (`>text</`), which
    // is what keeps a generic type argument — `Promise<void>` — out of the
    // results.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      const stripped = withoutComments(source);
      for (const match of stripped.match(/>[ \t]*[A-Za-z؀-ۿ][^<>{}]{2,}[ \t]*<\//g) ?? []) {
        offenders.push(`${file}: text ${match.trim().slice(0, 50)}`);
      }
      // A label, a placeholder or an accessible name given a literal is copy
      // just as much as a paragraph is — and the one most likely to be missed,
      // because it never appears on screen as a sentence.
      for (const match of stripped.match(/(aria-label|label|placeholder|emptyTitle|caption)="[^"]{3,}"/g) ?? []) {
        offenders.push(`${file}: ${match.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("forces LTR on every field that holds a technical value", () => {
    // An IBAN, a phone number or an OTP typed into an RTL input reorders
    // around its own punctuation. An unisolated IBAN is a payment sent to
    // nobody, which is why this is a gate and not a review note.
    const technical = /iban|phone|otp|email|sku|plate|vat|coupon|bankref|invoice|amount|qty|price|code/i;
    const offenders: string[] = [];
    for (const { file, source } of files) {
      for (const field of withoutComments(source).match(/<TextField[\s\S]{0,400}?\/>/g) ?? []) {
        const name = (field.match(/name="([^"]+)"/) ?? [])[1] ?? "";
        if (technical.test(name) && !/forceLtr/.test(field)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses the design system's controls rather than raw form elements", () => {
    // A raw control has no label shell, no error wiring, no focus ring and no
    // 44px floor. Every one of those is a thing the library already solved.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      const stripped = withoutComments(source);
      for (const tag of ["button", "select", "input", "textarea"]) {
        if (new RegExp(`<${tag}[\\s>]`).test(stripped)) offenders.push(`${file}: raw <${tag}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives every reported error a way out of it", () => {
    // "Something went wrong" with no retry is a dead end. The per-screen
    // definition of done asks for a *working* retry, and this is the half of
    // that a machine can check.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      for (const block of withoutComments(source).match(/<Data(?:Table|List)[\s\S]{0,900}?\/>/g) ?? []) {
        if (/errorMessage=/.test(block) && !/onRetry=/.test(block)) offenders.push(`${file}: error with no retry`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("announces the busy state on every screen that skeletons its content", () => {
    // A skeleton nobody can hear is a screen that says nothing at all while
    // it loads. Two or more is a content block; a single one standing in for
    // one control (the launcher's primary button before the session is read)
    // is not something to announce as "loading" — it would be noise for a
    // placeholder the reader is not waiting on.
    const offenders: string[] = [];
    for (const { file, source } of files) {
      const stripped = withoutComments(source);
      const skeletons = (stripped.match(/<Skeleton\b/g) ?? []).length;
      if (skeletons < 2) continue;
      if (!/aria-busy|role="status"/.test(stripped)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
