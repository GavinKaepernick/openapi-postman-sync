#!/usr/bin/env node

/**
 * openapi-postman-sync
 *
 * Main entry point. Orchestrates the full pipeline:
 * 1. Interactive CLI (auto-detects specs from mix.exs) or config-based setup
 * 2. OpenAPI spec generation (via mix commands)
 * 3. Conversion to Postman Collection v2.1
 * 4. Collection customization (disable params, sort, auth, etc.)
 * 5. Environment file generation
 * 6. Output to JSON files for Postman import
 *
 * Standardized paths:
 *   configs/       → saved repo configurations
 *   output/        → generated Postman collection + environment files
 *   environments/  → environment definitions per repo
 *
 * Usage:
 *   node src/index.js                                  # Interactive wizard
 *   node src/index.js --config parcel-service           # Use a saved config
 *   node src/index.js --config parcel-service --no-generate  # Skip spec generation
 *   node src/index.js --help
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateSpecs, readExistingSpecs } from './spec-generator.js';
import { convertToPostman } from './converter.js';
import { customizeCollection } from './customizer.js';
import { runInteractiveSetup } from './cli.js';
import { parseMixExs, printDetectedInfo } from './mix-parser.js';
import { c, separator } from './colors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Standardized paths — never asked from the user
const CONFIGS_DIR = join(PROJECT_ROOT, 'configs');
const COLLECTIONS_DIR = join(PROJECT_ROOT, 'collections');
const ENVIRONMENTS_DIR = join(PROJECT_ROOT, 'environments');

// ── CLI Argument Parsing ──

function parseArgs(argv) {
  const args = {
    config: null,
    generate: true,
    interactive: true,
    help: false,
    verbose: false,
    repoPath: null,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config':
      case '-c':
        args.config = argv[++i];
        args.interactive = false;
        break;
      case '--repo':
      case '-r':
        args.repoPath = argv[++i];
        break;
      case '--no-generate':
        args.generate = false;
        break;
      case '--non-interactive':
        args.interactive = false;
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
  generate_postman_collection — Generate Postman collections from Elixir OpenAPI specs

  Automatically detects spec generation commands and output paths from mix.exs.

  Usage:
    node src/index.js [options]

  Options:
    --config, -c <name>    Use a saved config from configs/ directory
    --repo, -r <path>      Path to Elixir project (non-interactive mode)
    --no-generate          Skip OpenAPI spec generation (use existing files)
    --non-interactive      Run without interactive prompts (requires --config)
    --verbose, -v          Show detailed output
    --help, -h             Show this help message

  Examples:
    node src/index.js                                  # Interactive wizard
    node src/index.js -c parcel-service                # Use parcel-service config
    node src/index.js -c parcel-service --no-generate  # Skip mix, use existing specs

  Output structure:
    collections/<service>/           Generated Postman collection files
    environments/<service>/          Generated Postman environment files
    configs/<name>.json              Saved repo configurations
  `);
}

// ── Environment File Generation ──

/**
 * Generate Postman environment files from config.
 * @param {string} repoName
 * @param {Object} environments - { local: { name, baseUrl }, staging: {...}, prod: {...} }
 * @param {string} outputDir
 * @param {Object} extraVars - Additional variables to include in every environment
 * @returns {string[]} - Paths to generated files
 */
function generateEnvironmentFiles(repoName, environments, outputDir, extraVars = []) {
  const savedPaths = [];

  for (const [key, envDef] of Object.entries(environments)) {
    const values = [
      { key: 'baseUrl', value: envDef.baseUrl, type: 'default', enabled: true },
      ...extraVars.map(v => ({ key: v.key, value: v.value, type: 'default', enabled: true })),
    ];

    const env = {
      id: generateId(),
      name: `${repoName} - ${envDef.name}`,
      values,
      _postman_variable_scope: 'environment',
      _postman_exported_at: new Date().toISOString(),
      _postman_exported_using: 'openapi-postman-sync',
    };

    const filename = `${repoName}_${key}.postman_environment.json`;
    const outputPath = join(outputDir, filename);
    writeFileSync(outputPath, JSON.stringify(env, null, 2), 'utf-8');
    savedPaths.push(outputPath);
    console.log(`  ${c.green('✓')} Generated environment: ${c.cyan(filename)}`);
  }

  return savedPaths;
}

function generateId() {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const segment = (len) => Array.from({ length: len }, hex).join('');
  return `${segment(8)}-${segment(4)}-${segment(4)}-${segment(4)}-${segment(12)}`;
}

