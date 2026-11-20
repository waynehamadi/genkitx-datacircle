// Each tool of genkitx-datacircle called on the live API through Genkit: registered by the plugin and found by name in
// the registry, as generate and the Developer UI find them, and by defineDatacircleTools; with the inputs a model's
// mistakes send. Run from a project that installed the package.
import { genkit } from 'genkit';
import { datacircle, datacircleTools, defineDatacircleTools, VERSION } from 'genkitx-datacircle';

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ': ' + detail : ''}`);
  if (!ok) failed++;
};

// Ajv logs its strict mode's warnings by console.warn.
const warnings = [];
const warn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); warn(...args); };

const agents = [];
const counting = (input, init) => {
  agents.push(init?.headers?.['User-Agent']);
  return fetch(input, init);
};
const ai = genkit({ plugins: [datacircle({ fetch: counting })] });
const names = datacircleTools();
// Found by name first, as generate finds a tool: Genkit runs a plugin when a name under it is looked up.
const tool = (name) => ai.registry.lookupAction(`/tool/${name}`);
const [listApis, bestPlans, searchPlans, provider] = await Promise.all(names.map(tool));
check('a lookup of each datacircleTools() name finds it', [listApis, bestPlans, searchPlans, provider].every((t) => typeof t === 'function'), names.join(', '));
const actions = await ai.registry.listActions();
check('the registry lists the four, as the Developer UI does', names.every((name) => actions[`/tool/${name}`]));
check('each has its description', [listApis, bestPlans, searchPlans, provider].every((t) => t.__action.description.includes('datacircle.dev')));

let r = await listApis({});
check('list_apis {}', r.total > 100 && r.apis.length === 20 && typeof r.apis[0].slug === 'string', `${r.total} APIs, first ${r.apis[0]?.slug}`);
r = await listApis({ query: 'email', limit: 3 });
check('list_apis email 3', r.apis.length === 3 && r.apis.every((a) => /email/i.test(a.api + a.slug)), r.apis.map((a) => a.slug).join(' '));
r = await listApis({ query: null, limit: null });
check('list_apis nulls', r.apis.length === 20 && !r.note);
r = await listApis({ query: 'Bright Data' });
check('list_apis a provider as an API', typeof r.note === 'string' && r.note.includes('search_plans'), r.note);

r = await bestPlans({ slug: 'email-finder', limit: 3 });
check('best_plans email-finder 3', r.plans.length === 3 && r.plans[0].rank === 1 && typeof r.plans[0].provider === 'string', r.plans.map((p) => `${p.rank} ${p.provider} ${p.score}`).join(', '));
r = await bestPlans({ slug: 'Email Finder', limit: 2 });
check('best_plans a name as the slug', r.plans?.length === 2, r.api ?? r.error);
r = await bestPlans({ slug: 'bright-data' });
check('best_plans a provider as the API', typeof r.error === 'string' && r.error.includes('list_apis'), r.error);
r = await bestPlans({ slug: 'email-finder', limit: 500, extra: true });
check('best_plans a limit over 50 and a key of its own', r.plans.length > 10 && r.plans.length <= 50, `${r.plans.length} plans`);

r = await searchPlans({ query: 'bright data', limit: 2 });
check('search_plans bright data', r.total > 0 && r.plans.length === 2 && /bright data/i.test(r.plans[0].provider), `${r.total} found`);
r = await searchPlans({ api: 'Bright Data' });
check('search_plans a provider as the API', r.total > 0 && typeof r.note === 'string', r.note);
r = await searchPlans({ query: 'bright-data' });
check('search_plans a slug as a name', r.total > 0 && typeof r.note === 'string', r.note);
r = await searchPlans({ api: 'email-finder', sort: 'price', limit: 3, offset: 1 });
const prices = r.plans.map((p) => p.perThousand);
check('search_plans email-finder by price from 1', r.plans.length === 3 && prices.every((p, i) => i === 0 || p >= prices[i - 1]), prices.join(' '));
r = await searchPlans({ sort: 'rank' });
check('search_plans a sort the API refuses', typeof r.error === 'string', r.error);
r = await searchPlans({ api: null, query: null, sort: null, limit: null, offset: null });
check('search_plans nulls', r.total > 1000 && r.plans.length === 10, `${r.total} plans`);

r = await provider({ slug: 'Bright Data' });
check('provider Bright Data', r.total > 10 && r.ranked > 0 && typeof r.apis[0].rank === 'number', `${r.total} APIs, ${r.ranked} ranked, best ${r.apis[0].rank} on ${r.apis[0].slug}`);
r = await provider({ slug: 'no-such-provider-xyz' });
check('provider unknown', typeof r.error === 'string', r.error);

// What Genkit's own input check refuses, as for every tool: the generate fails with its words.
for (const [label, input] of [['provider with no slug', {}], ['list_apis a limit as a string', { limit: '3' }]]) {
  const t = label.startsWith('provider') ? provider : listApis;
  try {
    await t(input);
    check(label + ' refused', false, 'it ran');
  } catch (error) {
    check(label + ' refused by Genkit', /Schema validation failed/.test(error.message), error.message.split('\n')[0]);
  }
}
console.warn = warn;
check('no warning from Genkit\'s validator', warnings.length === 0, warnings.join(' | '));
check(`each call says genkitx-datacircle/${VERSION}`, agents.length > 10 && agents.every((a) => a === `genkitx-datacircle/${VERSION}`), `${agents.length} calls`);

// defineDatacircleTools on an instance with no plugin: the tools it gives are called as they are.
const bare = genkit({});
const tools = defineDatacircleTools(bare);
check('defineDatacircleTools gives four', tools.length === 4 && tools.every((t, i) => t.__action.name === names[i]));
r = await tools[1]({ slug: 'linkedin-profile', limit: 1 });
check('its best_plans', r.plans?.length === 1, `${r.plans?.[0]?.provider}`);
r = await tools[3]({ slug: 'apollo' });
check('its provider', r.total > 0 || typeof r.error === 'string', r.error ?? `${r.total} APIs`);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
