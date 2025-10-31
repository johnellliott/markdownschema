Here’s a complete `README.md` you can drop at the repo root.

---

# MarkdownSchema

Validate Markdown documents against a lightweight, heading-driven schema that you define in Markdown. No build step, no dependencies. Works in the browser (ESM) or Node (ESM).

## Why

* Keep content authors in Markdown while enforcing structure and simple content rules.
* Schemas live next to docs and are themselves Markdown.
* Helpful, human-friendly validation messages (line numbers, path, and specific hints for common date-range mistakes).

## Features

* Schema-as-Markdown: headings define the expected document outline.
* Reusable regex templates via a fenced ```defs block and `{{TEMPLATE}}` expansion.
* Exact, regex, or wildcard header matching.
* Simple content rules per section: `paragraphs`, `list`, `table`, `code(lang=/.../)`, `regex`.
* Unicode-safe regex (auto-adds `u` flag). Trailing HTML comments on headings are ignored for matching but preserved in messages.
* Clear errors with `path`, `line`, `expected`, `actual`, and targeted token hints (e.g., “Found `to` in date range”).
* Tiny, dependency-free ES module.

---

## Quick start

### 1) Clone and serve locally

```bash
git clone https://github.com/johnellliott/markdownschema.git
cd markdownschema
python3 -m http.server 8282
```

Open: `http://localhost:8282/examples/cv-demo.html`

The demo compiles a schema (`examples/cv.schema.md`) and validates a valid and an invalid CV Markdown file, then prints detailed results.

### 2) Use in the browser (ESM)

```html
<script type="module">
  import { compileSchema, validateMarkdown } from './src/markdownschema-validator.js';

  const schemaMd = await (await fetch('./examples/cv.schema.md')).text();
  const compiled = compileSchema(schemaMd);

  const docMd = await (await fetch('./examples/cv.valid.md')).text();
  const result = validateMarkdown(docMd, compiled);

  console.log(result.ok ? 'OK' : 'Errors', result.errors);
</script>
```

### 3) Use in Node (ESM)

```js
// node --experimental-modules if on older Node
import fs from 'node:fs/promises';
import { compileSchema, validateMarkdown } from './src/markdownschema-validator.js';

const schemaMd = await fs.readFile('./examples/cv.schema.md', 'utf8');
const compiled = compileSchema(schemaMd);

const docMd = await fs.readFile('./examples/cv.invalid.md', 'utf8');
const { ok, errors } = validateMarkdown(docMd, compiled);

if (!ok) {
  for (const e of errors) {
    console.error(`[${e.code}] ${e.message} @ ${e.path}${e.line ? ` (line ${e.line})` : ''}`);
  }
  process.exitCode = 1;
}
```

---

## Core concepts

### Schema-as-Markdown

Write a schema as a Markdown outline. Each schema heading defines a rule that corresponding document headings must match. Three matcher styles:

* **Exact text**: wrap in quotes
  `## "Overview"`
* **Regex**: wrap in slashes
  `### /^Role at Org \(\d{4} - \d{4}\)$/`
* **Wildcard**: a literal `*` matches any heading text

You may append a rule object at the end of the line:

```md
## "Skills" { content: list(>=1) }
```

### `defs` block and `{{TEMPLATE}}` expansion

Define reusable regex fragments once, then reference them:

````md
```defs
MONTH=/January|February|March|April|May|June|July|August|September|October|November|December/
YEAR=/\d{4}/
EN_DASH=/–/     # use the actual en dash character here
DATE_RANGE=/(?:{{MONTH}}\s+{{YEAR}}\s*(?:-|{{EN_DASH}})\s*(?:Present|{{MONTH}}\s+{{YEAR}})|{{YEAR}}\s*(?:-|{{EN_DASH}})\s*{{YEAR}})/
ORG=/[A-Z][A-Za-z0-9 .&-]+/
ROLE=/[A-Za-z][A-Za-z0-9 .&/-]+/
DEGREE=/[A-Za-z0-9 .,&-]+/
UNIVERSITY=/[A-Za-z][A-Za-z0-9 .,&-]+/
```

````

Use them inside regex matchers:

```md
## "Experience"
### /^{{ROLE}} at {{ORG}} \(\s*{{DATE_RANGE}}\s*\)$/i { minOccurs: 1, content: list(>=1) }
````

> Tips
>
> * The parser ignores headings that appear inside fenced code blocks.
> * The validator adds the `u` flag to all regex so en dash and other Unicode work as expected.
> * If you see “Unresolved template(s) in regex”, your ```defs fence is likely not closed or the name is misspelled.

