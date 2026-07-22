/** Tiny classname joiner — avoids pulling in a dependency for one function. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
