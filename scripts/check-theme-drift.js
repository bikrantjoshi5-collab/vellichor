#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const roots = ['app', 'src'];
const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
const violations = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full.replace(/\\/g, '/') === 'src/theme') continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (line.trim().startsWith('//')) return;
        const matches = line.match(hexRegex);
        if (matches) {
          violations.push(`${full}:${idx + 1} hardcoded color(s): ${matches.join(', ')}`);
        }
      });
    }
  }
}

for (const root of roots) walk(root);

if (violations.length > 0) {
  console.error('Design-system drift detected (hardcoded hex outside src/theme):');
  violations.forEach((v) => console.error('  ' + v));
  process.exit(1);
}

console.log('Theme drift check passed: 0 hardcoded hex colors outside src/theme.');
