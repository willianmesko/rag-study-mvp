const pilotCounts = Object.freeze([800, 100, 100]);
const sustainedCounts = Object.freeze([40000, ...Array(8).fill(1111), 1112]);
const pilot = Object.freeze({ name: "pilot", counts: pilotCounts, clients: 2, controlSeconds: 12, mixedSeconds: 24,
  durable: false, cacheTtlSeconds: 3600, deadlineMs: 240000, cold: false });
const durable = Object.freeze({ ...pilot, name: "durable-pilot", durable: true });
const sustained = Object.freeze({ name: "sustained", counts: sustainedCounts, clients: 10, controlSeconds: 60, mixedSeconds: 1800,
  durable: true, cacheTtlSeconds: 60, deadlineMs: 2700000, cold: true });
export function capacityProfile(name) {
  if (name === "pilot") return pilot;
  if (name === "durable-pilot") return durable;
  if (name === "sustained") return sustained;
  throw new Error("Choose a fixed pilot, durable-pilot or sustained capacity profile.");
}
export const corpusVersion = "capacity-corpus-v2";
export const chunkIdentityNumber = (workspace, ordinal) => {
  if (!Number.isInteger(workspace) || workspace < 0 || workspace > 9 ||
    !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= 40000) throw new Error("Invalid fixture chunk identity.");
  return workspace * 100000 + ordinal + 1;
};
