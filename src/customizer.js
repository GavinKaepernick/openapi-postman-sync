/**
 * Postman Collection Customizer
 *
 * Applies configuration-based modifications to a Postman Collection v2.1 object.
 * Supports: disabling query params, organizing by name, renaming, folder restructuring,
 * adding auth headers, and more.
 */

/**
 * @typedef {Object} CustomizationConfig
 * @property {boolean} disableQueryParams - Turn all query params off by default
 * @property {boolean} sortByName - Sort folders and requests alphabetically
 * @property {string} [collectionName] - Override the collection name
 * @property {string} [collectionDescription] - Override the collection description
 * @property {Object} [auth] - Authentication config to apply
 * @property {string} auth.type - Auth type (e.g., 'bearer', 'apikey', 'basic')
 * @property {string} [auth.tokenVariable] - Variable name for bearer token
 * @property {string} [auth.keyName] - Header/query param name for API key
 * @property {string} [auth.keyVariable] - Variable name for API key value
 * @property {Object} [folderOverrides] - Map of tag name to custom folder name
 * @property {string[]} [excludeTags] - Tags/folders to exclude from output
 * @property {string[]} [excludePaths] - Path patterns to exclude (supports * wildcard)
 * @property {Object[]} [additionalVariables] - Extra collection variables to add
 * @property {Object} [headerDefaults] - Default headers to add to all requests
 */

/**
 * Apply all customizations from config to a Postman collection.
 * @param {Object} collection - Postman Collection v2.1 object
 * @param {CustomizationConfig} config - Customization configuration
 * @param {Object} [openApiSpec] - Parsed OpenAPI spec for enriching param defaults
 * @returns {Object} - Modified Postman collection
 */
export function customizeCollection(collection, config = {}, openApiSpec = null) {
  let result = structuredClone(collection);

  // Override collection metadata
  if (config.collectionName) {
    result.info.name = config.collectionName;
  }
  if (config.collectionDescription) {
    result.info.description = config.collectionDescription;
  }

  // Apply auth at collection level
  if (config.auth) {
    result.auth = buildAuth(config.auth);
  }

  // Add default headers to all requests
  if (config.headerDefaults) {
    result.item = applyToAllRequests(result.item, (request) => {
      for (const [key, value] of Object.entries(config.headerDefaults)) {
        const existing = request.header?.find(h => h.key === key);
        if (!existing) {
          if (!request.header) request.header = [];
          request.header.push({ key, value, type: 'text' });
        }
      }
      return request;
    });
  }

  // Exclude paths
  if (config.excludePaths && config.excludePaths.length > 0) {
    result.item = filterByPaths(result.item, config.excludePaths);
  }

  // Exclude tags/folders
  if (config.excludeTags && config.excludeTags.length > 0) {
    result.item = result.item.filter(folder =>
      !config.excludeTags.includes(folder.name)
    );
  }

  // Rename folders based on overrides
  if (config.folderOverrides) {
    result.item = result.item.map(folder => {
      if (config.folderOverrides[folder.name]) {
        return { ...folder, name: config.folderOverrides[folder.name] };
      }
      return folder;
    });
  }

  // Enrich query param values from the OpenAPI spec and disable by default
  if (config.disableQueryParams !== false) {
    // Build a lookup of spec params by path+method for enrichment
    const specParamLookup = openApiSpec ? buildSpecParamLookup(openApiSpec) : null;

    result.item = applyToAllRequests(result.item, (request) => {
      if (request.url && request.url.query) {
        const requestPath = extractPath(request.url);
        const method = (request.method || 'get').toLowerCase();
        const specParams = specParamLookup?.[`${method}:${requestPath}`] || {};

        request.url.query = request.url.query.map(param => {
          const enriched = { ...param, disabled: true };

          // If the param has no value or a generic placeholder, try the spec
          if (specParams[param.key] && (!param.value || param.value === '<string>' || param.value === '')) {
            const sp = specParams[param.key];
            enriched.value = sp.value;
            if (sp.description && !enriched.description) {
              enriched.description = sp.description;
            }
          }

          return enriched;
        });
      }
      return request;
    });
  }

  // Deduplicate request names within each folder
  result.item = deduplicateNames(result.item);

  // Sort by name
  if (config.sortByName !== false) {
    result.item = sortCollectionItems(result.item);
  }

  // Add additional variables
  if (config.additionalVariables) {
    if (!result.variable) result.variable = [];
    result.variable.push(...config.additionalVariables);
  }

  return result;
}

