/**
 * OpenAPI to Postman Collection Converter
 *
 * Converts OpenAPI specs (YAML/JSON) to Postman Collection v2.1 format.
 *
 * Attempts to use the `openapi-to-postmanv2` library if available (npm install),
 * otherwise falls back to a built-in converter.
 */
import { createRequire } from 'node:module';
import { parseYaml } from './yaml-parser.js';

// Eagerly try to load openapi-to-postmanv2
let _npmConverter = null;
try {
  const require = createRequire(import.meta.url);
  _npmConverter = require('openapi-to-postmanv2');
} catch {
  // Not installed
}

/**
 * Convert an OpenAPI spec string (YAML or JSON) to a Postman Collection v2.1 object.
 * @param {string} specContent - The OpenAPI spec as a string (YAML or JSON)
 * @param {string} specName - A human-readable name for this spec
 * @returns {Promise<Object>} - Postman Collection v2.1 object
 */
export async function convertToPostman(specContent, specName) {
  // Parse the spec (needed for built-in converter and route counting)
  let spec;
  try {
    spec = JSON.parse(specContent);
  } catch {
    spec = parseYaml(specContent);
  }

  // Count routes in the spec for validation
  const specRouteCount = countSpecRoutes(spec);
  console.log(`  Spec contains ${specRouteCount} route(s)`);

  // Try the npm converter first
  if (_npmConverter) {
    console.log('  Using openapi-to-postmanv2 library for conversion');
    const collection = await convertWithNpmLib(_npmConverter, specContent, specName);
    const collectionRouteCount = countCollectionRoutes(collection);
    console.log(`  Collection contains ${collectionRouteCount} request(s)`);

    if (collectionRouteCount < specRouteCount) {
      console.warn(`  ⚠ Warning: ${specRouteCount - collectionRouteCount} route(s) may have been lost during conversion`);
    }

    return collection;
  }

  // Fall back to built-in converter
  console.log('  Using built-in converter (install openapi-to-postmanv2 for richer conversion)');
  const collection = convertBuiltIn(spec, specName);
  const collectionRouteCount = countCollectionRoutes(collection);
  console.log(`  Collection contains ${collectionRouteCount} request(s)`);

  if (collectionRouteCount < specRouteCount) {
    console.warn(`  ⚠ Warning: ${specRouteCount - collectionRouteCount} route(s) may have been lost during conversion`);
  }

  return collection;
}

/**
 * Count routes in an OpenAPI spec.
 */
function countSpecRoutes(spec) {
  let count = 0;
  const paths = spec?.paths || {};
  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

  for (const methods of Object.values(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const method of Object.keys(methods)) {
      if (httpMethods.has(method.toLowerCase())) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Count requests in a Postman collection (recursively).
 */
function countCollectionRoutes(collection) {
  let count = 0;
  function walk(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.item) {
        walk(item.item);
      } else if (item.request) {
        count++;
      }
    }
  }
  walk(collection.item || []);
  return count;
}

/**
 * Convert using the openapi-to-postmanv2 npm library.
 */
function convertWithNpmLib(converter, specContent, specName) {
  return new Promise((resolve, reject) => {
    const options = {
      type: 'string',
      data: specContent,
    };

    const conversionOptions = {
      folderStrategy: 'Tags',
      schemaFaker: true,
      requestParametersResolution: 'Schema',
      exampleParametersResolution: 'Schema',
      optimizeConversion: true,
      stackLimit: 50,
    };

    converter.convert(options, conversionOptions, (err, result) => {
      if (err) {
        reject(new Error(`Conversion failed: ${err.message || err}`));
        return;
      }

      if (!result.result) {
        reject(new Error(`Conversion failed: ${result.reason}`));
        return;
      }

      const collection = result.output[0].data;
      resolve(collection);
    });
  });
}

/**
 * Built-in converter: transforms an OpenAPI spec object into Postman Collection v2.1 format.
 */
function convertBuiltIn(spec, specName) {
  const info = spec.info || {};
  const servers = spec.servers || [];
  const paths = spec.paths || {};

  const baseUrl = servers.length > 0 ? servers[0].url : 'http://localhost:4000';
  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

  // Group endpoints by tag
  const taggedEndpoints = {};
  const untagged = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    // Extract path-level parameters (shared by all methods on this path)
    const pathLevelParams = resolveArray(pathItem.parameters || [], spec);

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method.toLowerCase())) continue;

      // Resolve $ref if the operation itself is a reference
      const resolvedOp = operation.$ref ? resolveRef(operation.$ref, spec) : operation;
      if (!resolvedOp) continue;

      // Merge path-level params with operation-level params.
      // Operation params override path-level params with the same name+in.
      const opParams = resolveArray(resolvedOp.parameters || [], spec);
      const mergedParams = mergeParameters(pathLevelParams, opParams);

      const endpoint = buildPostmanRequest(method, path, { ...resolvedOp, parameters: mergedParams }, baseUrl, spec);
      const tags = resolvedOp.tags || [];

      if (tags.length === 0) {
        untagged.push(endpoint);
      } else {
        for (const tag of tags) {
          if (!taggedEndpoints[tag]) taggedEndpoints[tag] = [];
          taggedEndpoints[tag].push(endpoint);
        }
      }
    }
  }

  const folders = Object.entries(taggedEndpoints)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, items]) => ({ name: tag, item: items }));

  if (untagged.length > 0) {
    folders.push({ name: 'Untagged', item: untagged });
  }

  return {
    info: {
      name: specName || info.title || 'API Collection',
      description: info.description || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: folders,
    variable: [{ key: 'baseUrl', value: baseUrl, type: 'string' }],
  };
}

// ── $ref Resolution ──

