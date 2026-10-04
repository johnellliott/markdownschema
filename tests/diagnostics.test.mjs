import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { compileSchema, validateMarkdown } = await import(
  process.env.MARKDOWNSCHEMA_VALIDATOR_URL || '../src/markdownschema-validator.js');

const fixtures = JSON.parse(readFileSync(new URL('./diagnostic-fixtures.json', import.meta.url)));
for (const fixture of fixtures) {
  test(fixture.name, () => {
    const result = validateMarkdown(fixture.document, compileSchema(fixture.schema));
    assert.equal(result.ok, fixture.ok);
    const headings = result.errors.filter(error => error.code === 'unexpected-heading');
    assert.deepEqual(headings.flatMap(error => error.hints || []), fixture.hints);
    if (fixture.unexpected_count) assert.equal(headings.length, fixture.unexpected_count);
    for (const error of headings) {
      assert.ok(error.line > 0);
      assert.ok(error.schema_line > 0);
      assert.ok(error.expected.length > 0);
      assert.ok(error.actual);
    }
    assert.deepEqual(validateMarkdown(fixture.document, compileSchema(fixture.schema)), result);
  });
}
