# Parser-bound conversation semantic certification v1

Status: deterministic engineering gate.

The first conversation certification bridge could compare a source JSG snapshot against a recovered candidate snapshot supplied by the caller. That is useful, but it leaves one provenance gap: the recovered graph is not mechanically tied to the exact surface string being admitted to the ranking lattice.

This wave closes that gap with `certifyConversationSurfaceDraftFromParser(...)`.

## Required sequence

```text
exact candidate surface
        ↓
declared parser id + version
        ↓
surface → recovered JSG
        ↓
critical semantic-preservation verifier
        ↓
verified conversation draft
```

The parser receives the exact candidate `surface` and `language` carried by the draft. Parse failure, parser exceptions, or semantic drift all fail closed.

Successful evidence contains:

- semantic-preservation profile identity;
- source JSG digest;
- recovered JSG digest;
- exact surface digest;
- parser id/version evidence;
- optional additional parse-profile evidence.

## Claim boundary

This does not make every conversational surface parseable. Unsupported parser coverage remains an explicit failure/unknown engineering problem. It does prevent a caller from certifying a surface by attaching an unrelated recovered graph without first invoking the declared parser on that exact surface.

Language-pack proposal helpers remain proposal-level APIs. The parser-bound Universal Expression certification path is the preferred gate before candidates enter the bounded Jev ranking lattice.
