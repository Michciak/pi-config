function safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function absolutePath(reference: string, workspace?: string): string | null {
  if (!reference || reference.startsWith("#")) return null;
  const value = reference.replace(/:\d+(?::\d+)?$/, "");
  if (/^[a-z][\w+.-]*:/i.test(value) && !value.startsWith("file://")) return null;
  if (value.startsWith("file://")) {
    try { return decodeURIComponent(new URL(value).pathname); } catch { return null; }
  }
  if (value.startsWith("/")) return safeDecode(value);
  if (!workspace || value.startsWith("~/")) return null;
  return `${workspace.replace(/\/+$/, "")}/${safeDecode(value)}`;
}

export function localFilePath(href: string, workspace?: string): string | null {
  return absolutePath(href, workspace);
}

export function linkLocalReferences(markdown: string, workspace?: string): string {
  let fence: { marker: string; length: number } | undefined;
  const tokens = /!?\[[^\]\n]*\]\((?:<[^>\n]*>|[^)\n]*)\)|`+[^`\n]*`+|[a-zA-Z][\w+.-]*:\/\/[^\s<>]+|(?<![\w/])(?:[./\p{L}\p{N}_@+-]+\/)*[\p{L}\p{N}_@+-]+\.[\p{L}\p{N}_.+-]+(?::\d+(?::\d+)?)?/gu;
  return markdown.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1]![0] === fence.marker && marker[1]!.length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined;
      return line;
    }
    if (marker) { fence = { marker: marker[1]![0]!, length: marker[1]!.length }; return line; }
    if (/^( {4}|\t)/.test(line)) return line;
    return line.replace(tokens, (token) => {
      if (token.startsWith("![") || token.startsWith("[") || /^[a-zA-Z][\w+.-]*:\/\//.test(token)) return token;
      const code = token.startsWith("`");
      const reference = code ? token.replace(/^`+|`+$/g, "") : token.replace(/[.,;]+$/, "");
      if (!reference.includes("/") && !/^[\p{L}_@-][\p{L}\p{N}_@.-]*\.[a-zA-Z][a-zA-Z0-9]{0,12}(?::\d+)?$/u.test(reference)) return token;
      const withoutLine = reference.replace(/:\d+(?::\d+)?$/, "");
      const extension = /\.([a-zA-Z0-9]+)$/.exec(withoutLine)?.[1]?.toLowerCase();
      const knownExtensions = new Set("ts tsx js jsx mjs cjs json md mdx txt py sh zsh bash cs csproj sln razor kt kts java swift c cpp h hpp go rs rb php html css scss yaml yml xml toml ini conf cfg sql proto gradle properties lock svg png jpg jpeg pdf csv vue svelte log env gitignore".split(" "));
      if (!reference.startsWith("/") && !reference.startsWith("./") && !reference.startsWith("../") && (!extension || !knownExtensions.has(extension))) return token;
      const path = absolutePath(reference, workspace);
      if (!path) return token;
      const label = code ? token : reference.replace(/[\[\]]/g, "\\$&");
      return `[${label}](<${encodeURI(`file://${path}`)}>)${code ? "" : token.slice(reference.length)}`;
    });
  }).join("\n");
}
