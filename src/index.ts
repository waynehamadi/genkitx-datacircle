// A Genkit plugin of four tools on Datacircle's open API: find the best GTM APIs. The API needs no key:
// https://api.datacircle.dev/v1 (its spec: https://api.datacircle.dev/v1/openapi.json). More at https://datacircle.dev

import type { Genkit, ToolAction } from 'genkit';
import { genkitPlugin } from 'genkit/plugin';
import type { GenkitPlugin } from 'genkit/plugin';
import { ApiError, BASE_URL, Client, VERSION, brief, briefPlans, clamp, objects, slugify } from './client.js';
import type { Answer, DatacircleOptions } from './client.js';

export { ApiError, BASE_URL, VERSION };
export type { Answer, DatacircleOptions };

const LIST_APIS_ABOUT = "Lists the GTM APIs on Datacircle's sheet (https://datacircle.dev). GTM means go-to-market. GTM APIs are the APIs sales and marketing teams use. Gives each API's slug, how many plans and providers it has and its best plan. Call it first to find an API's slug.";
const BEST_PLANS_ABOUT = "Gives an API's plans best first by their score out of 100 on Datacircle's benchmark (https://datacircle.dev), each with its rank, provider, plan, $ per 1,000 calls and its page. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const SEARCH_PLANS_ABOUT = "Searches every plan on Datacircle's sheet (https://datacircle.dev), or one API's, by provider or plan name, sorted by score, provider or price. Gives how many were found and up to limit of them. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const PROVIDER_ABOUT = "Gives each API one provider sells and its rank on each on Datacircle's benchmark (https://datacircle.dev), with its best plan there, its best rank first. total is how many APIs it sells, ranked on how many of them it has a rank.";

// Tells a model that sent a provider's name to an API's tool where a provider's plans are.
const FOR_PROVIDER = "A provider's plans: search_plans with its name as query, like bright data, or provider_ranks.";

// Genkit checks a tool's input against its JSON schema and gives the tool the input as the model sent it, and an input the
// schema refuses fails the whole generate. So each schema takes what models send for an optional value: a null, which is
// the value left out, and keys of its own, which are left unread. Gemini reads [type, 'null'] as the type, nullable; a
// third type would make Genkit's validator log a warning in the app.
const text = (description: string) => ({ type: ['string', 'null'], description });
const count = (description: string) => ({ type: ['integer', 'null'], description });

const listApisSchema = {
  type: 'object',
  properties: {
    query: text("Words of the API's name or slug, like email or linkedin profile: the APIs that hold the most of them come first. The sheet's order when left out"),
    limit: count('How many APIs to give, 1 to 200. 20 when left out: the sheet has about 150'),
  },
};

const bestPlansSchema = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: "The API's slug, like email-finder or linkedin-profile, as list_apis gives it" },
    limit: count('How many plans to give, 1 to 50. 10 when left out'),
  },
  required: ['slug'],
};

// sort has no enum: an enum refuses a null, and a value outside it would fail the generate. The API's own words for a
// wrong one are the tool's result instead.
const searchPlansSchema = {
  type: 'object',
  properties: {
    api: text("Only this API's plans: its name or slug, like email-finder. A provider's name goes in query, never here. Every API when left out"),
    query: text("Words that must all appear in the provider's or plan's name, like bright data"),
    sort: text('One of score (best first, the default), provider (A to Z) or price ($ per 1,000, lowest first)'),
    limit: count('How many plans to give, 1 to 50. 10 when left out'),
    offset: count('How many found plans to skip first. 0 when left out'),
  },
};

const providerSchema = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: "The provider's slug, like bright-data, or its name, like Bright Data: the name is made a slug" },
  },
  required: ['slug'],
};

/** list_apis' input. */
export type ListApisInput = { query?: string | null; limit?: number | null };
/** best_plans' input. */
export type BestPlansInput = { slug: string; limit?: number | null };
/** search_plans' input. */
export type SearchPlansInput = {
  api?: string | null;
  query?: string | null;
  sort?: 'score' | 'provider' | 'price' | null;
  limit?: number | null;
  offset?: number | null;
};
/** provider_ranks' input. */
export type ProviderInput = { slug: string };

/**
 * The four tools' names, in this order. Genkit gives a model the part after the plugin's name, list_apis, by which the
 * tools' answers name each other, and finds a plugin's tool by the whole: a plugin runs when its name is looked up.
 */