/**
 * Resolve a $ref string to the referenced object in the spec.
 * Handles JSON Pointer format: "#/components/schemas/Foo"
 */
function resolveRef(ref, spec) {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.replace('#/', '').split('/');
  let current = spec;
  for (const part of parts) {
    current = current?.[part];
    if (current === undefined) return null;
  }
  return current;
}

/**
 * Resolve an array of items that may contain $ref objects.
 */
function resolveArray(arr, spec) {
  return arr.map(item => {
    if (item.$ref) {
      return resolveRef(item.$ref, spec) || item;
    }
    return item;
  });
}

/**
 * Merge path-level and operation-level parameters.
 * Operation params override path params with the same name+in combination.
 */
function mergeParameters(pathParams, opParams) {
  const opKeys = new Set(opParams.map(p => `${p.name}:${p.in}`));
  const fromPath = pathParams.filter(p => !opKeys.has(`${p.name}:${p.in}`));
  return [...fromPath, ...opParams];
}

// ── Request Building ──

function buildPostmanRequest(method, path, operation, baseUrl, spec) {
  const postmanPath = path.replace(/\{(\w+)\}/g, ':$1');

  const params = operation.parameters || [];

  const queryParams = params
    .filter(p => p.in === 'query')
    .map(p => ({
      key: p.name,
      value: getExampleValue(p.schema ? (p.schema.$ref ? resolveRef(p.schema.$ref, spec) : p.schema) : null, p.name),
      description: p.description || '',
      disabled: true,
    }));

  const pathVars = params
    .filter(p => p.in === 'path')
    .map(p => ({
      key: p.name,
      value: getExampleValue(p.schema ? (p.schema.$ref ? resolveRef(p.schema.$ref, spec) : p.schema) : null, p.name),
      description: p.description || '',
    }));

  const headers = params
    .filter(p => p.in === 'header')
    .map(p => ({
      key: p.name,
      value: getExampleValue(p.schema ? (p.schema.$ref ? resolveRef(p.schema.$ref, spec) : p.schema) : null, p.name),
      description: p.description || '',
    }));

  const hasBody = operation.requestBody != null;
  if (hasBody) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }

  let body = undefined;
  if (hasBody && operation.requestBody) {
    const reqBody = operation.requestBody.$ref
      ? resolveRef(operation.requestBody.$ref, spec)
      : operation.requestBody;

    if (reqBody) {
      const content = reqBody.content || {};
      const jsonContent = content['application/json'];
      if (jsonContent && jsonContent.schema) {
        const exampleBody = generateExampleFromSchema(jsonContent.schema, spec);
        body = {
          mode: 'raw',
          raw: JSON.stringify(exampleBody, null, 2),
          options: { raw: { language: 'json' } },
        };
      }
    }
  }

  const urlParts = postmanPath.split('/').filter(Boolean);

  return {
    name: operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`,
    request: {
      method: method.toUpperCase(),
      header: headers,
      body,
      url: {
        raw: `{{baseUrl}}${postmanPath}${queryParams.length > 0 ? '?' + queryParams.map(q => `${q.key}=${q.value}`).join('&') : ''}`,
        host: ['{{baseUrl}}'],
        path: urlParts,
        query: queryParams,
        variable: pathVars,
      },
      description: operation.description || '',
    },
    response: [],
  };
}

// ── Schema Examples ──

function getExampleValue(schema, name) {
  if (!schema) return '';
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);

  switch (schema.type) {
    case 'integer': return '1';
    case 'number': return '0.0';
    case 'boolean': return 'true';
    case 'string':
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      if (schema.format === 'date') return '2024-01-01';
      if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
      if (schema.format === 'email') return 'user@example.com';
      if (name && name.toLowerCase().includes('id')) return 'example-id';
      return 'string';
    default:
      return '';
  }
}

function generateExampleFromSchema(schema, spec, depth = 0) {
  if (depth > 8) return {};

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    if (resolved) return generateExampleFromSchema(resolved, spec, depth + 1);
    return {};
  }

  // Handle allOf — merge all sub-schemas
  if (schema.allOf) {
    const merged = {};
    for (const sub of schema.allOf) {
      const resolved = sub.$ref ? resolveRef(sub.$ref, spec) : sub;
      if (resolved) {
        const example = generateExampleFromSchema(resolved, spec, depth + 1);
        if (typeof example === 'object' && !Array.isArray(example)) {
          Object.assign(merged, example);
        }
      }
    }
    return merged;
  }

  // Handle oneOf / anyOf — use the first option
  if (schema.oneOf || schema.anyOf) {
    const options = schema.oneOf || schema.anyOf;
    if (options.length > 0) {
      const first = options[0].$ref ? resolveRef(options[0].$ref, spec) : options[0];
      if (first) return generateExampleFromSchema(first, spec, depth + 1);
    }
    return {};
  }

  if (schema.example !== undefined) return schema.example;

  switch (schema.type) {
    case 'object': {
      const obj = {};
      const props = schema.properties || {};
      for (const [key, propSchema] of Object.entries(props)) {
        obj[key] = generateExampleFromSchema(propSchema, spec, depth + 1);
      }
      return obj;
    }
    case 'array': {
      const itemExample = schema.items
        ? generateExampleFromSchema(schema.items, spec, depth + 1)
        : {};
      return [itemExample];
    }
    case 'string': return getExampleValue(schema, '');
    case 'integer': return 1;
    case 'number': return 0.0;
    case 'boolean': return true;
    default:
      // If no type but has properties, treat as object
      if (schema.properties) {
        const obj = {};
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          obj[key] = generateExampleFromSchema(propSchema, spec, depth + 1);
        }
        return obj;
      }
      return {};
  }
}
