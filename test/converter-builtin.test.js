import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertBuiltIn, resolveRef, generateExampleFromSchema } from '../src/converter.js';

describe('resolveRef', () => {
  const spec = {
    components: {
      schemas: {
        User: { type: 'object', properties: { name: { type: 'string', example: 'John' } } },
        Nested: { deep: { value: 42 } },
      },
    },
  };

  it('resolves a valid $ref', () => {
    const result = resolveRef('#/components/schemas/User', spec);
    assert.equal(result.type, 'object');
    assert.equal(result.properties.name.example, 'John');
  });

  it('returns null for invalid $ref', () => {
    assert.equal(resolveRef('#/components/schemas/Missing', spec), null);
  });

  it('returns null for null or non-hash ref', () => {
    assert.equal(resolveRef(null, spec), null);
    assert.equal(resolveRef('', spec), null);
    assert.equal(resolveRef('external.yaml#/foo', spec), null);
  });

  it('resolves deeply nested refs', () => {
    const result = resolveRef('#/components/schemas/Nested', spec);
    assert.equal(result.deep.value, 42);
  });
});

describe('generateExampleFromSchema', () => {
  it('generates example for object schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Widget' },
        count: { type: 'integer', example: 5 },
      },
    };
    const result = generateExampleFromSchema(schema, {});
    assert.equal(result.name, 'Widget');
    assert.equal(result.count, 5);
  });

  it('generates example for array schema', () => {
    const schema = {
      type: 'array',
      items: { type: 'string', example: 'item' },
    };
    const result = generateExampleFromSchema(schema, {});
    assert.ok(Array.isArray(result));
    assert.equal(result[0], 'item');
  });

  it('handles $ref in schema', () => {
    const spec = {
      components: {
        schemas: {
          Foo: { type: 'object', properties: { bar: { type: 'string', example: 'baz' } } },
        },
      },
    };
    const result = generateExampleFromSchema({ $ref: '#/components/schemas/Foo' }, spec);
    assert.equal(result.bar, 'baz');
  });

  it('handles allOf by merging', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string', example: 'alpha' } } },
        { type: 'object', properties: { b: { type: 'integer', example: 99 } } },
      ],
    };
    const result = generateExampleFromSchema(schema, {});
    assert.equal(result.a, 'alpha');
    assert.equal(result.b, 99);
  });

  it('handles oneOf by using first option', () => {
    const schema = {
      oneOf: [
        { type: 'object', properties: { x: { type: 'string', example: 'first' } } },
        { type: 'object', properties: { y: { type: 'string', example: 'second' } } },
      ],
    };
    const result = generateExampleFromSchema(schema, {});
    assert.equal(result.x, 'first');
    assert.equal(result.y, undefined);
  });

  it('handles anyOf by using first option', () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { z: { type: 'boolean', example: true } } },
      ],
    };
    const result = generateExampleFromSchema(schema, {});
    assert.equal(result.z, true);
  });

  it('returns schema.example if present', () => {
    const schema = { example: { custom: 'value' } };
    const result = generateExampleFromSchema(schema, {});
    assert.deepEqual(result, { custom: 'value' });
  });

  it('generates type-based fallbacks', () => {
    assert.equal(typeof generateExampleFromSchema({ type: 'string' }, {}), 'string');
    assert.equal(generateExampleFromSchema({ type: 'integer' }, {}), 1);
    assert.equal(generateExampleFromSchema({ type: 'number' }, {}), 0.0);
    assert.equal(generateExampleFromSchema({ type: 'boolean' }, {}), true);
  });

  it('handles schema with properties but no type', () => {
    const schema = {
      properties: { name: { type: 'string', example: 'test' } },
    };
    const result = generateExampleFromSchema(schema, {});
    assert.equal(result.name, 'test');
  });

  it('handles depth limit', () => {
    // Very deep nesting should stop at depth 8
    const schema = { $ref: '#/components/schemas/Self' };
    const spec = {
      components: { schemas: { Self: { $ref: '#/components/schemas/Self' } } },
    };
    // Should not throw or infinite loop
    const result = generateExampleFromSchema(schema, spec);
    assert.ok(typeof result === 'object');
  });

  it('handles array without items', () => {
    const schema = { type: 'array' };
    const result = generateExampleFromSchema(schema, {});
    assert.ok(Array.isArray(result));
  });

  it('handles empty oneOf/anyOf', () => {
    assert.deepEqual(generateExampleFromSchema({ oneOf: [] }, {}), {});
    assert.deepEqual(generateExampleFromSchema({ anyOf: [] }, {}), {});
  });
});