// ── Config Persistence ──

/**
 * Save a run config so it can be reused with --config.
 */
function saveConfig(config) {
  if (!existsSync(CONFIGS_DIR)) {
    mkdirSync(CONFIGS_DIR, { recursive: true });
  }

  // Save a portable version (with relative repoPath)
  const portable = {
    ...config,
    repoPath: undefined,
    relativeRepoPath: config._relativeRepoPath || config.repoPath,
  };
  delete portable._relativeRepoPath;
  delete portable.generateSpecs;
  delete portable.generateEnvironments;
  delete portable.fileNamePrefix;

  const configPath = join(CONFIGS_DIR, `${config.repoName}.json`);
  writeFileSync(configPath, JSON.stringify(portable, null, 2), 'utf-8');
  console.log(`  ${c.green('✓')} Config saved: ${c.cyan(`configs/${config.repoName}.json`)}`);
  console.log(`    Reuse with: ${c.bold(`generate_postman_collection --config ${config.repoName}`)}\n`);
}

/**
 * Load a saved config and resolve paths.
 */
function loadConfig(name) {
  const configPath = join(CONFIGS_DIR, `${name}.json`);
  if (!existsSync(configPath)) {
    console.error(`\n  ${c.red('✗')} Config not found: ${configPath}`);
    if (existsSync(CONFIGS_DIR)) {
      const files = readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        console.error(`  Available configs:`);
        files.forEach(f => console.error(`    ${c.dim('-')} ${f.replace('.json', '')}`));
      }
    }
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Resolve the repo path
  if (config.relativeRepoPath) {
    config.repoPath = resolve(PROJECT_ROOT, config.relativeRepoPath);
  } else if (config.repoPath && !resolve(config.repoPath).startsWith('/')) {
    config.repoPath = resolve(PROJECT_ROOT, config.repoPath);
  }

  return config;
}

// ── Non-Interactive Config from mix.exs ──

/**
 * Build a config by auto-detecting everything from mix.exs.
 * Used with --config when loading a saved config that has a repo path.
 */
function buildConfigFromMixExs(config, args) {
  const mixInfo = parseMixExs(config.repoPath);
  printDetectedInfo(mixInfo);

  // If specFiles aren't in the saved config, detect them
  if (!config.specFiles || Object.keys(config.specFiles).length === 0) {
    const repoName = config.repoName || mixInfo.appName.replace(/_/g, '-');
    config.specFiles = {};
    config.mixCommands = [];

    for (const spec of mixInfo.specs) {
      const key = mixInfo.specs.length === 1
        ? repoName
        : `${repoName}-${spec.aliasName.replace(/_/g, '-')}`;
      config.specFiles[key] = spec.outputPath;
      config.mixCommands.push(spec.mixCommand);
    }
  }

  config.generateSpecs = args.generate;
  config.fileNamePrefix = config.repoName;

  // Use environments from config if present, otherwise generate defaults
  if (config.environments && Object.keys(config.environments).length > 0) {
    config.generateEnvironments = true;
  } else if (!config.environments) {
    const appSlug = mixInfo.appName.replace(/_/g, '-');
    config.environments = {
      local: { name: 'Local', baseUrl: 'http://localhost:4000' },
      staging: { name: 'Staging', baseUrl: `https://api.staging.${appSlug}.stord.com` },
      prod: { name: 'Production', baseUrl: `https://api.${appSlug}.stord.com` },
    };
    config.generateEnvironments = true;
  } else {
    config.generateEnvironments = false;
  }

  // Default customization if not in config
  if (!config.customization) {
    config.customization = {
      collectionName: mixInfo.projectName,
      disableQueryParams: true,
      sortByName: true,
      headerDefaults: { Accept: 'application/json' },
      excludePaths: ['/docs/*', '/internal/*', '/webhooks/*'],
    };
  }

  return config;
}

