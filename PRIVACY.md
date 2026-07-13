# Privacy policy

Effective date: 2026-07-13

This policy describes the reference KeepCryptoClean task in this repository.
An operator who deploys it must publish its own identity, contact method,
jurisdiction-specific disclosures, approved X API use case, and any changes to
this data flow before collecting data.

## Data processed

The task uses the official X API to read public data for one configured public
account. Full API responses are processed transiently for validation. Each
valid round proof contains exactly one live Post existence/author attestation
and is designed to place only these values in public:

- X Post IDs;
- X User IDs; and
- non-X Koii task metadata needed for consensus, such as schema version, round,
  submitter public key, and audit/distribution references.

The public proof must not contain post text, text-derived hashes, source
timestamps, usernames, display names, profile fields, media, location, DMs,
protected content, cookies, passwords, API tokens, request headers, or browser
profiles. Operational logs should contain event types, counts, durations, and
sanitized error categories—not raw X responses or credentials.

## Purpose and legal/policy basis

The IDs let independent Koii nodes check, at audit time, that the selected Post
still exists and is authored by the configured target. They do not prove that
the producer performed a timeline request or discovered a new Post. They are
not used for advertising, profiling, sale, or training a content model.

Use of the X API is subject to the
[X Developer Policy](https://docs.x.com/developer-terms/policy). Before running
the task, the operator must obtain written X approval explicitly covering this
rewarded, distributed Koii use case, its public recipients, and immutable IPFS
publication of the selected Post/User IDs. That approval must explicitly
resolve downstream-recipient terms and deletion/modification duties because a
public replicated IPFS proof cannot guarantee deletion. The operator must use
least-privilege API access and record applicable redistribution limits; the code
alone does not establish compliance.

The repeated single-account observation may also fall within X's restrictions
on investigating or tracking users or their content. Every Koii node currently
needs its own X authentication, while X also restricts shared credentials and
requiring service users to register overlapping applications. Deployment is
therefore prohibited unless X approves this exact target, purpose,
distributed-authentication model, and immutable publication in writing, or the
architecture is redesigned and separately approved.

## Public sharing and immutability

Proof envelopes are uploaded to IPFS and their CIDs/submission records are
shared through Koii. Both systems are public and replicated. Anyone may be able
to retrieve, copy, and independently retain a proof. The operator cannot
promise deletion of an ID after it has been published to immutable or
content-addressed infrastructure.

For that reason, only policy-permitted IDs and necessary task metadata may be
published. If X approval, policy, a valid rights request, or applicable law
requires a different treatment, the operator must halt new collection and
submission first, stop pinning/serving data it controls where appropriate, and
document the response. It must not claim that stopping a gateway deletes every
replica.

## Retention

Full X API responses are discarded after transient validation and must not be
written to IPFS or long-lived local storage. The reference adapter keeps at
most 512 rounds of local ID-only observation/proof records; operators may set a
shorter period and must publish it. Sanitized logs should be retained only as
long as necessary for operations, replay investigation, security, and legal
obligations. Public IPFS/Koii records may remain available indefinitely for the
reasons above.

## Exclusions

The reference production profile does not request or intentionally process DMs,
protected posts, private profiles, browser cookies, X passwords, contact lists,
or precise location. Do not extend the task to those categories without a new
design, policy approval, privacy review, and explicit user disclosures.

## Requests and contact

For the reference repository, use a
[private GitHub Security Advisory](https://github.com/MadanChaollaPark/KeepCryptoClean/security/advisories/new)
for a sensitive privacy/security report. A non-sensitive policy question may be
opened in the repository issue tracker. Do not include credentials or private
personal data in either channel.

A downstream operator is the party responsible for its deployment and must
provide a direct privacy contact and request process. The repository maintainer
cannot delete IPFS/Koii copies created by an unaffiliated operator.
