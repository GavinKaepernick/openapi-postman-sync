/**
 * YAML/JSON Spec Loader
 *
 * Tries multiple strategies to parse an OpenAPI spec:
 * 1. JSON.parse (if the file is JSON)
 * 2. js-yaml (npm dependency — the reliable path for YAML)
 * 3. Shelling out to a bundled Python/Ruby yaml-to-json converter
 * 4. Last resort: built-in minimal parser (with loud warnings)
 *
 * The built-in parser is intentionally limited. If you're seeing missing routes,
 * install js-yaml: `npm install js-yaml`
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Eagerly try to load js-yaml at module init
let _jsYaml = null;
try {
  const require = createRequire(import.meta.url);
  _jsYaml = require('js-yaml');
} catch {
  // Not installed — will try other strategies
}

/**
 * Parse a YAML or JSON string into a JavaScript object.
 * Uses the best available strategy.
 */
export function parseYaml(text) {
  // Strategy 1: Maybe it's actually JSON
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON, continue
  }

  // Strategy 2: js-yaml (preferred for YAML)
  if (_jsYaml) {
    try {
      return _jsYaml.load(text);
    } catch (err) {
      console.warn(`  ⚠ js-yaml failed: ${err.message}`);
    }
  }

  // Strategy 3: Shell out to python3 or ruby for YAML→JSON conversion
  try {
    const json = yamlToJsonViaShell(text);
    if (json) return json;
  } catch {
    // Continue to fallback
  }

  // Strategy 4: Built-in parser (last resort)
  console.warn('');
  console.warn('  ╔══════════════════════════════════════════════════════════════╗');
  console.warn('  ║  WARNING: Using fallback YAML parser.                       ║');
  console.warn('  ║  This parser has known limitations that may cause missing    ║');
  console.warn('  ║  routes. For reliable results, install js-yaml:             ║');
  console.warn('  ║                                                              ║');
  console.warn('  ║    npm install js-yaml                                       ║');
  console.warn('  ║                                                              ║');
  console.warn('  ║  Or ensure python3 is available on PATH.                    ║');
  console.warn('  ╚══════════════════════════════════════════════════════════════╝');
  console.warn('');

  return fallbackParseYaml(text);
}

/**
 * Convert YAML to JSON by shelling out to python3 or ruby.
 */
