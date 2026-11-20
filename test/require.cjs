// genkitx-datacircle by require, from a CommonJS app: the plugin and one call of each tool through Genkit's registry.
const { genkit } = require('genkit');
const { datacircle, datacircleTools, VERSION } = require('genkitx-datacircle');
const plugin = require('genkitx-datacircle').default;

(async () => {
  const ai = genkit({ plugins: [datacircle()] });
  const inputs = [{ query: 'linkedin', limit: 2 }, { slug: 'email-finder', limit: 1 }, { query: 'apollo', limit: 1 }, { slug: 'apollo' }];
  let ok = plugin === datacircle;
  for (const [i, name] of datacircleTools().entries()) {
    const answer = await (await ai.registry.lookupAction(`/tool/${name}`))(inputs[i]);
    const good = !answer.error && (answer.total > 0 || answer.plans?.length > 0);
    ok = ok && good;
    console.log(`${good ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(answer).slice(0, 100)}`);
  }
  console.log(ok ? `ALL OK (require, ${VERSION})` : 'FAILED');
  process.exit(ok ? 0 : 1);
})();