/**
 * Deduplicate request names within each folder.
 *
 * When multiple requests in the same folder share a name (e.g., two "Update Carrier"
 * from PUT vs PATCH, or "List Parcels" from public vs internal endpoints), this
 * disambiguates them by appending context from the HTTP method and path.
 *
 * Strategy:
 * 1. Find all name collisions within a folder
 * 2. For collisions, try appending the HTTP method (e.g., "Update Carrier (PUT)")
 * 3. If still not unique, append a path hint (e.g., "List Parcels (GET /public/v1/...)")
 */
function deduplicateNames(items) {
  return items.map(item => {
    if (!item.item) return item; // Not a folder

    // Recursively deduplicate nested folders
    const children = deduplicateNames(item.item);

    // Count name occurrences
    const nameCounts = {};
    for (const child of children) {
      if (!child.request) continue;
      const name = child.name || '';
      nameCounts[name] = (nameCounts[name] || 0) + 1;
    }

    // Find which names have duplicates
    const dupeNames = new Set(
      Object.entries(nameCounts).filter(([, c]) => c > 1).map(([n]) => n)
    );

    if (dupeNames.size === 0) return { ...item, item: children };

    // Disambiguate
    const renamed = children.map(child => {
      if (!child.request || !dupeNames.has(child.name)) return child;

      const method = child.request.method || '';
      const path = extractPathForName(child.request.url);

      // First try: "Name (METHOD)"
      let newName = `${child.name} (${method})`;

      // Check if method alone is enough by looking ahead
      const sameNameAndMethod = children.filter(c =>
        c.request && c.name === child.name && c.request.method === method
      );

      if (sameNameAndMethod.length > 1 && path) {
        // Method alone isn't unique — add a path hint
        newName = `${child.name} (${method} ${path})`;
      }

      return { ...child, name: newName };
    });

    return { ...item, item: renamed };
  });
}

/**
 * Extract a short, readable path hint for name disambiguation.
 * Turns "/v1/shippers/:shipper_id/parcels/:id" into "/v1/.../parcels/:id"
 * and "/public/v1/organizations/:org_id/shippers/:sid/parcels" into "/public/v1/.../parcels"
 */
function extractPathForName(url) {
  let path = extractPath(url);
  if (!path) return null;

  // Remove variable segments that add noise
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 3) return path;

  // Keep first segment (e.g., "v1" or "public") and last 2 meaningful segments
  const first = parts[0];
  const meaningful = parts.filter(p => !p.startsWith(':'));
  const last = meaningful.slice(-2).join('/');

  if (first === meaningful[0]) {
    return `/${first}/.../${last}`;
  }
  return `/${first}/${parts[1]}/.../${last}`;
}

/**
 * Build a Postman auth object from config.
 */
function buildAuth(authConfig) {
  switch (authConfig.type) {
    case 'bearer':
      return {
        type: 'bearer',
        bearer: [
          {
            key: 'token',
            value: `{{${authConfig.tokenVariable || 'bearerToken'}}}`,
            type: 'string',
          },
        ],
      };
    case 'apikey':
      return {
        type: 'apikey',
        apikey: [
          {
            key: 'key',
            value: authConfig.keyName || 'X-API-Key',
            type: 'string',
          },
          {
            key: 'value',
            value: `{{${authConfig.keyVariable || 'apiKey'}}}`,
            type: 'string',
          },
          {
            key: 'in',
            value: 'header',
            type: 'string',
          },
        ],
      };
    case 'basic':
      return {
        type: 'basic',
        basic: [
          {
            key: 'username',
            value: `{{${authConfig.usernameVariable || 'username'}}}`,
            type: 'string',
          },
          {
            key: 'password',
            value: `{{${authConfig.passwordVariable || 'password'}}}`,
            type: 'string',
          },
        ],
      };
    default:
      return { type: 'noauth' };
  }
}

/**
 * Build a lookup of query param defaults from an OpenAPI spec.
 * Returns { "get:/v1/parcels": { "page": { value: "1", description: "..." }, ... } }
 */