### Content rules

Attach a `content:` rule to a schema heading:

* `any` - do not check the body
* `paragraphs(1..3)` - the section body must contain 1 to 3 paragraphs
* `list(>=n)` - at least `n` list items (`-`, `*`, `+`, or numbered)
* `table(>=rows,>=cols)` - at least `rows` data rows and `cols` columns
* `code(lang=/js|ts/)` - at least one fenced code block whose language matches the regex
* `regex(/.../i)` - the raw section body must match this regex

Occurrence rules:

* `minOccurs: 1` - at least one matching child heading is required (default is 1)
* `maxOccurs: 2` - no more than two matches
* A schema heading is considered optional if you add a trailing `?` before the rule block:
  `### /^Foo$/ ? { ... }`

---

## Example: CV schema and docs

**Schema** (excerpt)

```md
# "John Smith"

## "Overview" { content: paragraphs(1..3) }

## "Skills" { content: list(>=1) }

## "Experience"
### /^{{ROLE}} at {{ORG}} \(\s*{{DATE_RANGE}}\s*\)$/i { minOccurs: 1, content: list(>=1) }

## "Education"
### /^{{DEGREE}}, {{UNIVERSITY}} \(\s*{{DATE_RANGE}}\s*\)$/ { minOccurs: 1 }
### *? { content: any }   <!-- optional extra subsections allowed -->

## "Certifications & Licenses" { content: list(>=1) }
```

**Valid** (excerpt)

```md
## Experience
### Senior PM at XYZ Corp (March 2019 – Present)
- Led the rollout of a $5M SaaS transformation...
```

**Invalid** (highlights)

```md
## Experience
### Senior PM at XYZ Corp (March 2019 to Present)   <!-- invalid: "to" -->
No bullets here, just text.

## Education
### MBA, University of Sydney (2012/2014)           <!-- invalid: slash -->
```

**Sample errors**

* `unexpected-heading` - the heading text does not match the regex for this level
* `date-range-token` - precise token hint, e.g. `Found "to" in date range; use "-" or "–" instead.`
* `list-items` - content rule failure, e.g. needs `>= 1` list item under an Experience entry
* `missing-heading` / `min-occurs` - schema demanded at least one Education item in the required format

---

## API

```ts
compileSchema(schemaMarkdown: string): CompiledSchema
validateMarkdown(docMarkdown: string, compiled: CompiledSchema): { ok: boolean; errors: ErrorObj[] }
```

`ErrorObj` shape:

```ts
type ErrorObj = {
  code: string;                 // e.g. 'unexpected-heading', 'list-items', ...
  message: string;              // human-readable
  path?: string;                // heading path using ' > ' separator
  line?: number;
  column?: number;
  expected?: unknown;           // schema expectation
  actual?: unknown;             // what was found
};
```

---

## Project structure

```
.
├─ src/
│  └─ markdownschema-validator.js   # the library (dependency-free, ESM)
├─ examples/
│  ├─ cv-demo.html                  # browser demo page
│  ├─ cv.schema.md                  # example schema
│  ├─ cv.valid.md                   # valid doc
│  └─ cv.invalid.md                 # invalid doc
└─ README.md
```

---

## Development

Serve the examples with any static server:

```bash
python3 -m http.server 8282
# open http://localhost:8282/examples/cv-demo.html
```

For Node testing, run your own script as shown above.

---

## Troubleshooting

* **Unresolved template(s) in regex**
  Your ```defs block is missing a closing fence, or a `{{NAME}}` has no matching definition. Close the fence and check template names.

* **Regex not matching en dash**
  The validator adds `u` automatically, but your schema must include the actual en dash character in `EN_DASH=/–/`. Do not paste a hyphen-minus.

* **Headings inside code blocks are ignored**
  The parser skips headings that appear between fenced code fences. Make sure your schema headings are not fenced accidentally.

* **Messages show truncated expected regex**
  Long regex are ellipsized for readability. The full pattern is still on the `expected` field of the error object.

---

## Roadmap

* Optional `label:` rule to show a friendly name for expected regex in error messages.
* `maxOccurs` support examples and demo.
* Optional JSON Schema export of the compiled structure.
* CLI wrapper for CI use.

---

## License

MIT. Feel free to use in commercial and open projects. Add your name and year as needed.

---

## Acknowledgements

Thanks to everyone who tests with real-world Markdown and sends back actionable error scenarios. The CV example is intentionally strict to demonstrate helpful messages for date-range tokens and list requirements.

