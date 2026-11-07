import assert from "node:assert/strict";
import test from "node:test";
import { GroundedClaimVerifier } from "./claim-verification.js";
import { rewriteRetrievalQuery } from "./retrieval-rewrite.js";
import type { Citation } from "../../domain/document.js";
const sources: Citation[] = [
  {
    chunkId: "chunk",
    documentId: "doc",
    source: "handbook",
    title: null,
    ordinal: 0,
    score: 0.8,
    content:
      "Records must be retained for 30 days. Records must not be shared externally.",
  },
];
test("extractive verification keeps factual leading numbers and negation", async () => {
  const verifier = new GroundedClaimVerifier();
  assert.equal(
    (
      await verifier.verify(
        "Records must not be shared externally.",
        sources,
        new AbortController().signal,
      )
    ).supported,
    true,
  );
  assert.equal(
    (
      await verifier.verify(
        "Records must be shared externally.",
        sources,
        new AbortController().signal,
      )
    ).supported,
    false,
  );
  assert.equal(
    (
      await verifier.verify(
        "Records must be retained for 90 days.",
        sources,
        new AbortController().signal,
      )
    ).supported,
    false,
  );
  assert.equal(
    (await verifier.verify("90 days.", sources, new AbortController().signal))
      .supported,
    false,
  );
});
test("judge must cover all claims and quote evidence from the supplied passage", async () => {
  const answer =
    "Records must be retained for 30 days. This also guarantees regulatory compliance.";
  const judge = {
    model: "fixture",
    assess: async () => [
      {
        claim: "Records must be retained for 30 days.",
        evidence: "Records must be retained for 30 days.",
      },
    ],
  };
  assert.equal(
    (
      await new GroundedClaimVerifier(judge).verify(
        answer,
        sources,
        new AbortController().signal,
      )
    ).supported,
    false,
  );
  judge.assess = async () => [
    { claim: answer, evidence: "This evidence does not occur in the passage." },
  ];
  assert.equal(
    (
      await new GroundedClaimVerifier(judge).verify(
        answer,
        sources,
        new AbortController().signal,
      )
    ).supported,
    false,
  );
  judge.assess = async () => [
    {
      claim: "Records must be retained for 30 days.",
      evidence: "Records must be retained for 30 days.",
    },
  ];
  assert.equal(
    (
      await new GroundedClaimVerifier(judge).verify(
        "Records must be retained for 30 days.",
        sources,
        new AbortController().signal,
      )
    ).supported,
    true,
  );
});
test("bounded bilingual rewrites retain negations, dates and entity names", () => {
  assert.equal(rewriteRetrievalQuery("What is RAG?"), "RAG");
  assert.equal(rewriteRetrievalQuery("O que é RAG?"), "RAG");
  assert.equal(
    rewriteRetrievalQuery(
      "Please explain why Acme must not retain records after 2026?",
    ),
    "why Acme must not retain records after 2026",
  );
  assert.ok(rewriteRetrievalQuery("x".repeat(2000)).length <= 1000);
});
