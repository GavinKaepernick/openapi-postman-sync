import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackParseYaml } from '../src/yaml-parser.js';

describe('fallbackParseYaml', () => {
  describe('simple key-value pairs', () => {
    it('parses string values', () => {
      const result = fallbackParseYaml('name: hello\nversion: "1.0"');
      assert.equal(result.name, 'hello');
      assert.equal(result.version, '1.0');
    });

    it('parses boolean values', () => {
      const result = fallbackParseYaml('active: true\ndisabled: false');
      assert.equal(result.active, true);
      assert.equal(result.disabled, false);
    });

    it('parses null values', () => {
      const result = fallbackParseYaml('value: null\ntilde: ~');
      assert.equal(result.value, null);
      assert.equal(result.tilde, null);
    });

    it('parses numeric values', () => {
      const result = fallbackParseYaml('int: 42\nfloat: 3.14\nneg: -7');
      assert.equal(result.int, 42);
      assert.equal(result.float, 3.14);
      assert.equal(result.neg, -7);
    });

    it('parses quoted strings', () => {
      const result = fallbackParseYaml('url: "http://localhost:4000"\nname: \'single\'');
      assert.equal(result.url, 'http://localhost:4000');
      assert.equal(result.name, 'single');
    });
  });

  describe('nested objects', () => {
    it('parses nested mappings', () => {
      const yaml = 'info:\n  title: Test API\n  version: "1.0.0"';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.info.title, 'Test API');
      assert.equal(result.info.version, '1.0.0');
    });

    it('parses deeply nested structures', () => {
      const yaml = 'a:\n  b:\n    c:\n      d: deep_value';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.a.b.c.d, 'deep_value');
    });
  });

  describe('arrays', () => {
    it('parses simple arrays', () => {
      const yaml = 'items:\n  - first\n  - second\n  - third';
      const result = fallbackParseYaml(yaml);
      assert.deepEqual(result.items, ['first', 'second', 'third']);
    });

    it('parses arrays of objects', () => {
      const yaml = 'items:\n  - name: one\n  - name: two';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].name, 'one');
      assert.equal(result.items[1].name, 'two');
    });

    it('parses inline arrays', () => {
      const result = fallbackParseYaml('tags: [api, public, v1]');
      assert.deepEqual(result.tags, ['api', 'public', 'v1']);
    });

    it('handles empty inline arrays', () => {
      const result = fallbackParseYaml('items: []');
      assert.deepEqual(result.items, []);
    });
  });

  describe('comments', () => {
    it('strips line comments', () => {
      const yaml = '# Top comment\nname: test # inline comment';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.name, 'test');
    });

    it('preserves # inside quoted strings', () => {
      const yaml = 'color: "red #FF0000"';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.color, 'red #FF0000');
    });
  });

  describe('multiline strings', () => {
    it('handles pipe (|) multiline', () => {
      const yaml = 'description: |\n  Line one\n  Line two';
      const result = fallbackParseYaml(yaml);
      assert.ok(result.description.includes('Line one'));
      assert.ok(result.description.includes('Line two'));
    });

    it('handles folded (>) multiline', () => {
      const yaml = 'description: >\n  Folded line one\n  Folded line two';
      const result = fallbackParseYaml(yaml);
      assert.ok(result.description.includes('Folded line'));
    });
  });

  describe('OpenAPI-like structures', () => {
    it('parses a minimal OpenAPI spec', () => {
      const yaml = `openapi: "3.0.0"
info:
  title: "My API"
  version: "1.0.0"
paths:
  /v1/test:
    get:
      summary: "Test endpoint"
      responses:
        "200":
          description: "OK"`;
      const result = fallbackParseYaml(yaml);
      assert.equal(result.openapi, '3.0.0');
      assert.equal(result.info.title, 'My API');
      assert.ok(result.paths);
      assert.ok(result.paths['/v1/test']);
    });

    it('parses enum arrays', () => {
      const yaml = `schema:
  type: string
  enum:
    - active
    - inactive
    - pending`;
      const result = fallbackParseYaml(yaml);
      assert.deepEqual(result.schema.enum, ['active', 'inactive', 'pending']);
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = fallbackParseYaml('');
      assert.ok(result !== undefined);
    });

    it('handles blank lines between content', () => {
      const yaml = 'a: 1\n\nb: 2';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.a, 1);
      assert.equal(result.b, 2);
    });

    it('handles True/False/Null capitalized', () => {
      const result = fallbackParseYaml('a: True\nb: False\nc: Null');
      assert.equal(result.a, true);
      assert.equal(result.b, false);
      assert.equal(result.c, null);
    });

    it('handles key with null value (no value after colon)', () => {
      const yaml = 'empty_key:';
      const result = fallbackParseYaml(yaml);
      assert.equal(result.empty_key, null);
    });

    it('handles arrays of objects with continuation lines', () => {
      const yaml = `servers:
  - url: "http://localhost:4000"
    description: Local
  - url: "https://api.example.com"
    description: Production`;
      const result = fallbackParseYaml(yaml);
      assert.equal(result.servers.length, 2);
      assert.equal(result.servers[0].url, 'http://localhost:4000');
      assert.equal(result.servers[0].description, 'Local');
      assert.equal(result.servers[1].url, 'https://api.example.com');
    });
  });
});
