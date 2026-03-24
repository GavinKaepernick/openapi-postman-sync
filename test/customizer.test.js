import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { customizeCollection } from '../src/customizer.js';

// ── Helpers ──

function makeCollection(items = [], opts = {}) {
  return {
    info: { name: opts.name || 'Test', description: '', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: items,
    variable: opts.variable || [],
  };
}

function makeFolder(name, requests = []) {
  return { name, item: requests };
}

function makeRequest(name, method, path, opts = {}) {
  return {
    name,
    request: {
      method,
      header: opts.headers || [],
      url: {
        raw: `{{baseUrl}}${path}`,
        host: ['{{baseUrl}}'],
        path: path.split('/').filter(Boolean),
        query: opts.query || [],
        variable: opts.variable || [],
      },
      description: opts.description || '',
    },
    response: [],
  };
}

// ── Spec for enrichment tests ──

const testSpec = {
  paths: {
    '/v1/carriers': {
      get: {
        parameters: [
          { name: 'limit', in: 'query', description: 'Number of items', schema: { type: 'integer' } },
          { name: 'sort', in: 'query', description: 'Sort by `name`, `inserted_at`.', schema: { type: 'string' } },
          {
            name: 'filter', in: 'query', style: 'deepObject', explode: true,
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['active', 'inactive'], description: 'Carrier status' },
                carrier_id: { type: 'string', format: 'uuid', description: 'Carrier UUID' },
              },
            },
          },
        ],
      },
    },
    '/v1/parcels': {
      get: {
        parameters: [
          { name: 'before', in: 'query', schema: { type: 'string' } },
          { name: 'after', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'per_page', in: 'query', schema: { type: 'integer' } },
        ],
      },
    },
  },
};

// ── Tests ──

