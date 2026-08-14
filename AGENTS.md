# Purpose

This project is _darkling_.

Darkling is a platform for interactive fiction, in the form of a knowledge base with an LLM powered guide. Further details about the project goals can be found in [README.md](./README.md).

Darkling is developed using a spec-anchored workflow.

# Specifications

Specifications are the logical units of development. Specifications may represent atomic features, cross-cutting concerns, or subpackages.

The applicable specifications are the source of truth. Code, tests, examples and generated artefacts must conform to them. When implementation and specification disagree, do not silently choose an implementation; resolve the discrepancy through the specification workflow.

Specifications must not be created or modified unless explicitly instructed to do so.

All specifications are files named `*.spec.md`. Specifications are generally colocated with the components they govern, while project-level and cross-cutting specifications may be found under `/specs`.

A specification governs the scope defined by its location and content; specifications may reference or refine other specifications.

## Format

Specifications are Markdown documents. Every specification must begin with a concise _Purpose and scope_ section defining the concern governed by the specification and, where useful, concerns explicitly outside its scope.

Use ordinary Markdown prose for requirements and explanation. Use fenced blocks containing appropriate formal or structured notation where this improves precision or makes requirements easier to verify. Supported notations include Gherkin for behavioural scenarios, Mermaid for diagrams, JSON Schema for data contracts, and Zod v4 for TypeScript-facing schemas.

Specifications should distinguish normative requirements from examples, rationale, and explanatory material. Normative requirements must use unambiguous language. When necessary to distinguish requirements from explanation or examples, use explicit normative terms such as must, must not, may, and should. Examples and rationale are non-normative unless explicitly stated otherwise.

Specifications should describe required behaviour and observable properties rather than implementation details, except where an implementation constraint is itself normative.

Specifications should link directly to other specifications whenever they rely upon, constrain, extend, or otherwise depend upon behaviour defined by them. References to specifications should use repository-relative Markdown links rather than merely naming the specification.

The structure of the remainder of a specification is determined by its subject matter; no particular section structure is required beyond _Purpose and scope_. Sections should have clear and self-explanatory titles.

# Journals

Alongside each `*.spec.md` file, maintain a corresponding `*.journal.md` file. Journals are non-normative records of the development of their associated specification.

Journals serve two purposes: they preserve the reasoning behind implementation decisions, thereby stabilising the relationship between a specification and its implementation; and they record gaps, ambiguities, uncertainties and conflicts that may inform future specification development.

Record consequential implementation decisions and their reasoning where possible, together with areas where the specification is incomplete or ambiguous, conflicts between specifications, and a history of changes made to the specification.

Journals are non-normative. When implementing or evaluating behaviour, the specification always takes precedence over the journal.

# Development workflow

Before making changes, identify and read the applicable specifications and their associated journals.

For implementation work:

1. Identify the specification or specifications governing the requested change.
2. Determine whether the requested behaviour is established by those specifications.
3. Make ordinary implementation decisions independently, provided they do not conflict with the applicable specifications.
4. Record significant implementation decisions and their reasoning in the relevant journal.
5. Where a major gap, ambiguity, or contradiction in the specifications affects the requested work, consult the user rather than resolving the specification yourself.
6. Record the gap, ambiguity, or contradiction and any resulting decision in the relevant journal.
7. Implement the smallest change that satisfies the applicable specifications.
8. Add or update tests as necessary to demonstrate conformance.
9. Verify the resulting implementation and tests against the applicable specifications.

Specifications must not be created or modified as part of this workflow.

You may suggest following the specification workflow when a proposed change would benefit from clarification or formalisation. If the existing specifications do not provide sufficient authority to proceed, you must suggest following the specification workflow.

# Specification workflow

The specification workflow is used to establish or modify normative requirements. It takes the relevant journals, existing specifications, and, where applicable, the user's proposal as its starting point, and proceeds through dialogue with the user to establish the specification.

Specifications must not be created or modified outside this workflow. This workflow must be explicitly initiated by the user.

1. Establish context. Read the relevant journals, existing specification where applicable, and the user's proposal where one exists.
2. Identify applicable specifications. Identify all other specifications that may constrain, depend upon, overlap with, or otherwise be affected by the proposed change.
3. Develop the specification. Through dialogue with the user, establish the requirements of the specification. You may propose resolutions to gaps and ambiguities based on the available specifications and journals, but the user is the ultimate decision maker regarding normative requirements.
4. Review for consistency. Review the resulting specification against all identified applicable specifications. Identify and resolve contradictions through further dialogue with the user.
5. Record and establish. Update or create the specification and its journal once the requirements have been established.

# Workspace level requirements and stack

The package manager is pnpm 11. Build orchestration uses Turbo. Code quality is maintained using ESLint and Prettier, and testing uses Vitest. The development environment is Node.js Krypton LTS (`^24.19.0`). The primary development language is TypeScript.

# Commits and Changes

Commits should represent coherent, independently understandable changes. Commit messages should briefly describe the change in the imperative mood and identify its principal scope where useful.

When preparing a commit:

- don't rewrite unrelated files
- don't reformat whole packages unnecessarily
- don't commit generated artefacts unless they're tracked
- keep changes cohesive
- don't “fix” unrelated issues encountered along the way
- preserve existing history
- don't squash/rebase unless asked

Before committing, always lint and format changed code.

You should follow the [Scoped Commits](https://scopedcommits.com) format for commit messages. When a commit changes implementation behaviour, its message should describe the behavioural change rather than implementation details.

# Behaviour

Prefer the smallest change that restores or establishes conformance.

Do not weaken tests merely to make an implementation pass.

Do not invent behaviour that is not established by an applicable specification.

Do not make unrelated improvements while implementing a requested change.

Generated artefacts must not be edited directly. Modify their source and regenerate them using the repository's prescribed tooling.
