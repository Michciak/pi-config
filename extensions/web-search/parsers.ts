/**
 * Pure parsing / fetching helpers for the web_search tool.
 *
 * This module intentionally has NO dependency on typebox, pi-tui or the pi
 * runtime so it can be imported and unit-tested in isolation.
 *
 * Backend chain: DuckDuckGo HTML -> DuckDuckGo Lite -> Mojeek.
 */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface StructuredSearchArgs {
	query?: string;
	exactPhrases?: string[];
	excludeTerms?: string[];
	site?: string;
	count?: number;
}

export interface BuiltSearchQuery {
	query: string;
	baseQuery?: string;
	exactPhrases: string[];
	excludeTerms: string[];
	site?: string;
}

export interface SearchBackend {
	name: string;
	search(
		query: string,
		count: number,
		signal?: AbortSignal,
	): Promise<SearchResult[]>;
}

export interface SearchDetails {
	composedQuery: string;
	query?: string;
	exactPhrases: string[];
	excludeTerms: string[];
	site?: string;
	backend: string;
	resultCount: number;
}

export interface SearchToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: SearchDetails;
}

export const SEARCH_UNAVAILABLE_MESSAGE =
	"Web search is temporarily unavailable (DuckDuckGo and Mojeek unreachable or blocking requests). Try again later.";

/**
 * Browser-like headers are mandatory: without them DuckDuckGo returns a bot
 * challenge page instead of real results.
 */
export const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
	Accept: "text/html",
	"Accept-Language": "en-US,en;q=0.9",
};

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 10;

// ---------------------------------------------------------------------------
// Generic string helpers
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#x27": "'",
	"#39": "'",
	nbsp: " ",
};