describe('convertBuiltIn', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test API', description: 'A test API', version: '1.0.0' },
    servers: [{ url: 'http://localhost:4000' }],
    paths: {
      '/v1/users': {
        get: {
          tags: ['Users'],
          summary: 'List Users',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } },
          ],
          responses: { '200': { description: 'OK' } },
        },
        post: {
          tags: ['Users'],
          summary: 'Create User',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'Jane Doe' },
                    email: { type: 'string', format: 'email' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
      '/v1/users/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          tags: ['Users'],
          summary: 'Get User',
          responses: { '200': { description: 'OK' } },
        },
        put: {
          tags: ['Users'],
          summary: 'Update User',
          parameters: [
            { name: 'X-Request-Id', in: 'header', schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'Updated Name' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
      '/v1/health': {
        get: {
          summary: 'Health Check',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };

  it('creates a valid Postman collection', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    assert.ok(collection.info);
    assert.equal(collection.info.name, 'test-api');
    assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
    assert.ok(Array.isArray(collection.item));
  });

  it('groups endpoints into folders by tag', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    const folderNames = collection.item.map(f => f.name);
    assert.ok(folderNames.includes('Users'));
    assert.ok(folderNames.includes('Untagged'));
  });

  it('creates correct number of requests', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    let count = 0;
    for (const folder of collection.item) {
      count += (folder.item || []).length;
    }
    assert.equal(count, 5); // List, Create, Get, Update users + health
  });

  it('populates query parameters', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    const usersFolder = collection.item.find(f => f.name === 'Users');
    const listUsers = usersFolder.item.find(r => r.name === 'List Users');
    assert.ok(listUsers);
    const query = listUsers.request.url.query;
    assert.ok(query.length > 0);
    const limitParam = query.find(q => q.key === 'limit');
    assert.ok(limitParam);
    assert.equal(limitParam.value, '25');
  });

  it('handles path variables', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    const usersFolder = collection.item.find(f => f.name === 'Users');
    const getUser = usersFolder.item.find(r => r.name === 'Get User');
    assert.ok(getUser);
    const pathVars = getUser.request.url.variable;
    assert.ok(pathVars.some(v => v.key === 'id'));
  });

  it('generates request bodies', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    const usersFolder = collection.item.find(f => f.name === 'Users');
    const createUser = usersFolder.item.find(r => r.name === 'Create User');
    assert.ok(createUser);
    assert.ok(createUser.request.body);
    assert.equal(createUser.request.body.mode, 'raw');
    const body = JSON.parse(createUser.request.body.raw);
    assert.equal(body.name, 'Jane Doe');
  });

  it('handles header parameters', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    const usersFolder = collection.item.find(f => f.name === 'Users');
    const updateUser = usersFolder.item.find(r => r.name === 'Update User');
    assert.ok(updateUser);
    const headers = updateUser.request.header;
    assert.ok(headers.some(h => h.key === 'X-Request-Id'));
    assert.ok(headers.some(h => h.key === 'Content-Type'));
  });

  it('merges path-level and operation-level parameters', () => {
    const collection = convertBuiltIn(spec, 'test-api');
    const usersFolder = collection.item.find(f => f.name === 'Users');
    const getUser = usersFolder.item.find(r => r.name === 'Get User');
    // Get User has no operation params but should inherit path-level id param
    assert.ok(getUser.request.url.variable.some(v => v.key === 'id'));
  });

  it('handles $ref in request bodies', () => {
    const specWithRef = {
      ...spec,
      components: {
        schemas: {
          CreateOrder: {
            type: 'object',
            properties: {
              item: { type: 'string', example: 'Widget' },
              qty: { type: 'integer', example: 3 },
            },
          },
        },
      },
      paths: {
        '/v1/orders': {
          post: {
            tags: ['Orders'],
            summary: 'Create Order',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateOrder' },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    };
    const collection = convertBuiltIn(specWithRef, 'order-api');
    const ordersFolder = collection.item.find(f => f.name === 'Orders');
    const createOrder = ordersFolder.item[0];
    const body = JSON.parse(createOrder.request.body.raw);
    assert.equal(body.item, 'Widget');
    assert.equal(body.qty, 3);
  });

  it('uses spec title as fallback name', () => {
    const collection = convertBuiltIn(spec, '');
    assert.equal(collection.info.name, 'Test API');
  });

  it('handles empty spec', () => {
    const collection = convertBuiltIn({ paths: {} }, 'empty');
    assert.equal(collection.item.length, 0);
  });

  it('sets baseUrl from servers array', () => {
    const collection = convertBuiltIn(spec, 'test');
    const baseUrlVar = collection.variable.find(v => v.key === 'baseUrl');
    assert.equal(baseUrlVar.value, 'http://localhost:4000');
  });

  it('defaults baseUrl when no servers', () => {
    const noServers = { ...spec, servers: [] };
    const collection = convertBuiltIn(noServers, 'test');
    const baseUrlVar = collection.variable.find(v => v.key === 'baseUrl');
    assert.equal(baseUrlVar.value, 'http://localhost:4000');
  });

  it('sorts folders alphabetically', () => {
    const multiTagSpec = {
      openapi: '3.0.0',
      info: { title: 'Multi', version: '1.0.0' },
      paths: {
        '/zebra': { get: { tags: ['Zebras'], summary: 'Z', responses: { '200': { description: 'OK' } } } },
        '/apple': { get: { tags: ['Apples'], summary: 'A', responses: { '200': { description: 'OK' } } } },
        '/mango': { get: { tags: ['Mangos'], summary: 'M', responses: { '200': { description: 'OK' } } } },
      },
    };
    const collection = convertBuiltIn(multiTagSpec, 'sorted');
    assert.equal(collection.item[0].name, 'Apples');
    assert.equal(collection.item[1].name, 'Mangos');
    assert.equal(collection.item[2].name, 'Zebras');
  });
});
