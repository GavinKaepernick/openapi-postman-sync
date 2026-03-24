import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/yaml-parser.js';

describe('parseYaml', () => {
  describe('JSON input', () => {
    it('parses valid JSON', () => {
      const result = parseYaml('{"key": "value", "num": 42}');
      assert.deepEqual(result, { key: 'value', num: 42 });
    });

    it('parses JSON arrays', () => {
      const result = parseYaml('[1, 2, 3]');
      assert.deepEqual(result, [1, 2, 3]);
    });
  });

  describe('YAML input (via js-yaml)', () => {
    it('parses simple key-value pairs', () => {
      const result = parseYaml('name: hello\nversion: "1.0"');
      assert.equal(result.name, 'hello');
      assert.equal(result.version, '1.0');
    });

    it('parses nested objects', () => {
      const yaml = `
info:
  title: Test API
  version: "1.0.0"
`;
      const result = parseYaml(yaml);
      assert.equal(result.info.title, 'Test API');
      assert.equal(result.info.version, '1.0.0');
    });

    it('parses arrays', () => {
      const yaml = `
items:
  - name: first
  - name: second
`;
      const result = parseYaml(yaml);
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].name, 'first');
      assert.equal(result.items[1].name, 'second');
    });

    it('handles boolean values', () => {
      const yaml = 'active: true\ndisabled: false';
      const result = parseYaml(yaml);
      assert.equal(result.active, true);
      assert.equal(result.disabled, false);
    });

    it('handles null values', () => {
      const yaml = 'value: null\ntilde: ~';
      const result = parseYaml(yaml);
      assert.equal(result.value, null);
      assert.equal(result.tilde, null);
    });

    it('handles numeric values', () => {
      const yaml = 'int: 42\nfloat: 3.14\nneg: -7';
      const result = parseYaml(yaml);
      assert.equal(result.int, 42);
      assert.equal(result.float, 3.14);
      assert.equal(result.neg, -7);
    });

    it('handles quoted strings with colons', () => {
      const yaml = 'url: "http://localhost:4000"';
      const result = parseYaml(yaml);
      assert.equal(result.url, 'http://localhost:4000');
    });

    it('handles inline arrays', () => {
      const yaml = 'tags: [api, public, v1]';
      const result = parseYaml(yaml);
      assert.deepEqual(result.tags, ['api', 'public', 'v1']);
    });

    it('parses a minimal OpenAPI spec', () => {
      const yaml = `
openapi: "3.0.0"
info:
  title: "My API"
  version: "1.0.0"
paths:
  /v1/test:
    get:
      summary: "Test endpoint"
      responses:
        "200":
          description: "OK"
`;
      const result = parseYaml(yaml);
      assert.equal(result.openapi, '3.0.0');
      assert.equal(result.info.title, 'My API');
      assert.ok(result.paths['/v1/test']);
      assert.equal(result.paths['/v1/test'].get.summary, 'Test endpoint');
    });

    it('handles deeply nested structures', () => {
      const yaml = `
a:
  b:
    c:
      d: deep_value
`;
      const result = parseYaml(yaml);
      assert.equal(result.a.b.c.d, 'deep_value');
    });

    it('handles enum arrays', () => {
      const yaml = `
schema:
  type: string
  enum:
    - active
    - inactive
    - pending
`;
      const result = parseYaml(yaml);
      assert.deepEqual(result.schema.enum, ['active', 'inactive', 'pending']);
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = parseYaml('');
      // Should not throw, may return null or empty object
      assert.ok(result === null || result === undefined || typeof result === 'object');
    });

    it('handles comments', () => {
      const yaml = `
# This is a comment
name: test # inline comment
`;
      const result = parseYaml(yaml);
      assert.equal(result.name, 'test');
    });
  });
});
