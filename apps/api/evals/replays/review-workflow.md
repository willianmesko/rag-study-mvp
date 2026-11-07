# Reviewing a reconstructed production replay

Use the bundled synthetic suite for public examples and live reranker tests.
The review workflow covers an authorized team member recreating a production
failure as a minimal fixture in a private local directory.

1. Confirm permission to use the scenario. Rephrase the question and include
   only the evidence needed to reproduce the behavior. Use neutral case and
   passage IDs. Remove identities, secrets, unique details, and combinations
   of attributes that could identify the person or organization. Review the
   expected relevance labels. [NIST de-identification guidance](https://csrc.nist.gov/pubs/sp/800/188/final)
2. Save the fixture in the replay suite format and mark its reconstructed
   cases `reviewed-anonymized`. Copy `review-attestation.template.json` into
   the same private directory. Record a neutral review code and date, and
   mark each check after reviewing it.
3. Record the review receipt and run the benchmark locally.

   ```bash
   npm run eval:approve-replay -- --suite /private/replay.json --attestation /private/attestation.json --output /private/approval.json
   npm run eval:replay -- --suite /private/replay.json --approval /private/approval.json --report /private/result.json
   ```

The receipt binds the attestation to the validated suite digest. Review again
when the fixture changes. The scanner rejects common direct identifiers, and
the human review covers re-identification risks that text patterns miss.
Keep the fixture, receipt, and report in approved private storage. Reviewed
production replays use the offline ranking harness.
