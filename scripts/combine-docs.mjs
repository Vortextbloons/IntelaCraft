#!/usr/bin/env node
/**
 * combine-docs.mjs
 * 
 * Combines all IntelaCraft documentation into a single markdown file.
 * Usage: node scripts/combine-docs.mjs [output-path]
 * 
 * Default output: docs/ALL.md
 * 
 * The script:
 * 1. Reads docs/INDEX.md to get the canonical order of documents
 * 2. Extracts all .md file references from the index
 * 3. Reads each file and concatenates them with clear separators
 * 4. Writes the combined file
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DOCS_DIR = resolve(REPO_ROOT, "docs");
const INDEX_PATH = resolve(DOCS_DIR, "INDEX.md");
const DEFAULT_OUTPUT = resolve(DOCS_DIR, "ALL.md");

// Get output path from args or use default
const outputPath = process.argv[2]
  ? resolve(REPO_ROOT, process.argv[2])
  : DEFAULT_OUTPUT;

/**
 * Extract markdown file references from the INDEX.md content.
 * Matches patterns like [path/to/file.md](path/to/file.md) or (file.md)
 * Returns an ordered list of relative paths within docs/.
 */
// Files excluded from the combined output (meta/instructions, not project docs)
const EXCLUDED = new Set(["Clean.md", "Update.md"]);

function extractDocPaths(indexContent) {
  const paths = [];
  // Match links to .md files (relative paths)
  const linkRegex = /\[([^\]]*\.md)\]\(([^)]*\.md)\)/g;
  let match;
  while ((match = linkRegex.exec(indexContent)) !== null) {
    const relativePath = match[2];
    const fileName = relativePath.split("/").pop();
    if (EXCLUDED.has(fileName)) continue;
    // Skip if it's a link to itself or already added
    if (!paths.includes(relativePath)) {
      paths.push(relativePath);
    }
  }
  return paths;
}

/**
 * Read a markdown file and return its content with a header.
 */
function readDocFile(relativePath) {
  const fullPath = resolve(DOCS_DIR, relativePath);
  if (!existsSync(fullPath)) {
    console.warn(`  Warning: ${relativePath} not found, skipping`);
    return null;
  }
  const content = readFileSync(fullPath, "utf-8");
  return { relativePath, content };
}

/**
 * Format a section header for a document.
 */
function formatSection(doc) {
  const name = doc.relativePath
    .replace(/\//g, " > ")
    .replace(/\.md$/, "");
  return `---\n\n# ${name}\n\n> Source: \`docs/${doc.relativePath}\`\n\n`;
}

function main() {
  console.log("IntelaCraft Documentation Combiner");
  console.log("==================================\n");

  // Read INDEX.md
  if (!existsSync(INDEX_PATH)) {
    console.error("Error: docs/INDEX.md not found");
    process.exit(1);
  }

  const indexContent = readFileSync(INDEX_PATH, "utf-8");
  const docPaths = extractDocPaths(indexContent);

  console.log(`Found ${docPaths.length} documents in INDEX.md\n`);

  // Build combined output
  const sections = [];

  // Header
  sections.push(`# IntelaCraft — Complete Documentation\n`);
  sections.push(`> Auto-generated from docs/INDEX.md by scripts/combine-docs.mjs\n`);
  sections.push(`> Generated: ${new Date().toISOString()}\n`);
  sections.push(`> Total files: ${docPaths.length}\n\n`);
  sections.push(`## Table of Contents\n\n`);

  // Build TOC
  for (const path of docPaths) {
    const name = path
      .replace(/\//g, " > ")
      .replace(/\.md$/, "");
    sections.push(`- [${name}](#${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")})\n`);
  }
  sections.push("\n");

  // Read and append each document
  let found = 0;
  let skipped = 0;

  for (const path of docPaths) {
    const doc = readDocFile(path);
    if (doc) {
      sections.push(formatSection(doc));
      sections.push(doc.content.trim());
      sections.push("\n\n");
      found++;
      console.log(`  ✓ ${path}`);
    } else {
      skipped++;
    }
  }

  // Write output
  const combined = sections.join("");
  writeFileSync(outputPath, combined, "utf-8");

  const sizeKB = (Buffer.byteLength(combined) / 1024).toFixed(1);
  console.log(`\nDone!`);
  console.log(`  Found: ${found}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Size: ${sizeKB} KB`);
}

main();