describe('customizeCollection', () => {
  describe('collection metadata', () => {
    it('overrides collection name', () => {
      const col = makeCollection([]);
      const result = customizeCollection(col, { collectionName: 'My API' });
      assert.equal(result.info.name, 'My API');
    });

    it('overrides collection description', () => {
      const col = makeCollection([]);
      const result = customizeCollection(col, { collectionDescription: 'A description' });
      assert.equal(result.info.description, 'A description');
    });

    it('does not mutate the original collection', () => {
      const col = makeCollection([]);
      customizeCollection(col, { collectionName: 'Changed' });
      assert.equal(col.info.name, 'Test');
    });
  });

  describe('auth', () => {
    it('applies bearer auth', () => {
      const col = makeCollection([]);
      const result = customizeCollection(col, { auth: { type: 'bearer', tokenVariable: 'myToken' } });
      assert.equal(result.auth.type, 'bearer');
      assert.equal(result.auth.bearer[0].value, '{{myToken}}');
    });

    it('applies API key auth', () => {
      const col = makeCollection([]);
      const result = customizeCollection(col, { auth: { type: 'apikey', keyName: 'X-Key', keyVariable: 'apiKey' } });
      assert.equal(result.auth.type, 'apikey');
      assert.equal(result.auth.apikey[0].value, 'X-Key');
      assert.equal(result.auth.apikey[1].value, '{{apiKey}}');
    });

    it('applies basic auth', () => {
      const col = makeCollection([]);
      const result = customizeCollection(col, { auth: { type: 'basic' } });
      assert.equal(result.auth.type, 'basic');
    });
  });

  describe('header defaults', () => {
    it('adds default headers to all requests', () => {
      const req = makeRequest('Test', 'GET', '/v1/test');
      const col = makeCollection([makeFolder('Folder', [req])]);
      const result = customizeCollection(col, { headerDefaults: { Accept: 'application/json' } });
      const headers = result.item[0].item[0].request.header;
      assert.ok(headers.find(h => h.key === 'Accept' && h.value === 'application/json'));
    });

    it('does not duplicate existing headers', () => {
      const req = makeRequest('Test', 'GET', '/v1/test', {
        headers: [{ key: 'Accept', value: 'text/html' }],
      });
      const col = makeCollection([makeFolder('Folder', [req])]);
      const result = customizeCollection(col, { headerDefaults: { Accept: 'application/json' } });
      const headers = result.item[0].item[0].request.header;
      const acceptHeaders = headers.filter(h => h.key === 'Accept');
      assert.equal(acceptHeaders.length, 1);
      assert.equal(acceptHeaders[0].value, 'text/html');
    });
  });

  describe('exclude paths', () => {
    it('removes requests matching excluded path patterns', () => {
      const col = makeCollection([
        makeFolder('API', [makeRequest('List', 'GET', '/v1/carriers')]),
        makeFolder('Docs', [makeRequest('Docs', 'GET', '/docs/openapi')]),
        makeFolder('Webhooks', [makeRequest('Hook', 'POST', '/webhooks/delivery')]),
      ]);
      const result = customizeCollection(col, { excludePaths: ['/docs/*', '/webhooks/*'] });
      assert.equal(result.item.length, 1);
      assert.equal(result.item[0].name, 'API');
    });

    it('supports wildcard in the middle of patterns', () => {
      const col = makeCollection([
        makeFolder('API', [
          makeRequest('List', 'GET', '/v1/carriers'),
          makeRequest('Internal', 'GET', '/internal/health'),
        ]),
      ]);
      const result = customizeCollection(col, { excludePaths: ['/internal/*'] });
      assert.equal(result.item[0].item.length, 1);
      assert.equal(result.item[0].item[0].name, 'List');
    });
  });

  describe('exclude tags', () => {
    it('removes folders matching excluded tags', () => {
      const col = makeCollection([
        makeFolder('Carriers', [makeRequest('List', 'GET', '/v1/carriers')]),
        makeFolder('Internal', [makeRequest('Health', 'GET', '/health')]),
      ]);
      const result = customizeCollection(col, { excludeTags: ['Internal'] });
      assert.equal(result.item.length, 1);
      assert.equal(result.item[0].name, 'Carriers');
    });
  });

  describe('folder overrides', () => {
    it('renames folders', () => {
      const col = makeCollection([
        makeFolder('OldName', [makeRequest('Test', 'GET', '/test')]),
      ]);
      const result = customizeCollection(col, { folderOverrides: { OldName: 'NewName' } });
      assert.equal(result.item[0].name, 'NewName');
    });
  });

  describe('disable and enrich query params', () => {
    it('disables all query params by default', () => {
      const req = makeRequest('List', 'GET', '/v1/carriers', {
        query: [
          { key: 'limit', value: '10' },
          { key: 'sort', value: 'name' },
        ],
      });
      const col = makeCollection([makeFolder('Carriers', [req])]);
      const result = customizeCollection(col, {});
      const query = result.item[0].item[0].request.url.query;
      assert.ok(query.every(p => p.disabled === true));
    });

    it('does not disable when disableQueryParams is false', () => {
      const req = makeRequest('List', 'GET', '/v1/carriers', {
        query: [{ key: 'limit', value: '10' }],
      });
      const col = makeCollection([makeFolder('Carriers', [req])]);
      const result = customizeCollection(col, { disableQueryParams: false });
      const query = result.item[0].item[0].request.url.query;
      assert.equal(query[0].disabled, undefined);
    });

    it('enriches limit param with smart default from spec', () => {
      const req = makeRequest('List', 'GET', '/v1/carriers', {
        query: [{ key: 'limit', value: 'nulla non quis' }],
      });
      const col = makeCollection([makeFolder('Carriers', [req])]);
      const result = customizeCollection(col, {}, testSpec);
      const limitParam = result.item[0].item[0].request.url.query.find(p => p.key === 'limit');
      assert.equal(limitParam.value, '25');
    });

    it('enriches sort param with first sortable field', () => {
      const req = makeRequest('List', 'GET', '/v1/carriers', {
        query: [{ key: 'sort', value: 'random junk' }],
      });
      const col = makeCollection([makeFolder('Carriers', [req])]);
      const result = customizeCollection(col, {}, testSpec);
      const sortParam = result.item[0].item[0].request.url.query.find(p => p.key === 'sort');
      assert.equal(sortParam.value, 'name:asc');
    });

    it('enriches filter enum params with first enum value', () => {
      const req = makeRequest('List', 'GET', '/v1/carriers', {
        query: [{ key: 'filter[status]', value: '<string>' }],
      });
      const col = makeCollection([makeFolder('Carriers', [req])]);
      const result = customizeCollection(col, {}, testSpec);
      const param = result.item[0].item[0].request.url.query.find(p => p.key === 'filter[status]');
      assert.equal(param.value, 'active');
      assert.ok(param.description.includes('Allowed: active, inactive'));
    });

    it('enriches UUID filter params with {{id}} variable', () => {
      const req = makeRequest('List', 'GET', '/v1/carriers', {
        query: [{ key: 'filter[carrier_id]', value: 'fake-uuid' }],
      });
      const col = makeCollection([makeFolder('Carriers', [req])]);
      const result = customizeCollection(col, {}, testSpec);
      const param = result.item[0].item[0].request.url.query.find(p => p.key === 'filter[carrier_id]');
      assert.equal(param.value, '{{id}}');
    });

    it('enriches before/after as empty cursor params', () => {
      const req = makeRequest('List', 'GET', '/v1/parcels', {
        query: [
          { key: 'before', value: 'nulla non quis' },
          { key: 'after', value: 'nulla non quis' },
        ],
      });
      const col = makeCollection([makeFolder('Parcels', [req])]);
      const result = customizeCollection(col, {}, testSpec);
      const query = result.item[0].item[0].request.url.query;
      assert.equal(query.find(p => p.key === 'before').value, '');
      assert.equal(query.find(p => p.key === 'after').value, '');
    });

    it('enriches page and per_page params', () => {
      const req = makeRequest('List', 'GET', '/v1/parcels', {
        query: [
          { key: 'page', value: '-123' },
          { key: 'per_page', value: '-456' },
        ],
      });
      const col = makeCollection([makeFolder('Parcels', [req])]);
      const result = customizeCollection(col, {}, testSpec);
      const query = result.item[0].item[0].request.url.query;
      assert.equal(query.find(p => p.key === 'page').value, '1');
      assert.equal(query.find(p => p.key === 'per_page').value, '25');
    });
  });

  describe('deduplicate names', () => {
    it('appends method to duplicate names', () => {
      const col = makeCollection([
        makeFolder('Carriers', [
          makeRequest('Update Carrier', 'PUT', '/v1/carriers/:id'),
          makeRequest('Update Carrier', 'PATCH', '/v1/carriers/:id'),
        ]),
      ]);
      const result = customizeCollection(col, { disableQueryParams: false });
      const names = result.item[0].item.map(i => i.name);
      assert.ok(names.includes('Update Carrier (PUT)'));
      assert.ok(names.includes('Update Carrier (PATCH)'));
    });

    it('leaves unique names unchanged', () => {
      const col = makeCollection([
        makeFolder('Carriers', [
          makeRequest('List Carriers', 'GET', '/v1/carriers'),
          makeRequest('Create Carrier', 'POST', '/v1/carriers'),
        ]),
      ]);
      const result = customizeCollection(col, { disableQueryParams: false });
      const names = result.item[0].item.map(i => i.name);
      assert.ok(names.includes('List Carriers'));
      assert.ok(names.includes('Create Carrier'));
    });
  });

  describe('sort by name', () => {
    it('sorts folders and requests alphabetically', () => {
      const col = makeCollection([
        makeFolder('Zebra', [
          makeRequest('Zulu', 'GET', '/zulu'),
          makeRequest('Alpha', 'GET', '/alpha'),
        ]),
        makeFolder('Alpha', [makeRequest('Test', 'GET', '/test')]),
      ]);
      const result = customizeCollection(col, { disableQueryParams: false });
      assert.equal(result.item[0].name, 'Alpha');
      assert.equal(result.item[1].name, 'Zebra');
      assert.equal(result.item[1].item[0].name, 'Alpha');
      assert.equal(result.item[1].item[1].name, 'Zulu');
    });

    it('does not sort when sortByName is false', () => {
      const col = makeCollection([
        makeFolder('Zebra', [makeRequest('Z', 'GET', '/z')]),
        makeFolder('Alpha', [makeRequest('A', 'GET', '/a')]),
      ]);
      const result = customizeCollection(col, { sortByName: false, disableQueryParams: false });
      assert.equal(result.item[0].name, 'Zebra');
      assert.equal(result.item[1].name, 'Alpha');
    });
  });

  describe('additional variables', () => {
    it('adds collection variables', () => {
      const col = makeCollection([]);
      const result = customizeCollection(col, {
        additionalVariables: [
          { key: 'orgId', value: 'abc-123', type: 'string' },
        ],
        disableQueryParams: false,
      });
      assert.ok(result.variable.find(v => v.key === 'orgId'));
    });
  });
});