export type DatacircleToolName = 'datacircle/list_apis' | 'datacircle/best_plans' | 'datacircle/search_plans' | 'datacircle/provider_ranks';

/** The four tools' names, for generate's or a prompt's tools once the plugin has registered them. */
export function datacircleTools(): DatacircleToolName[] {
  return ['datacircle/list_apis', 'datacircle/best_plans', 'datacircle/search_plans', 'datacircle/provider_ranks'];
}

/** A text the model sent, or '' for a null, a left-out value or a value of another kind. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** A number the model sent, or undefined. A string of digits, from a call of the tool by an app, is read as one. */
function numberOf(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** A limit the model sent, within the API's bounds, or undefined for the API's default. */
function bounded(value: unknown, high: number): number | undefined {
  const n = numberOf(value);
  return n === undefined || !(n >= 1) ? undefined : clamp(n, 1, high);
}

/** An answer of 4xx (an unknown slug, a wrong argument) is the tool's result as {error}, so that the model reads the API's words and can call again. */
function asResult(error: unknown): Answer {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

async function listApisRun(client: Client, input: ListApisInput, signal?: AbortSignal): Promise<Answer> {
  let apis: Answer[];
  try {
    apis = objects(await client.get<unknown>('/apis', {}, signal));
  } catch (error) {
    return asResult(error);
  }
  const query = textOf(input.query);
  const words = query.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const found = apis
    .map((api, order) => {
      const name = `${String(api.api ?? '')} ${String(api.slug ?? '').replace(/-/g, ' ')}`.toLowerCase();
      return { order, matched: words.filter((word) => name.includes(word)).length, api };
    })
    .filter(({ matched }) => matched > 0 || words.length === 0)
    // The most words matched first, the sheet's order within each.
    .sort((a, b) => b.matched - a.matched || a.order - b.order);
  const answer: Answer = {
    total: found.length,
    apis: found.slice(0, bounded(input.limit, 200) ?? 20)
      .map(({ api }) => brief(api, ['api', 'slug', 'plans', 'providers', 'best', 'bestPage', 'sheetPage'])),
  };
  if (words.length > 0 && (found.length === 0 || found[0].matched < words.length)) {
    // A provider's name sent as an API's, like Bright Data, whose data matches many APIs: where its plans are.
    answer.note = `No API's name holds every word of ${JSON.stringify(query)}. A provider's plans: search_plans with its name as query, or provider_ranks.`;
  }
  return answer;
}

async function bestPlansRun(client: Client, input: BestPlansInput, signal?: AbortSignal): Promise<Answer> {
  const api = slugify(textOf(input.slug));
  if (api === '') return { error: `Give an API's slug, like email-finder: list_apis gives every slug. ${FOR_PROVIDER}` };
  try {
    const answer = await client.get(`/apis/${api}/best`, { limit: bounded(input.limit, 50) }, signal);
    return { ...answer, plans: briefPlans(answer.plans) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // A provider's name sent as the API's slug: the API's words, and where a provider's plans are.
      return { error: `${error.message}. list_apis gives every API's slug. ${FOR_PROVIDER}` };
    }
    return asResult(error);
  }
}

async function searchPlansRun(client: Client, input: SearchPlansInput, signal?: AbortSignal): Promise<Answer> {
  const offset = numberOf(input.offset);
  const search = (api: string, query: string) =>
    client.get('/plans', {
      api: api.trim(),
      query: query.trim(),
      sort: textOf(input.sort).trim(),
      limit: bounded(input.limit, 50),
      offset: offset === undefined || !(offset > 0) ? undefined : Math.trunc(offset),
    }, signal);
  let api = textOf(input.api);
  let query = textOf(input.query);
  const notes: string[] = [];
  try {
    let answer: Answer;
    try {
      answer = await search(api, query);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400 && error.message.includes('api must be') && query.trim() === '')) throw error;
      // A provider's name sent as the API: the plans whose provider or plan name holds it.
      [api, query] = ['', api];
      answer = await search(api, query);
      notes.push(`No API is named ${JSON.stringify(input.api)}: these are the plans whose provider or plan name holds it.`);
    }
    if (answer.total === 0 && query.includes('-')) {
      // A slug sent as a name, like bright-data, which no name holds: its words, like bright data. A name with a
      // hyphen, like A-Leads, is found as it is first.
      const words = query.replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ');
      try {
        answer = await search(api, words);
        notes.push(`No provider's or plan's name holds ${JSON.stringify(query)}: these are the plans whose name holds ${JSON.stringify(words)}.`);
      } catch {
        // The first answer stands.
      }
    }
    return { ...answer, plans: briefPlans(answer.plans), ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
  } catch (error) {
    return asResult(error);
  }
}

async function providerRun(client: Client, input: ProviderInput, signal?: AbortSignal): Promise<Answer> {
  const provider = slugify(textOf(input.slug));
  if (provider === '') return { error: "Give a provider's slug or name, like bright-data or Bright Data" };
  let answer: Answer;
  try {
    answer = await client.get(`/providers/${provider}`, {}, signal);
  } catch (error) {
    return asResult(error);
  }
  const apis = objects(answer.apis).map((entry) => {
    const plans = objects(entry.plans);
    const kept: Answer = { ...brief(entry, ['api', 'slug', 'rank', 'bestPage']), plans: plans.length };
    const best = bestPlan(plans);
    if (best) kept.best = brief(best, ['plan', 'score', 'perThousand', 'page']);
    return kept;
  });
  // Its best rank first, the APIs where it has none last, in the API's order.
  const rank = (api: Answer) => (typeof api.rank === 'number' ? api.rank : Infinity);
  apis.sort((a, b) => rank(a) - rank(b));
  return { ...answer, apis, total: apis.length, ranked: apis.filter((api) => typeof api.rank === 'number').length };
}

/** A provider's best plan on an API: its lowest rank, the first when none has a rank. */
function bestPlan(plans: Answer[]): Answer | undefined {
  const ranked = plans.filter((plan) => typeof plan.rank === 'number');
  if (ranked.length === 0) return plans[0];
  return ranked.reduce((best, plan) => ((plan.rank as number) < (best.rank as number) ? plan : best));
}

/**
 * A Genkit tool of ours: called with its input, it gives the answer as a JSON object. It is a ToolAction, whose own
 * call takes any input: Omit keeps its keys and leaves its call out, so that the input's type holds.
 */
export type DatacircleTool<Input> = ((input: Input) => Promise<Answer>) & Omit<ToolAction, never>;

/** The four tools, in this order. */
export type DatacircleTools = [
  DatacircleTool<ListApisInput>,
  DatacircleTool<BestPlansInput>,
  DatacircleTool<SearchPlansInput>,
  DatacircleTool<ProviderInput>,
];

// What Genkit gives a tool after its input: the generate's abort signal, from Genkit 1.x versions that have one.
const signalOf = (options: unknown): AbortSignal | undefined => (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal;

// The input as the model sent it: an object, as the schema holds, or nothing.
const inputOf = <Input>(input: unknown): Input => (typeof input === 'object' && input !== null ? input : {}) as Input;

/**
 * Registers the four tools on a Genkit instance and gives them: datacircle/list_apis (GET /apis), datacircle/best_plans
 * (GET /apis/{slug}/best), datacircle/search_plans (GET /plans) and datacircle/provider_ranks (GET /providers/{slug}). The
 * plugin calls it: use one or the other.
 */
export function defineDatacircleTools(ai: Genkit, options?: DatacircleOptions): DatacircleTools {
  const client = new Client(options);
  const define = <Input>(name: DatacircleToolName, description: string, schema: object, run: (client: Client, input: Input, signal?: AbortSignal) => Promise<Answer>) =>
    ai.defineTool(
      { name, description, inputJsonSchema: schema as never },
      (input: unknown, options: unknown) => run(client, inputOf<Input>(input), signalOf(options)),
    ) as unknown as DatacircleTool<Input>;
  return [
    define<ListApisInput>('datacircle/list_apis', LIST_APIS_ABOUT, listApisSchema, listApisRun),
    define<BestPlansInput>('datacircle/best_plans', BEST_PLANS_ABOUT, bestPlansSchema, bestPlansRun),
    define<SearchPlansInput>('datacircle/search_plans', SEARCH_PLANS_ABOUT, searchPlansSchema, searchPlansRun),
    define<ProviderInput>('datacircle/provider_ranks', PROVIDER_ABOUT, providerSchema, providerRun),
  ];
}

/**
 * The Genkit plugin datacircle: it registers the four tools, which generate, a prompt or a .prompt file then name
 * (datacircleTools() gives their names) and the Developer UI runs.
 */
export function datacircle(options?: DatacircleOptions): GenkitPlugin {
  return genkitPlugin('datacircle', async (ai: Genkit) => {
    defineDatacircleTools(ai, options);
  });
}

export default datacircle;
