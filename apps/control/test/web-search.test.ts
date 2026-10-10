import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_HEADERS,
  SEARCH_UNAVAILABLE_MESSAGE,
  buildSearchQuery,
  ddgHtmlSearch,
  ddgLiteSearch,
  decodeDdgHref,
  executeSearch,
  mojeekSearch,
  parseDdgHtml,
  parseDdgLite,
  parseMojeek,
  runSearchChain,
  type SearchBackend,
} from '../../../extensions/web-search/parsers.ts';

// ---------------------------------------------------------------------------
// Fixtures modelled on the real markup returned by each backend.
// ---------------------------------------------------------------------------

const DDG_HTML = `
<html><body>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=aaa">Example &amp; Co</a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=aaa">A <b>useful</b> snippet &amp; more</a>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result result--ad">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_provider=foo&amp;u3=https%3A%2F%2Fads.example">Sponsored Result</a>
      </h2>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb&amp;rut=bbb">Second &#x27;quoted&#x27; result</a>
      </h2>
      <div class="result__snippet">Second snippet</div>
    </div>
  </div>
</body></html>`;

const DDG_LITE = `
<html><body><table>
  <tr><td>1.&nbsp;</td><td>
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flite.example%2F&amp;rut=bbb" class="result-link">Lite Title</a>
  </td></tr>
  <tr><td>&nbsp;</td><td class="result-snippet">Lite <b>snippet</b> &amp; text</td></tr>
</table></body></html>`;

const MOJEEK = `
<html><body>
  <ul class="results-standard">
    <li>
      <h2><a class="ob" href="https://mojeek.example/page">Mojeek Title</a></h2>
      <p class="s">Mojeek <b>snippet</b> &amp; text</p>
    </li>
  </ul>
</body></html>`;

async function withFetch<T>(
  impl: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Redirect decoding / ad filtering
// ---------------------------------------------------------------------------

test('decodeDdgHref decodes uddg redirects and drops sponsored y.js rows', () => {
  assert.equal(
    decodeDdgHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1&rut=zzz'),
    'https://example.com/docs?a=1',
  );
  assert.equal(
    decodeDdgHref('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F&rut=x'),
    'https://example.org/',
  );
  assert.equal(decodeDdgHref('https://duckduckgo.com/y.js?ad_provider=foo'), null);
  assert.equal(
    decodeDdgHref('https://direct.example.com/page'),
    'https://direct.example.com/page',
  );
});

test('parseDdgHtml filters sponsored rows and strips tags/entities', () => {
  const results = parseDdgHtml(DDG_HTML);
  assert.deepEqual(
    results.map((r) => r.url),
    ['https://example.com/a', 'https://example.org/b'],
  );
  assert.equal(results[0]!.title, 'Example & Co');
  assert.equal(results[0]!.snippet, 'A useful snippet & more');
  assert.equal(results[1]!.title, "Second 'quoted' result");
  assert.equal(results[1]!.snippet, 'Second snippet');
});

test('parseDdgHtml rejects bot challenge pages', () => {
  assert.throws(() =>
    parseDdgHtml('<html><script src="//duckduckgo.com/anomaly.js?cc=botnet"></script></html>'),
  );
});

// ---------------------------------------------------------------------------
// Backend-specific parsing
// ---------------------------------------------------------------------------

test('parseDdgLite extracts titles, redirects and snippets', () => {
  const results = parseDdgLite(DDG_LITE);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.url, 'https://lite.example/');
  assert.equal(results[0]!.title, 'Lite Title');
  assert.equal(results[0]!.snippet, 'Lite snippet & text');
});

test('parseMojeek extracts results from the results list', () => {
  assert.deepEqual(parseMojeek(MOJEEK), [
    {
      title: 'Mojeek Title',
      url: 'https://mojeek.example/page',
      snippet: 'Mojeek snippet & text',
    },
  ]);
});

// ---------------------------------------------------------------------------
// Backend fetch: URL, headers, parsing
// ---------------------------------------------------------------------------

test('ddgHtmlSearch sends browser-like headers and parses the response', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const results = await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(DDG_HTML, { status: 200 });
    }) as typeof fetch,
    () => ddgHtmlSearch('rust generics', 2),
  );

  assert.equal(results.length, 2);
  const first = calls[0]!;
  assert.equal(new URL(first.url).origin + new URL(first.url).pathname, 'https://html.duckduckgo.com/html/');
  assert.equal(new URL(first.url).searchParams.get('q'), 'rust generics');
  const headers = first.init.headers as Record<string, string>;
  assert.equal(headers['User-Agent'], BROWSER_HEADERS['User-Agent']);
  assert.equal(headers['Accept'], 'text/html');
  assert.equal(headers['Accept-Language'], 'en-US,en;q=0.9');
});

test('ddgLiteSearch targets the lite endpoint', async () => {
  let seen = '';
  await withFetch(
    (async (url: string | URL) => {
      seen = String(url);
      return new Response(DDG_LITE, { status: 200 });
    }) as typeof fetch,
    () => ddgLiteSearch('hello', 5),
  );
  assert.equal(new URL(seen).origin + new URL(seen).pathname, 'https://lite.duckduckgo.com/lite/');
  assert.equal(new URL(seen).searchParams.get('q'), 'hello');
});

