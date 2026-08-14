# Darkling

Darkling is an engine for interactive fiction, presented as an archive for the User to explore in the company of the Guide.

The Archive contains a large body of interconnected fictional material: histories, cultures, technologies, people and places. The User explores this material directly, but is accompanied by the Guide, an opinionated and sometimes unreliable character with its own perspective on the Archive.

The interface is built around a three-way interaction between the User, the Archive, and the Guide. Both the User and the Guide can manipulate the Archive's interface, allowing the Guide to draw attention to material, navigate between documents and respond to the User's activity rather than simply answering questions.

This creates an unusual design problem: the Guide needs to appear responsive and autonomous while remaining an LLM operating within a structured interactive system. The architecture therefore treats the Guide as an actor with constrained capabilities rather than as a conventional chatbot.

## Architecture

The system is built around several interacting subsystems:

 * Service bus — lightweight services run across Web Workers and are activated on demand.
 * Event system — the interface produces high-level semantic events such as document_opened, rather than exposing low-level UI events to the Guide. Events are microbatched and flushed using a hybrid immediate/probabilistic policy, reducing LLM calls and token usage while allowing the Guide to respond with apparently spontaneous timing.
 * Constrained agent — the Guide interacts with the Archive exclusively through tool calls. Interleaved reasoning is supported, while an explicit turn budget bounds the cost and duration of individual interactions.
 * Semantic content system — Archive material is authored as semantically enriched Markdown and compiled into addressable content blocks with structural metadata and typed relationships. Custom remark plugins and a VS Code extension support authoring.
 * Content-first retrieval — the Guide can retrieve blocks directly by ID, search by selected properties such as title, or search their textual content. Relationships between blocks provide an additional navigation mechanism.

The current retrieval model evolved from an OWL2-RL knowledge graph and a more conventional KAG approach. While formal entailment provides useful guarantees, those guarantees do not map particularly well onto a general-purpose LLM—especially one deliberately designed to be an imperfect narrator. The current design instead retains explicit semantic relationships while presenting the model primarily with textual content and navigable structure.

The result is a system somewhere between RAG and KAG: the Archive provides structured knowledge, while the Guide navigates and interprets that knowledge rather than acting as a database query engine.

## The Guide

The Guide began as a joke: a far-future version of Clippy appearing beside the Archive with observations such as “It looks like you're interested in Ceph biology. Would you like help with that?”

It turned out to be rather more useful than expected.

The Guide has a strong authored personality and access to private, topic-linked notes and recollections. These are represented as annotations on Archive content rather than mutable model memory, allowing the Guide to have opinions and affective cues without making its subjective perspective part of the Archive's underlying record.

What began as a narrative conceit has consequently become one of the central architectural and experiential features of the project.
