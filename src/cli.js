/**
 * Interactive CLI for generate_postman_collection
 *
 * Smart wizard that:
 * 1. Takes a repo path and auto-detects specs from mix.exs
 * 2. Asks focused questions with examples
 * 3. Uses standardized paths for configs, output, and environments
 */
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseMixExs, printDetectedInfo } from './mix-parser.js';
import { c, separator, stepHeader } from './colors.js';

let rl = null;

function ensureReadline() {
  if (!rl) {
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

function ask(question) {
  return new Promise((resolve) => {
    ensureReadline().question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function close() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/**
 * Display a styled header.
 */
function header() {
  const line = c.dim('─'.repeat(60));
  console.log('');
  console.log(line);
  console.log(c.cyan(`
  ____           _
 |  _ \\ ___  ___| |_ _ __ ___   __ _ _ __
 | |_) / _ \\/ __| __| '_ \` _ \\ / _\` | '_ \\
 |  __/ (_) \\__ \\ |_| | | | | | (_| | | | |
 |_|   \\___/|___/\\__|_| |_| |_|\\__,_|_| |_|
   ____      _ _           _   _
  / ___|___ | | | ___  ___| |_(_) ___  _ __
 | |   / _ \\| | |/ _ \\/ __| __| |/ _ \\| '_ \\
 | |__| (_) | | |  __/ (__| |_| | (_) | | | |
  \\____\\___/|_|_|\\___|\\___|\\___|_|\\___/|_| |_|
   ____                           _
  / ___| ___ _ __   ___ _ __ __ _| |_ ___  _ __
 | |  _ / _ \\ '_ \\ / _ \\ '__/ _\` | __/ _ \\| '__|
 | |_| |  __/ | | |  __/ | | (_| | || (_) | |
  \\____|\\___|_| |_|\\___|_|  \\__,_|\\__\\___/|_|
`));
  console.log(`  ${c.dim('v1.0.0')}  ${c.dim('·')}  ${c.dim('OpenAPI → Postman')}`);
  console.log(line);
}

/**
 * Display a numbered menu and return the selected option.
 */
async function menu(prompt, options) {
  console.log(`\n  ${c.bold(prompt)}\n`);
  options.forEach((opt, i) => {
    console.log(`    ${c.cyan(`${i + 1})`)} ${opt}`);
  });
  console.log('');

  while (true) {
    const answer = await ask(`  ${c.yellow('→')} Choice (1-${options.length}): `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      return num - 1;
    }
    console.log(`  ${c.red('Please enter a number between 1 and ' + options.length)}`);
  }
}

/**
 * Display a multi-select menu and return selected indices.
 */
async function multiSelect(prompt, options) {
  console.log(`\n  ${c.bold(prompt)}\n`);
  options.forEach((opt, i) => {
    console.log(`    ${c.cyan(`${i + 1})`)} ${opt}`);
  });
  console.log('');

  while (true) {
    const answer = await ask(`  ${c.yellow('→')} Choice (comma-separated, or ${c.dim('"a"')} for all): `);
    if (answer.toLowerCase() === 'a') {
      return options.map((_, i) => i);
    }

    const nums = answer.split(',').map(s => parseInt(s.trim(), 10));
    if (nums.every(n => n >= 1 && n <= options.length)) {
      return nums.map(n => n - 1);
    }
    console.log(`  ${c.red('Invalid selection. Try again.')}`);
  }
}

/**
 * Ask a yes/no question. Returns true for yes.
 */
async function confirm(prompt, defaultYes = true) {
  const hint = defaultYes ? `${c.bold('Y')}/n` : `y/${c.bold('N')}`;
  const answer = await ask(`  ${c.yellow('→')} ${prompt} (${hint}): `);
  if (answer === '') return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

/**
 * Try to load an existing config for a repo name to use as defaults.
 */
function loadExistingConfig(configsDir, repoName) {
  if (!configsDir || !existsSync(configsDir)) return null;
  // Try exact match first, then fuzzy
  const candidates = [
    join(configsDir, `${repoName}.json`),
    ...readdirSync(configsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => join(configsDir, f)),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf-8'));
      } catch { /* skip */ }
    }
  }
  return null;
}

/**
 * Run the interactive setup wizard.
 * @param {Object} options
 * @param {string} options.projectRoot - Root of the openapi-postman-sync project
 * @param {string} [options.configsDir] - Path to configs directory (for loading defaults)
 * @returns {Promise<Object>} - Complete run configuration
 */
export async function runInteractiveSetup({ projectRoot, configsDir }) {
  header();

  // ── Step 1: Get repo path ──
  stepHeader('Step 1', 'Project Path');
  console.log(`  Point me at an Elixir/Phoenix project and I'll detect its`);
  console.log(`  OpenAPI spec configuration from mix.exs.\n`);

  const repoPath = await ask(`  ${c.yellow('→')} Path to Elixir project ${c.dim('(e.g., ../parcel-service)')}: `);

  if (!repoPath) {
    console.error(`\n  ${c.red('✗')} No path provided. Exiting.\n`);
    close();
    process.exit(1);
  }

  const absRepoPath = resolve(projectRoot, repoPath);

  if (!existsSync(absRepoPath)) {
    console.error(`\n  ${c.red('✗')} Path does not exist: ${absRepoPath}`);
    close();
    process.exit(1);
  }

  // ── Step 2: Parse mix.exs and show what we found ──
  stepHeader('Step 2', 'Detecting Specs');
  let mixInfo;
  try {
    mixInfo = parseMixExs(absRepoPath);
  } catch (err) {
    console.error(`\n  ${c.red('✗')} ${err.message}`);
    close();
    process.exit(1);
  }

  printDetectedInfo(mixInfo);

  if (mixInfo.specs.length === 0) {
    console.error(`  ${c.red('Cannot continue without detected specs. Exiting.')}\n`);
    close();
    process.exit(1);
  }

  // ── Step 3: Which specs to convert? ──
  separator();
  stepHeader('Step 3', 'Select Specs');
  let selectedSpecs = mixInfo.specs;

  if (mixInfo.specs.length > 1) {
    const indices = await multiSelect(
      'Which specs do you want to convert to Postman collections?',
      mixInfo.specs.map(s => `${s.label}  →  mix ${s.aliasName}  →  ${s.outputPath}`)
    );
    selectedSpecs = indices.map(i => mixInfo.specs[i]);
  } else {
    console.log(`  Using the only detected spec: ${c.green(mixInfo.specs[0].label)}`);
  }

  // ── Step 4: Generate fresh or use existing? ──
  separator();
  stepHeader('Step 4', 'Spec Generation');
  const generateFresh = await confirm(
    'Run mix commands to generate fresh specs? (choose No if specs already exist)',
    true
  );

  // ── Step 5: Collection name ──
  separator();
  stepHeader('Step 5', 'Collection Name');
  const defaultName = mixInfo.projectName;
  const collectionName = await ask(
    `  ${c.yellow('→')} Collection name ${c.dim(`(e.g., "Parcel Service API")`)} [${c.dim(defaultName)}]: `
  ) || defaultName;

  // ── Step 6: Auth configuration ──
  separator();
  stepHeader('Step 6', 'Authentication');
  const authChoice = await menu(
    'What authentication does this API use?',
    [
      'Bearer token   (e.g., Authorization: Bearer <token>)',
      'API key header  (e.g., X-API-Key: <key>)',
      'Basic auth      (e.g., username/password)',
      'None — skip auth setup',
    ]
  );

  let auth = null;
  if (authChoice === 0) {
    const tokenVar = await ask(
      `  ${c.yellow('→')} Variable name for the token ${c.dim('[bearerToken]')}: `
    ) || 'bearerToken';
    auth = { type: 'bearer', tokenVariable: tokenVar };
  } else if (authChoice === 1) {
    const keyName = await ask(
      `  ${c.yellow('→')} Header name ${c.dim('[X-API-Key]')}: `
    ) || 'X-API-Key';
    const keyVar = await ask(
      `  ${c.yellow('→')} Variable name for the key value ${c.dim('[apiKey]')}: `
    ) || 'apiKey';
    auth = { type: 'apikey', keyName, keyVariable: keyVar };
  } else if (authChoice === 2) {
    auth = { type: 'basic' };
  }

  // ── Step 7: Paths to exclude ──
  separator();
  stepHeader('Step 7', 'Path Exclusions');
  const defaultExcludes = ['/docs/*', '/internal/*', '/webhooks/*'];
  console.log(`  Default exclusions: ${c.dim(defaultExcludes.join(', '))}`);
  const customExcludes = await ask(
    `  ${c.yellow('→')} Additional paths to exclude ${c.dim('(comma-separated, or Enter to skip)')}: `
  );

  const excludePaths = [...defaultExcludes];
  if (customExcludes) {
    excludePaths.push(...customExcludes.split(',').map(s => s.trim()));
  }

  // ── Step 8: Extra collection variables ──
  separator();
  stepHeader('Step 8', 'Collection Variables');
  console.log(`  You can add variables available in Postman as ${c.cyan('{{variableName}}')}.`);
  console.log(`  Useful for IDs, tokens, or values you reuse across requests.\n`);

  const additionalVariables = [];
  const addVars = await confirm('Add collection variables? (e.g., organizationId, apiVersion)', false);

  if (addVars) {
    console.log(`\n  Enter variables one per line as ${c.dim('name=value')}. Empty line to finish.`);
    console.log(`  ${c.dim('Example: organizationId=your-org-id-here')}\n`);

    while (true) {
      const line = await ask(`  ${c.yellow('›')} `);
      if (!line) break;

      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        additionalVariables.push({ key, value, type: 'string' });
        console.log(`    ${c.green('+')} ${key} = ${c.dim(value)}`);
      } else {
        console.log(`  ${c.red('Format: name=value (e.g., organizationId=abc-123)')}`);
      }
    }
  }

  // ── Step 9: Environment selection and base URLs ──
  separator();
  stepHeader('Step 9', 'Environments');
  console.log(`  Postman environments let you switch between Local, Staging, and Production`);
  console.log(`  with a single dropdown. Select which ones you want to generate.\n`);

  // Load defaults from existing config if available
  const repoName = mixInfo.appName.replace(/_/g, '-');
  const existingConfig = loadExistingConfig(configsDir, repoName);
  const savedEnvs = existingConfig?.environments || {};

  const allEnvs = [
    { key: 'local', label: 'Local', defaultUrl: savedEnvs.local?.baseUrl || 'http://localhost:4000' },
    { key: 'staging', label: 'Staging', defaultUrl: savedEnvs.staging?.baseUrl || '' },
    { key: 'prod', label: 'Production', defaultUrl: savedEnvs.prod?.baseUrl || '' },
  ];

  const envIndices = await multiSelect(
    'Which environments do you want to generate?',
    allEnvs.map(e => `${e.label}${e.defaultUrl ? '  (saved: ' + e.defaultUrl + ')' : ''}`)
  );

  const selectedEnvs = envIndices.map(i => allEnvs[i]);

  console.log(`\n  Enter the base URL for each selected environment.\n`);

  // Determine which auth variable to include per environment
  const authVarName = auth?.tokenVariable || auth?.keyVariable || null;

  const environments = {};
  for (const env of selectedEnvs) {
    const savedDef = savedEnvs[env.key] || {};

    if (env.defaultUrl) {
      const url = await ask(
        `  ${c.yellow('→')} ${c.bold(env.label)} base URL [${c.dim(env.defaultUrl)}]: `
      ) || env.defaultUrl;
      environments[env.key] = { name: env.label, baseUrl: url, variables: savedDef.variables || {} };
    } else {
      let url = '';
      while (!url) {
        url = await ask(
          `  ${c.yellow('→')} ${c.bold(env.label)} base URL ${c.dim('(e.g., "https://api.staging.parcel.stord.com")')}: `
        );
        if (!url) console.log(`  ${c.red('A URL is required for this environment.')}`);
      }
      environments[env.key] = { name: env.label, baseUrl: url, variables: savedDef.variables || {} };
    }

    // Include auth variable placeholder in the environment (no value — user fills in Postman)
    if (authVarName) {
      environments[env.key].variables[authVarName] = '';
    }
    console.log('');
  }

  close();

  // ── Build final config ──
  const specFiles = {};
  const mixCommands = [];
  for (const spec of selectedSpecs) {
    const key = selectedSpecs.length === 1
      ? repoName
      : `${repoName}-${spec.aliasName.replace(/_/g, '-')}`;
    specFiles[key] = spec.outputPath;
    mixCommands.push(spec.mixCommand);
  }

  const config = {
    repoName,
    repoPath: absRepoPath,
    mixCommands,
    specFiles,
    generateSpecs: generateFresh,
    generateEnvironments: Object.keys(environments).length > 0,
    fileNamePrefix: repoName,
    environments,
    customization: {
      collectionName,
      disableQueryParams: true,
      sortByName: true,
      auth,
      headerDefaults: { Accept: 'application/json' },
      excludePaths,
      excludeTags: [],
      folderOverrides: {},
      additionalVariables,
    },
  };

  // Print summary
  separator();
  console.log(`\n  ${c.bold(c.green('✓ Configuration Complete'))}\n`);
  console.log(`  ${c.dim('Project:')}          ${mixInfo.projectName}`);
  console.log(`  ${c.dim('Collection name:')}  ${c.cyan(collectionName)}`);
  console.log(`  ${c.dim('Specs:')}            ${Object.keys(specFiles).join(', ')}`);
  console.log(`  ${c.dim('Generate fresh:')}   ${generateFresh ? c.green('Yes') : c.yellow('No (use existing)')}`);
  console.log(`  ${c.dim('Auth:')}             ${auth ? auth.type : 'None'}`);
  console.log(`  ${c.dim('Excluded paths:')}   ${excludePaths.join(', ')}`);
  console.log(`  ${c.dim('Variables:')}        ${additionalVariables.length > 0 ? additionalVariables.map(v => v.key).join(', ') : 'None'}`);
  if (Object.keys(environments).length > 0) {
    const envLines = Object.values(environments).map(e => `${e.name} (${c.dim(e.baseUrl)})`);
    console.log(`  ${c.dim('Environments:')}     ${envLines[0]}`);
    for (let i = 1; i < envLines.length; i++) {
      console.log(`                    ${envLines[i]}`);
    }
  } else {
    console.log(`  ${c.dim('Environments:')}     None`);
  }
  console.log('');

  return config;
}

export { close as closeCli };
