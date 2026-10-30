// Uses Convex's installed template to refresh API types without contacting a deployment.
// Full `convex codegen` remains required when component definitions change.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
const template = await build({ entryPoints: ['node_modules/convex/src/cli/codegen_templates/api.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { apiCodegen } = await import('data:text/javascript;base64,' + Buffer.from(template.outputFiles[0].text).toString('base64'));
async function walk(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await walk(dir + '/' + entry.name, relative + '/'));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.config.ts') && entry.name !== 'schema.ts') result.push(relative);
  }
  return result;
}
const old = await readFile('convex/_generated/api.d.ts', 'utf8');
const components = old.slice(old.indexOf('export declare const components:'));
if (!components) throw new Error('Generate component types with convex codegen first.');
const generated = apiCodegen((await walk('convex')).sort());
await writeFile('convex/_generated/api.d.ts', generated.DTS + '\n' + components);