function buildSpecParamLookup(spec) {
  const lookup = {};
  const paths = spec?.paths || {};
  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    // Path-level parameters
    const pathParams = (pathItem.parameters || []).map(p =>
      p.$ref ? resolveSpecRef(p.$ref, spec) : p
    ).filter(Boolean);

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;

      const resolvedOp = operation.$ref ? resolveSpecRef(operation.$ref, spec) : operation;
      if (!resolvedOp) continue;

      const opParams = (resolvedOp.parameters || []).map(p =>
        p.$ref ? resolveSpecRef(p.$ref, spec) : p
      ).filter(Boolean);

      // Merge: operation params override path params
      const opKeys = new Set(opParams.map(p => `${p.name}:${p.in}`));
      const merged = [
        ...pathParams.filter(p => !opKeys.has(`${p.name}:${p.in}`)),
        ...opParams,
      ];

      const postmanPath = path.replace(/\{(\w+)\}/g, ':$1');
      const key = `${method}:${postmanPath}`;
      lookup[key] = {};

      for (const p of merged) {
        if (p.in !== 'query') continue;

        const schema = p.schema
          ? (p.schema.$ref ? resolveSpecRef(p.schema.$ref, spec) : p.schema)
          : null;

        // Best value: param example > param examples > schema default > schema example > schema enum > type fallback
        let value = '';
        if (p.example !== undefined) {
          value = String(p.example);
        } else if (p.examples) {
          const firstKey = Object.keys(p.examples)[0];
          if (firstKey) {
            const ex = p.examples[firstKey]?.$ref
              ? resolveSpecRef(p.examples[firstKey].$ref, spec)
              : p.examples[firstKey];
            if (ex?.value !== undefined) value = String(ex.value);
          }
        } else if (schema?.default !== undefined) {
          value = String(schema.default);
        } else if (schema?.example !== undefined) {
          value = String(schema.example);
        } else if (schema?.enum?.length > 0) {
          value = String(schema.enum[0]);
        } else if (schema?.type) {
          value = getTypeFallback(schema, p.name);
        }

        // Build description
        const descParts = [];
        if (p.description) descParts.push(p.description);
        if (schema?.enum?.length > 0) descParts.push(`Allowed: ${schema.enum.join(', ')}`);
        if (p.required) descParts.push('Required');

        lookup[key][p.name] = {
          value,
          description: descParts.join(' | '),
        };
      }
    }
  }

  return lookup;
}

/**
 * Resolve a $ref in the spec.
 */
function resolveSpecRef(ref, spec) {
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
 * Generate a type-based fallback value for a query param.
 */
function getTypeFallback(schema, name) {
  switch (schema.type) {
    case 'integer': return '1';
    case 'number': return '0.0';
    case 'boolean': return 'true';
    case 'string':
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      if (schema.format === 'date') return '2024-01-01';
      if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
      if (schema.format === 'email') return 'user@example.com';
      if (name?.toLowerCase().includes('id')) return 'example-id';
      return '';
    case 'array':
      return '';
    default:
      return '';
  }
}

/**
 * Recursively apply a transform function to all request objects in a collection.
 */
function applyToAllRequests(items, transform) {
  return items.map(item => {
    if (item.item) {
      // This is a folder
      return {
        ...item,
        item: applyToAllRequests(item.item, transform),
      };
    }

    if (item.request) {
      // This is a request
      return {
        ...item,
        request: transform(structuredClone(item.request)),
      };
    }

    return item;
  });
}

/**
 * Recursively sort collection items (folders and requests) by name.
 */
function sortCollectionItems(items) {
  return items
    .map(item => {
      if (item.item) {
        return { ...item, item: sortCollectionItems(item.item) };
      }
      return item;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * Filter out requests matching excluded path patterns.
 * Supports * wildcard in patterns.
 *
 * Handles URL formats from both:
 * - Built-in converter: url.raw = "{{baseUrl}}/v1/carriers"
 * - openapi-to-postmanv2: url.raw or url.path array ["v1", "carriers"]
 */
function filterByPaths(items, excludePatterns) {
  // Pre-compile regexes for performance
  const regexes = excludePatterns.map(pattern =>
    new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  );

  return items
    .map(item => {
      if (item.item) {
        const filtered = filterByPaths(item.item, excludePatterns);
        if (filtered.length === 0) return null;
        return { ...item, item: filtered };
      }

      if (item.request && item.request.url) {
        const path = extractPath(item.request.url);
        if (path) {
          const shouldExclude = regexes.some(regex => regex.test(path));
          if (shouldExclude) return null;
        }
      }

      return item;
    })
    .filter(Boolean);
}

/**
 * Extract the path from a Postman URL object, handling multiple formats.
 */
function extractPath(url) {
  if (typeof url === 'string') {
    // Plain string URL
    return url.replace(/^https?:\/\/[^/]+/, '').replace(/\{\{[^}]+\}\}/, '').split('?')[0];
  }

  // Try raw URL first
  if (url.raw) {
    const raw = url.raw;
    // Remove baseUrl variable and query string
    return raw
      .replace(/\{\{baseUrl\}\}/, '')
      .replace(/^https?:\/\/[^/]+/, '')
      .split('?')[0];
  }

  // Reconstruct from path array (openapi-to-postmanv2 format)
  if (Array.isArray(url.path)) {
    const pathParts = url.path.map(p => {
      if (typeof p === 'string') return p;
      if (p && p.value) return p.value;
      return String(p);
    });
    return '/' + pathParts.join('/');
  }

  return null;
}