function yamlToJsonViaShell(text) {
  // Try python3 first (most commonly available)
  try {
    const result = execSync(
      `python3 -c "import sys, yaml, json; json.dump(yaml.safe_load(sys.stdin.read()), sys.stdout)"`,
      {
        input: text,
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return JSON.parse(result);
  } catch {
    // python3 not available or failed
  }

  // Try ruby
  try {
    const result = execSync(
      `ruby -ryaml -rjson -e "puts JSON.dump(YAML.safe_load(STDIN.read))"`,
      {
        input: text,
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return JSON.parse(result);
  } catch {
    // ruby not available or failed
  }

  return null;
}

/**
 * Fallback YAML parser — handles basic YAML but has known limitations:
 *
 * LIMITATIONS (routes may be lost):
 * - No $ref resolution
 * - No YAML anchors (&) or aliases (*)
 * - No flow mappings ({key: value}) or flow sequences ([a, b])
 * - Colons inside string values can confuse key detection
 * - Multiline strings may not parse correctly in all cases
 *
 * Use js-yaml or python3 for reliable parsing.
 */
export function fallbackParseYaml(text) {
  const lines = text.split('\n');
  return parseBlock(lines, 0, -1).value;
}

function parseBlock(lines, startIdx, parentIndent) {
  const result = {};
  let i = startIdx;
  let isArray = null;
  let arrayResult = [];

  while (i < lines.length) {
    const rawLine = lines[i];

    // Strip inline comments (but not # inside quotes)
    const stripped = stripComment(rawLine);

    if (stripped.trim() === '') {
      i++;
      continue;
    }

    const indent = rawLine.search(/\S/);

    if (indent <= parentIndent) {
      break;
    }

    const trimmed = stripped.trim();

    // Array items
    if (trimmed.startsWith('- ')) {
      if (isArray === null) isArray = true;
      const itemContent = trimmed.slice(2).trim();

      if (isMapping(itemContent)) {
        const obj = parseInlineMapping(itemContent);
        // Check for continuation lines
        let j = i + 1;
        while (j < lines.length) {
          const nextRaw = lines[j];
          const nextStripped = stripComment(nextRaw);
          if (nextStripped.trim() === '') { j++; continue; }
          const nextIndent = nextRaw.search(/\S/);
          if (nextIndent <= indent) break;
          const nextTrimmed = nextStripped.trim();
          if (isMapping(nextTrimmed)) {
            const { key, value: rawVal } = splitMapping(nextTrimmed);
            if (rawVal === '' || rawVal === '|' || rawVal === '>' || rawVal === '|-' || rawVal === '>-') {
              const sub = parseBlock(lines, j + 1, nextIndent);
              obj[key] = (rawVal === '' ? sub.value : collectMultiline(lines, j + 1, nextIndent));
              j = sub.nextIndex;
            } else {
              obj[key] = parseScalar(rawVal);
              j++;
            }
          } else {
            j++;
          }
        }
        arrayResult.push(obj);
        i = j;
      } else {
        arrayResult.push(parseScalar(itemContent));
        i++;
      }
      continue;
    }

    // Mapping entries
    if (isMapping(trimmed)) {
      if (isArray === null) isArray = false;
      const { key, value: rawVal } = splitMapping(trimmed);

      if (rawVal === '' || rawVal === '|' || rawVal === '>' || rawVal === '|-' || rawVal === '>-') {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;

        if (j < lines.length && lines[j].search(/\S/) > indent) {
          if (rawVal.startsWith('|') || rawVal.startsWith('>')) {
            result[key] = collectMultiline(lines, j, indent);
            let k = j;
            while (k < lines.length) {
              if (lines[k].trim() === '') { k++; continue; }
              if (lines[k].search(/\S/) <= indent) break;
              k++;
            }
            i = k;
          } else {
            const sub = parseBlock(lines, j, indent);
            result[key] = sub.value;
            i = sub.nextIndex;
          }
        } else {
          result[key] = null;
          i++;
        }
      } else {
        result[key] = parseScalar(rawVal);
        i++;
      }
      continue;
    }

    i++;
  }

  return { value: isArray ? arrayResult : result, nextIndex: i };
}

/**
 * Determine if a string looks like a YAML mapping (key: value).
 * Careful to avoid matching colons inside quoted strings.
 */
function isMapping(str) {
  // Skip if it starts with a quote (it's a scalar)
  if (str.startsWith('"') || str.startsWith("'")) return false;

  // Find the first colon that's followed by a space or end-of-string,
  // but not inside quotes
  const colonIdx = findMappingColon(str);
  return colonIdx > 0;
}

/**
 * Find the index of the mapping colon (key: value separator).
 * Returns -1 if not found. Skips colons inside quoted strings.
 */
function findMappingColon(str) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === ':' && !inSingleQuote && !inDoubleQuote) {
      // Colon must be followed by space or end-of-string to be a mapping separator
      if (i + 1 >= str.length || str[i + 1] === ' ') {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Split a mapping string into key and value.
 */
function splitMapping(str) {
  const colonIdx = findMappingColon(str);
  const key = str.slice(0, colonIdx).trim();
  const value = str.slice(colonIdx + 1).trim();
  return { key, value };
}

/**
 * Parse inline mapping from an array item "- key: value"
 */
function parseInlineMapping(str) {
  const { key, value } = splitMapping(str);
  const obj = {};
  obj[key] = parseScalar(value);
  return obj;
}

/**
 * Strip inline comments, being careful about # inside quoted strings and URLs.
 */
function stripComment(line) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === '#' && !inSingleQuote && !inDoubleQuote) {
      // Only treat as comment if preceded by whitespace
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') {
        return line.slice(0, i).trimEnd();
      }
    }
  }

  return line;
}

function collectMultiline(lines, startIdx, parentIndent) {
  const collected = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { collected.push(''); i++; continue; }
    if (line.search(/\S/) <= parentIndent) break;
    collected.push(line.trim());
    i++;
  }
  return collected.join('\n');
}

function parseScalar(str) {
  if (str === '' || str === 'null' || str === 'Null' || str === '~') return null;
  if (str === 'true' || str === 'True') return true;
  if (str === 'false' || str === 'False') return false;

  // Quoted strings — preserve content exactly
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }

  // Numbers
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);

  // Inline arrays [a, b, c] — basic support
  if (str.startsWith('[') && str.endsWith(']')) {
    const inner = str.slice(1, -1);
    if (inner.trim() === '') return [];
    return splitRespectingQuotes(inner).map(s => parseScalar(s.trim()));
  }

  return str;
}

/**
 * Split a string by commas, respecting quoted strings.
 */
function splitRespectingQuotes(str) {
  const parts = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (const ch of str) {
    if (ch === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; }
    else if (ch === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; }
    else if (ch === ',' && !inSingleQuote && !inDoubleQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}
