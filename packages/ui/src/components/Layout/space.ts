/** The application spacing ramp (`--d-1..--d-6`), named rather than numbered
 * so a call site reads as intent instead of arithmetic. This is deliberately
 * the *density* scale, not the brochure `--sp-*` scale: three of the four
 * apps are data-dense, and a table row an accountant scans two hundred of
 * must not inherit marketing-section air. `Section` is where brochure
 * breathing room comes from, and only where a screen asks for it. */
export type SpaceStep = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

/** Shared gap utility class — one definition consumed by Stack, Cluster and
 * Grid so the three can never drift apart. */
export function gapClass(step: SpaceStep): string {
  return `ps-gap-${step}`;
}
