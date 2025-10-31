// src/markdownschema-validator.js  (dependency-free, ES module)
//
// Public API:
//   compileSchema(schemaMarkdown: string) -> compiledSchema
//   validateMarkdown(docMarkdown: string, compiledSchema) -> { ok: boolean, errors: Array<ErrorObj> }
// Back-compat aliases exported at bottom: compileSchemaMD()

// ---------------------------------------------------------------------------
// Compile schema
// ---------------------------------------------------------------------------
function compileSchema(schemaMd) {
  const defs = parseDefs(schemaMd);           // ← get defs first
  const schemaHeadings = parseHeadings(schemaMd);

  const nodes = schemaHeadings.map(h => {
    const { header, ruleText } = splitRule(h.text);
    const optional = /\?\s*(?:{|\s*$)/.test(header);
    const core = header.replace(/\?\s*$/, '').trim();
    const matcher = makeMatcher(core, defs);  // ← pass defs here
    const rules = parseRules(ruleText);
    return { depth: h.level, matcher, headerRaw: core, optional, rules, children: [], pos: h.pos };
  });

  const root = { depth: 0, children: [], optional: true, matcher: { type: 'root' }, rules: {}, defs }; // ← expose defs
  const stack = [root];
  for (const n of nodes) {
    while (stack.length && stack[stack.length - 1].depth >= n.depth) stack.pop();
    stack[stack.length - 1].children.push(n);
    stack.push(n);
  }

  // Propagate mandatory if any mandatory child exists
  (function propagate(node) {
    node.children.forEach(propagate);
    if (node.children.some(c => !c.optional)) node.optional = false;
  })(root);

  return root;
}


// ---------------------------------------------------------------------------
// Validate document
// ---------------------------------------------------------------------------
function validateMarkdown(docMd, compiledSchema) {
  const docHeadings = parseHeadings(docMd);
  const docTree = buildDocTree(docHeadings);
  const errors = [];
  compareSiblings(compiledSchema.children, docTree.children, 1, docMd, errors, []);
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// $defs parsing
// Define reusable regex vars in the schema using a fenced block:
//
// ```defs
// DATE_RANGE=/(?:[A-Za-z]+ \d{4} – (?:Present|[A-Za-z]+ \d{4})|\d{4}\s*-\s*\d{4})/
// ORG=/[A-Z][A-Za-z0-9 .&-]+/
// ```
//
// Then reference inside regex matchers with {{NAME}}:
// ### /^(?<role>.+) at (?<org>{{ORG}}) \(({{DATE_RANGE}})\)$/i
// ---------------------------------------------------------------------------
function parseDefs(md) {
  const lines = md.split(/\r?\n/);
  const defs = {};
  let inDefs = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Open fence: ```defs (allow trailing spaces or language junk)
    if (!inDefs) {
      const m = line.match(/^(?: {0,3})```defs(?:\s+.*)?\s*$/);
      if (m) { inDefs = true; continue; }
      continue;
    }

    // Close fence: ``` (exactly three or more backticks, optional spaces)
    if (/^(?: {0,3})```+\s*$/.test(line)) {
      inDefs = false;
      continue;
    }

    // Inside defs: NAME=/.../flags, allow comments and blanks
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const name = trimmed.slice(0, eq).trim();
    const rhs  = trimmed.slice(eq + 1).trim();
    const rm   = rhs.match(/^\/([\s\S]+)\/([a-z]*)$/);
    if (name && rm) {
      defs[name] = { body: rm[1], flags: rm[2] || '' };
    }
  }

  return defs;
}

// Expands {{NAME}} with the corresponding defs entry, wrapping it in a non-capturing group.
// Runs multiple passes so nested templates are supported.
// Leaves unknown templates in place so the caller can detect and error.
function expandRegexTemplates(src, defs) {
  if (!defs) return src;
  let prev;
  // Limit to a few iterations to avoid accidental infinite loops
  for (let i = 0; i < 5; i++) {
    prev = src;
    src = src.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (m, name) => {
      const d = defs[name];
      if (!d || !d.body) return m;           // keep unresolved for error report
      // Ignore per-def flags here; rely on the outer regex flags
      return `(?:${d.body})`;
    });
    if (src === prev) break;
  }
  return src;
}


// ---------------------------------------------------------------------------
// Heading parsing (schema & doc)
// ---------------------------------------------------------------------------
function parseHeadings(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let fenced = false;
  let fenceChar = null;   // '`' or '~'
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect fences with optional indent and optional language/comments
    const open = line.match(/^(?: {0,3})([`~]{3,})([^\r\n]*)$/);
    if (open) {
      const seq = open[1];
      const ch  = seq[0];
      if (!fenced) {
        fenced = true;
        fenceChar = ch;
        fenceLen  = seq.length;
        continue; // do not parse this line as heading
      }
    }

    // Detect closing fence (must be same char and >= length, allow trailing spaces)
    const close = fenced && line.match(new RegExp(`^(?: {0,3})[${fenceChar}]{${fenceLen},}\\s*$`));
    if (close) {
      fenced = false;
      fenceChar = null;
      fenceLen = 0;
      continue;
    }

    if (fenced) continue; // ignore headings inside fences

    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      out.push({
        level: m[1].length,
        text: m[2].trim(),
        pos: { line: i + 1, column: 1 }
      });
    }
  }
  return out;
}



function buildDocTree(headings) {
  const root = { depth: 0, children: [] };
  const stack = [root];
  for (const h of headings) {
    const node = {
      depth: h.level,
      text: stripTrailingHtmlComment(h.text), // normalized for matching
      rawText: h.text,                        // original for messages
      pos: h.pos,
      children: []
    };
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Schema parsing helpers
// ---------------------------------------------------------------------------
function splitRule(txt) {
  const m = txt.match(/\{([^}]*)\}(?:\s*<!--[\s\S]*?-->)?\s*$/);
  if (!m) return { header: txt.trim(), ruleText: '' };
  return { header: txt.slice(0, m.index).trim(), ruleText: m[1].trim() };
}

function makeMatcher(core, defs) {
  if (core === '*') return { type: 'wildcard' };

  const q = core.match(/^"([\s\S]+)"$/);
  if (q) return { type: 'exact', value: q[1] };

  const r = core.match(/^\/([\s\S]+)\/([a-z]*)$/);
  if (r) {
    let src = r[1];
    const flags = r[2] || '';

    // Expand {{TEMPLATES}}
    src = expandRegexTemplates(src, defs);

    // If any {{...}} remain, fail fast with a clear schema error
    if (/\{\{[^}]+\}\}/.test(src)) {
      throw new Error(
        `Unresolved template(s) in regex: /${src}/${flags}. ` +
        `Check your \`\`\`defs block and closing fence.`
      );
    }

    // Add 'u' so Unicode (e.g., en dash) works reliably
    const finalFlags = flags.includes('u') ? flags : (flags + 'u');
    return { type: 'regex', pattern: new RegExp(src, finalFlags) };
  }

  // Bare text = exact
  return { type: 'exact', value: core };
}

function parseRules(ruleText) {
  if (!ruleText) return {};
  const out = {};
  for (const part of splitTopLevel(ruleText, ',')) {
    const [k, vRaw] = part.split(':').map(s => s.trim());
    if (!k) continue;
    out[k] = parseRuleValue(vRaw);
  }
  return out;
}

function splitTopLevel(s, sep) {
  let cur = '', depth = 0, out = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseRuleValue(v) {
  if (v === undefined || v === '') return true;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (v === 'any') return { kind: 'any' };

  // regex wrapper: regex(/.../flags)
  let m = v.match(/^regex\(\s*(\/.*\/[a-z]*)\s*\)$/);
  if (m) {
    const r = m[1].match(/^\/([\s\S]+)\/([a-z]*)$/);
    return { kind: 'regex', re: new RegExp(r[1], r[2]) };
  }
  // paragraphs(1..3)
  m = v.match(/^paragraphs\((\d+)\.\.(\d+)\)$/);
  if (m) return { kind: 'paragraphs', min: +m[1], max: +m[2] };
  // list(>=n)
  m = v.match(/^list\(\s*>=\s*(\d+)\s*\)$/);
  if (m) return { kind: 'list', minItems: +m[1] };
  // table(>=r,>=c)
  m = v.match(/^table\(\s*>=\s*(\d+)\s*,\s*>=\s*(\d+)\s*\)$/);
  if (m) return { kind: 'table', minRows: +m[1], minCols: +m[2] };
  // code(lang=/.../)
  m = v.match(/^code\(\s*lang\s*=\s*(\/.*\/[a-z]*)\s*\)$/);
  if (m) {
    const r = m[1].match(/^\/([\s\S]+)\/([a-z]*)$/);
    return { kind: 'code', lang: new RegExp(r[1], r[2]) };
  }
  return v; // fallback raw
}

// ---------------------------------------------------------------------------
// Validation core
// ---------------------------------------------------------------------------
function compareSiblings(schemaSibs, docSibs, level, docMd, errors, pathStack) {
  const wildcard = schemaSibs.find(s => s.matcher.type === 'wildcard');
  const seq = schemaSibs.filter(s => s !== wildcard);

  let i = 0; // ordered matching across siblings
  const matched = seq.map(() => []);
  const extras = [];

  for (const d of docSibs) {
    const j = findNextAccepting(seq, d.text, i);
    if (j >= i && j !== -1) {
      matched[j].push(d);
      i = j; // allow repeats in this slot via min/maxOccurs
    } else if (wildcard) {
      extras.push(d);
    } else {
      pushError(errors, {
        code: 'unexpected-heading',
        message: `Unexpected heading "${headingLabel(d)}" at level ${level}`,
        path: pathStack.concat(headingLabel(d)).join(' > '),
        line: d.pos?.line, column: d.pos?.column,
        expected: seq.map(s => matchDesc(s.matcher))
      });

      const hint = diagnoseDateRangeToken(d.rawText || d.text);
      if (hint) {
        pushError(errors, {
          code: 'date-range-token',
          message: hint,
          path: pathStack.concat(d.rawText || d.text).join(' > '),
          line: d.pos?.line
        });
      }

      // Best-effort: also validate content against plausible schema slots
      // Try current expected slot (i) first, then previous one (i-1) if exists.
      const candidates = [];
      if (seq[i]) candidates.push(seq[i]);
      if (i > 0 && seq[i - 1]) candidates.push(seq[i - 1]);

      // De-dup and run content validators to surface issues like missing lists/tables
      const seen = new Set();
      for (const s of candidates) {
        if (!s || seen.has(s)) continue;
        seen.add(s);
        try {
          validateContentSlice(s, d, docMd, errors, pathStack.concat(headingLabel(d)));
        } catch { /* ignore */ }
      }
    }
  }

  // Missing / min / max occurrences
  for (let k = 0; k < seq.length; k++) {
    const s = seq[k];
    const occ = matched[k].length;
    const minO = s.rules.minOccurs ?? 1;
    const maxO = s.rules.maxOccurs ?? Infinity;

    if (!s.optional && occ === 0) {
      pushError(errors, {
        code: 'missing-heading',
        message: `Missing mandatory heading ${matchDesc(s.matcher)} at level ${level}`,
        path: pathStack.join(' > ') || '(root)',
        expected: matchDesc(s.matcher)
      });
    }
    if (occ < minO) {
      pushError(errors, {
        code: 'min-occurs',
        message: `Expected at least ${minO} occurrence(s) of ${matchDesc(s.matcher)} at level ${level}`,
        path: pathStack.join(' > ') || '(root)',
        expected: { minOccurs: minO }, actual: { occurrences: occ }
      });
    }

    // If we didn’t find any matches and this is a regex header, try to give a token-level hint
    if (occ === 0) {
      // docSibs here are the actual children at this level
      maybeHintOnNearMissChildren(s, docSibs, errors, pathStack);
    }

    if (occ > maxO) {
      const node = matched[k][maxO] || matched[k][matched[k].length - 1];
      pushError(errors, {
        code: 'max-occurs',
        message: `Expected at most ${maxO} occurrence(s) of ${matchDesc(s.matcher)} at level ${level}`,
        path: pathStack.concat(node?.text || '').join(' > '),
        line: node?.pos?.line, column: node?.pos?.column,
        expected: { maxOccurs: maxO }, actual: { occurrences: occ }
      });
    }
  }

  // Validate content + recurse
  for (let k = 0; k < seq.length; k++) {
    const s = seq[k];
    for (const d of matched[k]) {

      validateContentSlice(s, d, docMd, errors, pathStack.concat(headingLabel(d)));
      compareSiblings(s.children, d.children, level + 1, docMd, errors, pathStack.concat(headingLabel(d)));
    }
  }

  // Wildcard children
  if (wildcard) {
    for (const d of extras) {
      validateContentSlice(wildcard, d, docMd, errors, pathStack.concat(headingLabel(d)));
      compareSiblings(wildcard.children, d.children, level + 1, docMd, errors, pathStack.concat(headingLabel(d)));
    }
  }
}

function findNextAccepting(schemaSeq, text, start) {
  for (let j = start; j < schemaSeq.length; j++) {
    if (matchHeader(schemaSeq[j].matcher, text)) return j;
  }
  return -1;
}

function matchHeader(m, text) {
  if (m.type === 'wildcard') return true;
  if (m.type === 'exact') return text === m.value;
  if (m.type === 'regex') return m.pattern.test(text);
  return false;
}

function matchDesc(m) {
  if (m.type === 'wildcard') return '*';
  if (m.type === 'exact') return `"${m.value}"`;
  if (m.type === 'regex') {
    const s = m.pattern.toString();
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  }
  return '(unknown)';
}

function diagnoseDateRangeToken(s) {
  // flags the two most common mistakes we care about
  if (/\(\s*\d{4}\s*\/\s*\d{4}\s*\)\s*$/.test(s)) return 'Found "/" between years; expected "-" or "–".';
  if (/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+to\s+(?:Present|\w+ \d{4})\b/i.test(s)) {
    return 'Found "to" in date range; use "-" or "–" instead.';
  }
  return null;
}

function headingLabel(n) {
  return n?.rawText || n?.text || '(unknown heading)';
}

// ---------------------------------------------------------------------------
// Content slice checking
// ---------------------------------------------------------------------------
function validateContentSlice(schemaNode, docNode, docMd, errors, path) {
  const rule = schemaNode.rules.content;
  if (!rule) return;

  const slice = getSectionSlice(docMd, docNode); // text between this heading and next same-or-higher heading

  // any
  if (rule === 'any' || (typeof rule === 'object' && rule.kind === 'any')) return;

  // regex
  if (typeof rule === 'object' && rule.kind === 'regex') {
    if (!rule.re.test(slice)) {
      pushError(errors, {
        code: 'content-mismatch',
        message: `Content under "${headingLabel(docNode)}" does not match ${rule.re}`,
        path: path.join(' > '),
        line: docNode.pos?.line,
        expected: rule.re.toString(),
        actual: slice.slice(0, 160) + (slice.length > 160 ? '…' : '')
      });
    }
    return;
  }

  // paragraphs
  if (typeof rule === 'object' && rule.kind === 'paragraphs') {
    const paras = slice.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    if (paras.length < rule.min || paras.length > rule.max) {
      pushError(errors, {
        code: 'paragraph-count',
        message: `Expected ${rule.min}..${rule.max} paragraph(s) under "${headingLabel(docNode)}", found ${paras.length}.`,
        path: path.join(' > '),
        line: docNode.pos?.line,
        expected: { min: rule.min, max: rule.max },
        actual: { paragraphs: paras.length }
      });
    }
    return;
  }

  // list
  if (typeof rule === 'object' && rule.kind === 'list') {
    const bullets  = slice.match(/^\s*[-*+]\s+/gm) || [];
    const numbers  = slice.match(/^\s*\d+\.\s+/gm) || [];
    const count = bullets.length + numbers.length;
    if (count < (rule.minItems ?? 0)) {
      pushError(errors, {
        code: 'list-items',
        message: `List under "${headingLabel(docNode)}" has ${count} item(s); expected ≥ ${rule.minItems}. Add more "- " or "1. " items.`,
        path: path.join(' > '),
        line: docNode.pos?.line,
        expected: { minItems: rule.minItems },
        actual: { items: count }
      });
    }
    return;
  }

  // table
  if (typeof rule === 'object' && rule.kind === 'table') {
    const lines = slice.split('\n');
    const sepIdx = lines.findIndex(l => /\|?\s*:?-{3,}:?\s*\|/.test(l));
    if (sepIdx === -1) {
      pushError(errors, {
        code: 'table-missing',
        message: `Expected a Markdown table under "${headingLabel(docNode)}". Add a header row, a separator (---), and data rows.`,
        path: path.join(' > '),
        line: docNode.pos?.line
      });
      return;
    }
    const headerCols = Math.max(0, (lines[sepIdx].split('|').length - 2));
    const dataRows   = lines.slice(sepIdx + 1).filter(l => /\|/.test(l)).length;
    if (dataRows < (rule.minRows ?? 0) || headerCols < (rule.minCols ?? 0)) {
      pushError(errors, {
        code: 'table-size',
        message: `Table under "${headingLabel(docNode)}" too small: rows=${dataRows}, cols=${headerCols}; expected rows ≥ ${rule.minRows}, cols ≥ ${rule.minCols}.`,
        path: path.join(' > '),
        line: docNode.pos?.line,
        expected: { minRows: rule.minRows, minCols: rule.minCols },
        actual: { rows: dataRows, cols: headerCols }
      });
    }
    return;
  }

  // code(lang=...)
  if (typeof rule === 'object' && rule.kind === 'code') {
    const fence = /```+\s*([A-Za-z0-9+_-]*)[\s\S]*?```+/g;
    let ok = false, m;
    const foundLangs = new Set();
    while ((m = fence.exec(slice))) {
      const lang = (m[1] || '').trim();
      if (lang) foundLangs.add(lang);
      if (rule.lang.test(lang)) { ok = true; break; }
    }
    if (!ok) {
      pushError(errors, {
        code: 'code-lang',
        message: `Expected a fenced code block with language matching ${rule.lang} under "${headingLabel(docNode)}".`,
        path: path.join(' > '),
        line: docNode.pos?.line,
        expected: rule.lang.toString(),
        actual: foundLangs.size ? Array.from(foundLangs).join(', ') : '(no fenced code blocks found)'
      });
    }
    return;
  }

}

function getSectionSlice(docMd, docNode) {
  const lines = docMd.split(/\r?\n/);
  const startLine = docNode.pos?.line ?? 1;

  const headingRe = /^(#{1,6})\s+/;
  let endLine = lines.length + 1;
  for (let i = startLine; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) {
      const level = m[1].length;
      if (level <= docNode.depth) { endLine = i + 1; break; }
    }
  }
  const body = lines.slice(startLine, endLine - 1).join('\n');
  return body.trim();
}

function stripTrailingHtmlComment(s) {
  // remove a trailing <!-- ... --> plus any surrounding spaces
  return s.replace(/\s*<!--[\s\S]*?-->\s*$/, '').trim();
}

function maybeHintOnNearMissChildren(schemaNode, docSiblings, errors, pathStack) {
  // Only for regex headers
  if (!schemaNode || !schemaNode.matcher || schemaNode.matcher.type !== 'regex') return;

  for (const d of docSiblings) {
    // Skip headings that already match the schema regex
    if (schemaNode.matcher.pattern.test(d.text)) continue;

    // Look for likely date-range token mistakes to emit a helpful hint
    const hint = diagnoseDateRangeToken(d.rawText || d.text);
    if (hint) {
      errors.push({
        code: 'date-range-token',
        message: hint,
        path: pathStack.concat(d.rawText || d.text).join(' > '),
        line: d.pos?.line
      });
    }
  }
}


// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------
function pushError(arr, e) {
  arr.push({
    code: e.code,
    message: e.message,
    path: e.path,
    line: e.line,
    column: e.column,
    expected: e.expected,
    actual: e.actual
  });
}

// ---------------------------------------------------------------------------
// Back-compat aliases and exports
// ---------------------------------------------------------------------------
function compileSchemaMD(schemaMd) { return compileSchema(schemaMd); }

export { compileSchema, validateMarkdown, compileSchemaMD };
