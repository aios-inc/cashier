import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [version] = process.argv.slice(2);

if (!version) {
  throw new Error('Usage: node scripts/set-version.mjs <version>');
}

const INTERNAL_SCOPE = '@aios-inc/';
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies'];

for (const directory of readdirSync('packages')) {
  const file = join('packages', directory, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));

  pkg.version = version;

  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (name.startsWith(INTERNAL_SCOPE)) pkg[field][name] = `^${version}`;
    }
  }

  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
