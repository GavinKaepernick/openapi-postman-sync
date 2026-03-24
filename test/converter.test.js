import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { convertToPostman } from '../src/converter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specYaml = readFileSync(join(__dirname, 'fixtures', 'sample-spec.yaml'), 'utf-8');

// Also test with a JSON spec
const specJson = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'JSON Test', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/v1/items': {
      get: {
        tags: ['Items'],
        summary: 'List Items',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'archived'] } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/v1/items/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: {
        tags: ['Items'],
        summary: 'Get Item',
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Items'],
        summary: 'Update Item',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Widget' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});

describe('convertToPostman', () => {
  describe('YAML spec', () => {
    it('converts a YAML spec to Postman collection', async () => {
      const { collection } = await convertToPostman(specYaml, 'test-api');
      assert.ok(collection.info);
      assert.ok(collection.item);
      assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
    });

    it('creates folders for each tag', async () => {
      const { collection } = await convertToPostman(specYaml, 'test-api');
      const folderNames = collection.item.map(f => f.name);
      assert.ok(folderNames.includes('Carriers'));
      assert.ok(folderNames.includes('Parcels'));
    });

    it('counts routes correctly', async () => {
      const { collection } = await convertToPostman(specYaml, 'test-api');
      let requestCount = 0;
      function walk(items) {
        for (const item of items) {
          if (item.item) walk(item.item);
          else if (item.request) requestCount++;
        }
      }
      walk(collection.item);
      // 8 total: GET/POST /carriers, GET/PUT/PATCH /carriers/:id, GET /parcels, GET /parcels/:id, GET /docs, POST /webhooks, GET /internal
      assert.ok(requestCount >= 8, `Expected at least 8 requests, got ${requestCount}`);
    });

    it('returns the parsed spec alongside the collection', async () => {
      const { parsedSpec } = await convertToPostman(specYaml, 'test-api');
      assert.ok(parsedSpec.paths);
      assert.ok(parsedSpec.paths['/v1/carriers']);
    });

    it('handles path-level parameters', async () => {
      const { collection } = await convertToPostman(specYaml, 'test-api');
      // Find Get Carrier request - it uses path-level params from /v1/carriers/{id}
      let getCarrier = null;
      for (const folder of collection.item) {
        for (const req of (folder.item || [])) {
          if (req.request?.method === 'GET' && req.name?.includes('Get Carrier')) {
            getCarrier = req;
          }
        }
      }
      assert.ok(getCarrier, 'Should find a Get Carrier request');
      // Should have path variable for id
      const pathVars = getCarrier.request.url.variable || [];
      assert.ok(pathVars.some(v => v.key === 'id'), 'Should have id path variable');
    });
  });

  describe('JSON spec', () => {
    it('converts a JSON spec to Postman collection', async () => {
      const { collection } = await convertToPostman(specJson, 'json-test');
      assert.ok(collection.info);
      assert.ok(collection.item);
    });

    it('creates correct number of requests', async () => {
      const { collection } = await convertToPostman(specJson, 'json-test');
      let count = 0;
      function walk(items) {
        for (const item of items) {
          if (item.item) walk(item.item);
          else if (item.request) count++;
        }
      }
      walk(collection.item);
      assert.equal(count, 3); // GET /items, GET /items/:id, PUT /items/:id
    });

    it('populates query params with defaults from schema', async () => {
      const { collection } = await convertToPostman(specJson, 'json-test');
      let listItems = null;
      for (const folder of collection.item) {
        for (const req of (folder.item || [])) {
          if (req.name === 'List Items') listItems = req;
        }
      }
      assert.ok(listItems, 'Should find List Items request');
      const query = listItems.request.url.query || [];
      const limitParam = query.find(q => q.key === 'limit');
      const statusParam = query.find(q => q.key === 'status');
      assert.ok(limitParam, 'Should have limit param');
      assert.ok(statusParam, 'Should have status param');
      // limit has default: 50 in schema
      assert.equal(limitParam.value, '50');
      // status has enum, converter may pick any enum value
      const enumValues = ['active', 'archived'];
      assert.ok(enumValues.includes(statusParam.value), `status value should be an enum value, got: ${statusParam.value}`);
    });

    it('generates request body from schema', async () => {
      const { collection } = await convertToPostman(specJson, 'json-test');
      let updateItem = null;
      for (const folder of collection.item) {
        for (const req of (folder.item || [])) {
          if (req.name === 'Update Item') updateItem = req;
        }
      }
      assert.ok(updateItem, 'Should find Update Item request');
      assert.ok(updateItem.request.body, 'Should have a request body');
      assert.equal(updateItem.request.body.mode, 'raw');
      const body = JSON.parse(updateItem.request.body.raw);
      assert.equal(body.name, 'Widget');
    });
  });

  describe('$ref resolution', () => {
    it('resolves $ref in request bodies', async () => {
      const { collection } = await convertToPostman(specYaml, 'test-api');
      let createCarrier = null;
      for (const folder of collection.item) {
        for (const req of (folder.item || [])) {
          if (req.name === 'Create Carrier') createCarrier = req;
        }
      }
      assert.ok(createCarrier, 'Should find Create Carrier');
      assert.ok(createCarrier.request.body, 'Should have request body');
      const body = JSON.parse(createCarrier.request.body.raw);
      assert.equal(body.name, 'FedEx');
      assert.equal(body.code, 'FEDEX');
    });
  });

  describe('allOf / oneOf / anyOf', () => {
    it('merges allOf schemas', async () => {
      const allOfSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'AllOf Test', version: '1.0.0' },
        paths: {
          '/test': {
            post: {
              summary: 'AllOf',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        { type: 'object', properties: { a: { type: 'string', example: 'hello' } } },
                        { type: 'object', properties: { b: { type: 'integer', example: 42 } } },
                      ],
                    },
                  },
                },
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      });
      const { collection } = await convertToPostman(allOfSpec, 'allof-test');
      let req = collection.item[0]?.item?.[0] || collection.item[0];
      if (!req.request) req = collection.item[0];
      assert.ok(req.request.body, 'Should have body');
      const body = JSON.parse(req.request.body.raw);
      assert.equal(body.a, 'hello');
      assert.equal(body.b, 42);
    });
  });
});
