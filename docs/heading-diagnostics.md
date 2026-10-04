# Additive heading diagnostics

Existing schema syntax, matcher acceptance, public validation entry points and
error codes are unchanged. Diagnostics never edit the document or treat an
invalid heading as valid. The existing `expected` field remains available.

Unexpected-heading errors additionally expose optional `schema_line` and `hints`
fields, plus the offending heading in `actual`. Document `line`, `column` and
`path` retain their existing meanings. Consumers must tolerate additional fields.

A heading matching an earlier sibling rule is explained as out of order.
Common English month abbreviations in a terminal parenthesised date field get
a specific hint only when expanding them makes the *whole heading* match exactly
one eligible regex rule in the current section. Thus a schema accepting `Sept`
continues accepting it, a schema using another date grammar does not receive an
unsupported suggestion, and an unrelated field error makes the hint abstain.
No general claim is made about why an arbitrary regex fails.

Validation continues collecting errors across siblings and matched subtrees:
it does not stop at the first error. Several messages can describe one underlying
problem (for example an unexpected heading and a missing required heading).
Diagnostic hints attach to the existing error rather than adding duplicate errors.
As before, an unmatched parent can prevent descent into its children; this release
does not speculate about the intended parent or change validation semantics.

Python and JavaScript use the same `tests/diagnostic-fixtures.json`. Tests cover
multiple failures, valid headings, wrong order, schema-permitted abbreviations,
month punctuation, unrelated field failures and arbitrary non-date schemas.

Respond's error formatter includes schema locations, expected values and actual
headings. Its default ten-error display cap does not truncate the structured
error list; the message explicitly reports how many further errors remain.
This is a diagnostic-only change, not month-formatting recovery or an extra LLM
repair call.
