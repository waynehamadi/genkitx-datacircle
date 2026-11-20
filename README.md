# Datacircle plugin for Genkit

Find the best GTM APIs. We benchmark all the GTM APIs and we put the results on our website.

Our website: https://datacircle.dev

This package is a [Genkit](https://genkit.dev) plugin with four tools that call Datacircle's open API, https://api.datacircle.dev/v1. You need no key and no account.

| Tool | What the tool gives | Call |
| --- | --- | --- |
| `datacircle/list_apis` | Every GTM API on Datacircle, with the API's slug, number of plans, number of providers and best plan | `GET /apis` |
| `datacircle/best_plans` | One API's plans, sorted by score out of 100, best first. Each plan comes with a rank and a price per 1,000 calls | `GET /apis/{slug}/best` |
| `datacircle/search_plans` | Plans that match a provider or plan name, on all APIs or on one API. You can sort them by score, provider or price | `GET /plans` |
| `datacircle/provider_ranks` | The APIs a provider sells, and the provider's rank on each API | `GET /providers/{slug}` |

## Install

```bash
npm install genkitx-datacircle genkit
```

The plugin works with Genkit 1.x (`genkit` 1.0.4 and later). It works from ESM and from CommonJS.

## Use the tools

Add the plugin, then give the tools to `generate`:

```ts
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { datacircle, datacircleTools } from 'genkitx-datacircle';

const ai = genkit({ plugins: [googleAI(), datacircle()] });

const { text } = await ai.generate({
  model: googleAI.model('gemini-2.5-flash'),
  prompt: 'Who are the 3 best providers for the email-finder API?',
  tools: datacircleTools(),
});
console.log(text);
```

`datacircleTools()` gives the four tools' names. The model sees each tool by the part after `datacircle/`, like `best_plans`. `generateStream` and `definePrompt` take the same `tools`. A `.prompt` file names them in its front matter:

```yaml
---
model: googleai/gemini-2.5-flash
tools: [datacircle/list_apis, datacircle/best_plans, datacircle/search_plans, datacircle/provider_ranks]
---
Who are the 3 best providers for the email-finder API?
```

The Developer UI lists the four tools with the plugin's actions. You can run each tool there with no model.

You can also call each tool alone. `defineDatacircleTools(ai)` registers the four tools without the plugin and gives them back. Use the plugin or this function, not both.

```ts
import { genkit } from 'genkit';
import { defineDatacircleTools } from 'genkitx-datacircle';

const ai = genkit({});
const [listApis, bestPlans, searchPlans, providerRanks] = defineDatacircleTools(ai);

const answer = await bestPlans({ slug: 'email-finder', limit: 3 });
console.log(answer.plans);
```

Each tool gives back a JSON object. Each plan comes with a rank, provider, plan, score, price per 1,000 (`perThousand`, in dollars) and a page on datacircle.dev. That page lists every field. When the API gives no data, for example for an unknown slug, the tool returns `{"error": "..."}` with the API's message. The model can then call again. Genkit checks the model's input against each tool's schema first. The tools take `null` for any value you can leave out, as many models send. When the input does not fit the schema, `generate` fails with Genkit's validation error. If the network fails, the tool throws an error.

`datacircle({ fetch })` sets the `fetch` the tools use, for example to add a proxy or a timeout. `defineDatacircleTools(ai, { fetch })` takes the same options.

## Network

Each tool call makes one HTTPS GET request to https://api.datacircle.dev/v1 and nothing else. The request holds only the tool's own arguments: no key and nothing from your chats. The API takes up to 60 calls a minute from one IP address. The tool waits once, for a minute at most, when the API asks the tool to wait. The package depends only on `genkit`, and stores nothing.

## Links

- Datacircle: https://datacircle.dev
- The API: https://datacircle.dev/api
- The API's spec: https://api.datacircle.dev/v1/openapi.json
- What each key means: https://datacircle.dev/fields

MIT license.