/** Decode a small, safe subset of HTML entities in a single pass. */
export function decodeEntities(input: string): string {
	return input.replace(
		/&(#x27|#39|amp|lt|gt|quot|nbsp);/gi,
		(match, entity: string) => ENTITY_MAP[entity.toLowerCase()] ?? match,
	);
}

/** Strip HTML tags, decode basic entities and collapse whitespace. */
export function stripTags(input: string): string {
	return decodeEntities(input.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function extractAttr(attrs: string, name: string): string | undefined {
	const match = attrs.match(
		new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
	);
	return match?.[1] ?? match?.[2];
}

function assertNotChallenge(html: string, backend: string): void {
	if (/anomaly\.js|cc=botnet|unusual traffic/i.test(html)) {
		throw new Error(`${backend}: bot challenge`);
	}
	if (/<title>\s*captcha\s*<\/title>/i.test(html)) {
		throw new Error(`${backend}: captcha challenge`);
	}
}

// ---------------------------------------------------------------------------
// DuckDuckGo redirect decoding
// ---------------------------------------------------------------------------

/**
 * Resolve a DuckDuckGo result href. Real destinations are hidden behind the
 * `uddg` query parameter of https://duckduckgo.com/l/?uddg=<encoded>&rut=...
 * Returns null for sponsored `y.js` redirect rows.
 */
export function decodeDdgHref(href: string): string | null {
	const decoded = decodeEntities(href).trim();
	if (!decoded) return null;
	if (/^https?:\/\/duckduckgo\.com\/y\.js\?/i.test(decoded)) return null;
	if (/^\/\/duckduckgo\.com\/y\.js\?/i.test(decoded)) return null;

	try {
		const url = decoded.startsWith("//")
			? new URL(`https:${decoded}`)
			: new URL(decoded, "https://duckduckgo.com");
		const uddg = url.searchParams.get("uddg");
		if (uddg) return uddg;
		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.toString();
		}
		return null;
	} catch {
		return decoded;
	}
}

function resolveDirectHref(href: string): string | null {
	const decoded = decodeEntities(href).trim();
	if (!decoded) return null;
	try {
		if (decoded.startsWith("//")) return `https:${decoded}`;
		const url = /^[a-z]+:\/\//i.test(decoded)
			? new URL(decoded)
			: new URL(decoded, "https://www.mojeek.com");
		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.toString();
		}
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML backend parsing
// ---------------------------------------------------------------------------

const DDG_HTML_ANCHOR =
	/<a\b([^>]*\bclass="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b[^>]*\bclass="[^"]*result__a|$)/gi;
const DDG_HTML_SNIPPET =
	/<(?:a|div|span)\b[^>]*\bclass="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i;

export function parseDdgHtml(html: string): SearchResult[] {
	assertNotChallenge(html, "duckduckgo-html");

	const results: SearchResult[] = [];
	for (const match of html.matchAll(DDG_HTML_ANCHOR)) {
		const href = extractAttr(match[1] ?? "", "href");
		if (!href) continue;
		const url = decodeDdgHref(href);
		if (!url) continue;
		const title = stripTags(match[2] ?? "");
		if (!title) continue;
		const snippetMatch = (match[3] ?? "").match(DDG_HTML_SNIPPET);
		const snippet = snippetMatch ? stripTags(snippetMatch[1] ?? "") : "";
		results.push({ title, url, snippet });
	}
	return results;
}

// ---------------------------------------------------------------------------
// DuckDuckGo Lite backend parsing
// ---------------------------------------------------------------------------

const DDG_LITE_ANCHOR =
	/<a\b([^>]*\bclass="result-link"[^>]*)>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b[^>]*\bclass="result-link"|$)/gi;
const DDG_LITE_SNIPPET =
	/<td\b[^>]*\bclass="result-snippet"[^>]*>([\s\S]*?)<\/td>/i;

export function parseDdgLite(html: string): SearchResult[] {
	assertNotChallenge(html, "duckduckgo-lite");

	const results: SearchResult[] = [];
	for (const match of html.matchAll(DDG_LITE_ANCHOR)) {
		const href = extractAttr(match[1] ?? "", "href");
		if (!href) continue;
		const url = decodeDdgHref(href);
		if (!url) continue;
		const title = stripTags(match[2] ?? "");
		if (!title) continue;
		const snippetMatch = (match[3] ?? "").match(DDG_LITE_SNIPPET);
		const snippet = snippetMatch ? stripTags(snippetMatch[1] ?? "") : "";
		results.push({ title, url, snippet });
	}
	return results;
}

// ---------------------------------------------------------------------------
// Mojeek backend parsing
// ---------------------------------------------------------------------------

const MOJEEK_LIST = /<ul\b[^>]*\bclass="[^"]*results[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
const MOJEEK_LI = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const MOJEEK_H2_LINK = /<h2\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i;
const MOJEEK_OB_LINK = /<a\b([^>]*\bclass="[^"]*\bob\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i;
const MOJEEK_SNIPPET = /<p\b[^>]*\bclass="s"[^>]*>([\s\S]*?)<\/p>/i;

export function parseMojeek(html: string): SearchResult[] {
	assertNotChallenge(html, "mojeek");

	const results: SearchResult[] = [];
	for (const list of html.matchAll(MOJEEK_LIST)) {
		for (const item of (list[1] ?? "").matchAll(MOJEEK_LI)) {
			const block = item[1] ?? "";
			const link = block.match(MOJEEK_H2_LINK) ?? block.match(MOJEEK_OB_LINK);
			if (!link) continue;
			const href = extractAttr(link[1] ?? "", "href");
			if (!href) continue;
			const url = resolveDirectHref(href);
			if (!url) continue;
			const title = stripTags(link[2] ?? "");
			if (!title) continue;
			const snippetMatch = block.match(MOJEEK_SNIPPET);
			const snippet = snippetMatch ? stripTags(snippetMatch[1] ?? "") : "";
			results.push({ title, url, snippet });
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
	url: string,
	signal?: AbortSignal,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	try {
		return await fetch(url, {
			headers: BROWSER_HEADERS,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function fetchAndParse(
	url: string,
	parse: (html: string) => SearchResult[],
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const response = await fetchWithTimeout(url, signal);
	if (!response.ok) {
		throw new Error(`Search backend returned HTTP ${response.status}`);
	}
	const html = await response.text();
	return parse(html);
}

/**
 * Fetch one page and, only when needed to reach `count`, paginate with `s`
 * (max 3 pages). Extra-page failures never discard already-collected results.
 */
async function collectResults(
	urlForPage: (page: number) => string,
	parse: (html: string) => SearchResult[],
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const target = Math.min(Math.max(count, 1), MAX_RESULTS);
	const first = await fetchAndParse(urlForPage(0), parse, signal);
	const results = [...first];
	if (results.length >= target) return results.slice(0, target);

	// Pierwsza strona była za krótka — dociągnij kolejne (max 3 strony łącznie).
	for (let page = 1; page < 3; page++) {
		try {
			const more = await fetchAndParse(urlForPage(page), parse, signal);
			if (more.length === 0) break;
			results.push(...more);
			if (results.length >= target) break;
		} catch {
			break;
		}
	}
	return results.slice(0, target);
}

export async function ddgHtmlSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	return collectResults(
		(page) => {
			const url = new URL("https://html.duckduckgo.com/html/");
			url.searchParams.set("q", query);
			if (page > 0) url.searchParams.set("s", String(page * 10));
			return url.toString();
		},
		parseDdgHtml,
		count,
		signal,
	);
}

export async function ddgLiteSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	return collectResults(
		(page) => {
			const url = new URL("https://lite.duckduckgo.com/lite/");
			url.searchParams.set("q", query);
			if (page > 0) url.searchParams.set("s", String(page * 10));
			return url.toString();
		},
		parseDdgLite,
		count,
		signal,
	);
}

export async function mojeekSearch(
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	return collectResults(
		(page) => {
			const url = new URL("https://www.mojeek.com/search");
			url.searchParams.set("q", query);
			if (page > 0) url.searchParams.set("s", String(page * 10 + 1));
			return url.toString();
		},
		parseMojeek,
		count,
		signal,
	);
}

export const DEFAULT_BACKENDS: SearchBackend[] = [
	{ name: "duckduckgo-html", search: ddgHtmlSearch },
	{ name: "duckduckgo-lite", search: ddgLiteSearch },
	{ name: "mojeek", search: mojeekSearch },
];

// ---------------------------------------------------------------------------
// Query building / formatting (unchanged behaviour, moved for testability)
// ---------------------------------------------------------------------------

function stripWrappingQuotes(value: string): string {
	return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1).trim()
		: value;
}

function cleanItems(values?: string[]): string[] {
	if (!values) return [];
	return values
		.map((value) => stripWrappingQuotes(value.trim().replace(/\s+/g, " ")))
		.filter(Boolean);
}

function cleanQuery(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/\s+/g, " ");
	return cleaned || undefined;
}

function normalizeSite(site?: string): string | undefined {
	if (typeof site !== "string") return undefined;

	let value = site.trim().replace(/^site:/i, "").trim();
	if (!value) return undefined;

	try {
		const candidate = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
		const url = new URL(candidate);
		if (url.hostname) value = url.hostname;
	} catch {}

	return value.replace(/\/+$/, "") || undefined;
}

function quoteForSearch(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildSearchQuery(args: StructuredSearchArgs): BuiltSearchQuery {
	const baseQuery = cleanQuery(args.query);
	const exactPhrases = cleanItems(args.exactPhrases);
	const excludeTerms = cleanItems(args.excludeTerms);
	const site = normalizeSite(args.site);

	if (!baseQuery && exactPhrases.length === 0) {
		throw new Error("At least one of 'query' or 'exactPhrases' is required.");
	}

	const parts: string[] = [];
	if (baseQuery) parts.push(baseQuery);
	for (const phrase of exactPhrases) {
		parts.push(quoteForSearch(phrase));
	}
	for (const term of excludeTerms) {
		parts.push(`-${term.includes(" ") ? quoteForSearch(term) : term}`);
	}
	if (site) {
		parts.push(`site:${site}`);
	}

	return {
		query: parts.join(" "),
		baseQuery,
		exactPhrases,
		excludeTerms,
		site,
	};
}

export function formatResults(results: SearchResult[]): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
		.join("\n\n");
}

// ---------------------------------------------------------------------------
// Chained execution
// ---------------------------------------------------------------------------

export async function runSearchChain(
	query: string,
	count: number,
	signal?: AbortSignal,
	backends: SearchBackend[] = DEFAULT_BACKENDS,
): Promise<{ results: SearchResult[]; backend: string }> {
	for (const backend of backends) {
		try {
			const results = await backend.search(query, count, signal);
			if (results.length > 0) {
				return { results, backend: backend.name };
			}
		} catch {
			// try the next backend
		}
	}
	throw new Error(SEARCH_UNAVAILABLE_MESSAGE);
}

export async function executeSearch(
	params: StructuredSearchArgs,
	signal?: AbortSignal,
	backends?: SearchBackend[],
): Promise<SearchToolResult> {
	const count = params.count ?? 5;
	const built = buildSearchQuery(params);
	const { results, backend } = await runSearchChain(
		built.query,
		count,
		signal,
		backends,
	);

	return {
		content: [{ type: "text" as const, text: formatResults(results) }],
		details: {
			composedQuery: built.query,
			query: built.baseQuery,
			exactPhrases: built.exactPhrases,
			excludeTerms: built.excludeTerms,
			site: built.site,
			backend,
			resultCount: results.length,
		},
	};
}
