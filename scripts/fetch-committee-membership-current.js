const { load: yamlLoad } = require('js-yaml');

const URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml';

async function main() {
  const res = await fetch(URL);
  if (!res.ok) {
    console.error('Fetch failed:', res.status);
    process.exit(1);
  }
  const text = await res.text();
  const parsed = yamlLoad(text);
  const codes = Object.keys(parsed).filter((k) => Array.isArray(parsed[k]));
  let totalMembers = 0;
  for (const code of codes) {
    totalMembers += parsed[code].length;
  }
  console.log('Committee codes:', codes.length);
  console.log('Total membership rows:', totalMembers);
  console.log('Sample committee SSAF first member:', JSON.stringify(parsed.SSAF?.[0], null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