// ── Main Pipeline ──

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let config;

  if (args.interactive) {
    // Run the interactive wizard
    config = await runInteractiveSetup({ projectRoot: PROJECT_ROOT, configsDir: CONFIGS_DIR });

    // Save config for future reuse
    console.log('');
    saveConfig(config);
  } else if (args.config) {
    // Load a saved config
    config = loadConfig(args.config);
    config = buildConfigFromMixExs(config, args);
    console.log(`\n  ${c.green('✓')} Loaded config: ${c.cyan(args.config)}`);
  } else {
    console.error(`\n  ${c.red('✗')} Either use interactive mode or specify --config <name>`);
    printHelp();
    process.exit(1);
  }

  // Create service-specific output directories
  const serviceName = config.repoName || config.fileNamePrefix;
  const serviceCollectionsDir = join(COLLECTIONS_DIR, serviceName);
  const serviceEnvironmentsDir = join(ENVIRONMENTS_DIR, serviceName);

  mkdirSync(serviceCollectionsDir, { recursive: true });
  mkdirSync(serviceEnvironmentsDir, { recursive: true });

  // ── Step 1: Spec Generation ──
  separator();
  console.log(`\n  ${c.bold(c.cyan('Step 1'))} ${c.dim('·')} ${c.bold('OpenAPI Spec Generation')}\n`);

  let specs;
  if (config.generateSpecs) {
    specs = generateSpecs({
      repoPath: config.repoPath,
      mixCommands: config.mixCommands,
      specFiles: config.specFiles,
    });
  } else {
    specs = readExistingSpecs({
      repoPath: config.repoPath,
      specFiles: config.specFiles,
    });
  }

  console.log(`\n  Found ${c.bold(specs.length)} spec(s) to convert`);

  // ── Step 2: Convert + Customize ──
  separator();
  console.log(`\n  ${c.bold(c.cyan('Step 2'))} ${c.dim('·')} ${c.bold('Convert to Postman Collections')}\n`);

  for (const spec of specs) {
    console.log(`  Converting: ${c.cyan(spec.name)}...`);

    let collection = await convertToPostman(spec.content, spec.name);

    if (config.customization) {
      console.log(`  ${c.dim('Applying customizations...')}`);
      collection = customizeCollection(collection, config.customization);
    }

    const filename = `${spec.name}.postman_collection.json`;
    const outputPath = join(serviceCollectionsDir, filename);
    writeFileSync(outputPath, JSON.stringify(collection, null, 2), 'utf-8');
    console.log(`  ${c.green('✓')} Saved: ${c.cyan(`collections/${serviceName}/${filename}`)}`);
  }

  // ── Step 3: Environments ──
  separator();
  console.log(`\n  ${c.bold(c.cyan('Step 3'))} ${c.dim('·')} ${c.bold('Generate Environments')}\n`);

  if (config.generateEnvironments && config.environments) {
    const extraVars = config.customization?.additionalVariables || [];
    generateEnvironmentFiles(
      serviceName,
      config.environments,
      serviceEnvironmentsDir,
      extraVars
    );
  } else {
    console.log(`  ${c.dim('Skipping environment generation')}`);
  }

  // ── Summary ──
  separator();
  console.log(`\n  ${c.bold(c.green('✓ Done!'))}\n`);

  console.log(`  ${c.bold(`collections/${serviceName}/`)}`);
  const collectionFiles = readdirSync(serviceCollectionsDir).filter(f => f.endsWith('.json')).sort();
  for (const file of collectionFiles) {
    const sizeKb = (Buffer.byteLength(readFileSync(join(serviceCollectionsDir, file), 'utf-8'), 'utf-8') / 1024).toFixed(1);
    console.log(`    ${c.cyan(file)} ${c.dim(`(${sizeKb} KB)`)}`);
  }

  const envFiles = existsSync(serviceEnvironmentsDir)
    ? readdirSync(serviceEnvironmentsDir).filter(f => f.endsWith('.json')).sort()
    : [];
  if (envFiles.length > 0) {
    console.log(`\n  ${c.bold(`environments/${serviceName}/`)}`);
    for (const file of envFiles) {
      const sizeKb = (Buffer.byteLength(readFileSync(join(serviceEnvironmentsDir, file), 'utf-8'), 'utf-8') / 1024).toFixed(1);
      console.log(`    ${c.cyan(file)} ${c.dim(`(${sizeKb} KB)`)}`);
    }
  }

  console.log(`\n  ${c.bold('Import into Postman:')}`);
  console.log(`    ${c.dim('1.')} Open Postman → Import → Upload Files`);
  console.log(`    ${c.dim('2.')} Select files from ${c.cyan(`collections/${serviceName}/`)}`);
  console.log(`    ${c.dim('3.')} Select files from ${c.cyan(`environments/${serviceName}/`)}`);
  console.log(`    ${c.dim('4.')} Select the environment from the dropdown in Postman\n`);
}

main().catch((err) => {
  console.error(`\n  ${c.red('✗')} ${c.red(`Error: ${err.message}`)}\n`);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
