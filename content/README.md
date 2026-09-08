# Content

This directory holds Archive source material for **development and testing**.

Live content is maintained in a **separate git repository** and compiled by the
backend at runtime, as defined by
[Authoring tooling](../specs/authoring-tooling.spec.md#content-sources) and
[Content sources and publishing workflows](../specs/usage-and-deployment.spec.md#content-sources-and-publishing-workflows).
This directory is a stand-in for that external repository, so the backend can
be run locally without cloning the real content repo.

## Using it

The backend reads from `CONTENT_SOURCE_PATH`. From the backend package
(`apps/backend`), the dev `.env` points at this directory:

```
CONTENT_SOURCE_PATH=../../content
```

On startup the backend compiles the source here into its in-memory store, and
recompiles on `POST /webhook/compile`.

## Format

Source files are semantically enriched Markdown, as defined by
[Authoring tooling](../specs/authoring-tooling.spec.md):

- one document per `.md` file;
- each heading begins a content block; the first heading is the document's root;
- optional YAML frontmatter carries metadata and relationship declarations;
- relationships use the controlled vocabulary (references, describes,
  contrasts-with, derived-from, related-to);
- `from` references a heading path within this document (e.g. `"1.2"`); `to` is
  a full block ID (`<document-id>:<heading-path>`, e.g. `ceph-biology/anatomy:1`).

Document IDs are derived from the file path (extension stripped); block IDs
from the document ID plus heading position. See
[ID derivation](../specs/authoring-tooling.spec.md#id-derivation).

The seed documents here form a tiny interlinked Archive exercising the format.

## Configuration

`darkling.json` in this directory is the **content-specific configuration file**,
versioned with the source Markdown, as defined by
[Content-specific configuration](../specs/usage-and-deployment.spec.md#content-specific-configuration).
It holds worldbuilding config that travels with the content:

- the relationship-type vocabulary (controlled by
  [Authoring tooling](../specs/authoring-tooling.spec.md#controlled-vocabularies));
- content-specific retrieval policy — the filterable properties and their
  match semantics (controlled by
  [Authoring tooling](../specs/authoring-tooling.spec.md#filterable-properties)).

**Operational configuration** (the content repo URL, LLM API key and provider,
persistent store connection, spend caps, rate limits, persistence policies,
pre-shared secrets) is **not** kept here — it lives in the deployment
environment / secret store, as defined by
[Operational configuration](../specs/usage-and-deployment.spec.md#operational-configuration-in-the-deployment-environment).
Keeping worldbuilding config with worldbuilding and operational config out of
the content repo is the split the specs establish.

The file format (JSON) is an implementation choice; the specs leave the format
of the content-specific config file open. The values here restate the defaults
the code already uses (`RELATIONSHIP_TYPES` and `DEFAULT_PROPERTY_SCHEMA` in
`@darkling/knowledge-base`), so this stand-in is a no-op until extended.
