import { timingSafeEqual } from "node:crypto";

export function matchesApiKey(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(candidate);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