test('mojeekSearch targets the mojeek endpoint', async () => {
  let seen = '';
  await withFetch(
    (async (url: string | URL) => {
      seen = String(url);
      return new Response(MOJEEK, { status: 200 });
    }) as typeof fetch,
    () => mojeekSearch('hello', 5),
  );
  assert.equal(new URL(seen).origin + new URL(seen).pathname, 'https://www.mojeek.com/search');
  assert.equal(new URL(seen).searchParams.get('q'), 'hello');
});

test('a non-ok response is a backend failure', async () => {
  await withFetch(
    (async () => new Response('nope', { status: 503 })) as typeof fetch,
    async () => {
      await assert.rejects(() => ddgHtmlSearch('x', 5), /HTTP 503/);
    },
  );
});

// ---------------------------------------------------------------------------
// Backend chain
// ---------------------------------------------------------------------------

function resultAt(name: string): SearchBackend {
  return {
    name,
    search: async () => [{ title: name, url: `https://${name}.example`, snippet: name }],
  };
}

test('runSearchChain falls back when a backend throws', async () => {
  const calls: string[] = [];
  const backends: SearchBackend[] = [
    {
      name: 'first',
      search: async () => {
        calls.push('first');
        throw new Error('boom');
      },
    },
    {
      name: 'second',
      search: async () => {
        calls.push('second');
        return [{ title: 'T', url: 'https://x.example', snippet: 's' }];
      },
    },
    resultAt('third'),
  ];

  const { results, backend } = await runSearchChain('q', 5, undefined, backends);
  assert.equal(backend, 'second');
  assert.equal(results.length, 1);
  assert.deepEqual(calls, ['first', 'second']);
});

test('runSearchChain skips empty backends and uses the first with results', async () => {
  const backends: SearchBackend[] = [
    { name: 'empty', search: async () => [] },
    resultAt('winner'),
  ];
  const { backend } = await runSearchChain('q', 5, undefined, backends);
  assert.equal(backend, 'winner');
});

test('runSearchChain throws the unavailable error when every backend fails', async () => {
  const backends: SearchBackend[] = [
    {
      name: 'a',
      search: async () => {
        throw new Error('x');
      },
    },
    { name: 'b', search: async () => [] },
    {
      name: 'c',
      search: async () => {
        throw new Error('y');
      },
    },
  ];

  await assert.rejects(
    () => runSearchChain('q', 5, undefined, backends),
    (error: unknown) =>
      error instanceof Error && error.message === SEARCH_UNAVAILABLE_MESSAGE,
  );
});

// ---------------------------------------------------------------------------
// Composed query passthrough
// ---------------------------------------------------------------------------

test('buildSearchQuery composes query, exact phrases, exclusions and site', () => {
  const built = buildSearchQuery({
    query: 'foo bar',
    exactPhrases: ['exact phrase'],
    excludeTerms: ['spam'],
    site: 'https://example.com/path',
  });
  assert.equal(built.query, 'foo bar "exact phrase" -spam site:example.com');
});

test('executeSearch passes the composed query to the backend and reports details', async () => {
  let seenQuery = '';
  const backend: SearchBackend = {
    name: 'stub',
    search: async (query) => {
      seenQuery = query;
      return [{ title: 'T', url: 'https://x.example', snippet: 's' }];
    },
  };

  const result = await executeSearch(
    {
      query: 'foo bar',
      exactPhrases: ['exact phrase'],
      excludeTerms: ['spam'],
      site: 'https://example.com/path',
    },
    undefined,
    [backend],
  );

  assert.equal(seenQuery, 'foo bar "exact phrase" -spam site:example.com');
  assert.equal(result.details.composedQuery, seenQuery);
  assert.equal(result.details.backend, 'stub');
  assert.equal(result.details.resultCount, 1);
  assert.equal(result.details.exactPhrases[0], 'exact phrase');
  assert.equal(result.details.site, 'example.com');
  assert.match(result.content[0]!.text, /^1\. T\n   https:\/\/x\.example\n   s$/);
});

test('executeSearch defaults to a count of 5 and surfaces the unavailable error', async () => {
  await assert.rejects(
    () =>
      executeSearch({ query: 'q' }, undefined, [
        {
          name: 'dead',
          search: async () => {
            throw new Error('offline');
          },
        },
      ]),
    (error: unknown) =>
      error instanceof Error && error.message === SEARCH_UNAVAILABLE_MESSAGE,
  );
});

test('collectResults paginates only until the requested count is reached', async () => {
  const seen: string[] = [];
  const results = await withFetch(
    (async (url: string | URL) => {
      seen.push(String(url));
      return new Response(DDG_HTML, { status: 200 });
    }) as typeof fetch,
    () => ddgHtmlSearch('rust generics', 5),
  );
  // Fixture ma 2 wyniki/stronę: strony s=0, s=10, s=20 → 6 wyników, przycięte do 5.
  assert.equal(results.length, 5);
  assert.equal(seen.length, 3);
  assert.equal(new URL(seen[1]!).searchParams.get('s'), '10');
});
