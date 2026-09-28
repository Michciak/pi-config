import assert from "node:assert/strict";
import test from "node:test";
import { applySnippets, parseSnippet } from "../src/index.ts";

test("parses frontmatter and applies snippets in placement order", () => {
  const prepend = parseSnippet("pre.md", "---\nname: Start\nplacement: prepend\norder: 10\n---\nFirst")!;
  const append = parseSnippet("post.md", "---\nname: End\nplacement: append\n---\nLast")!;
  assert.equal(prepend.name, "Start");
  assert.equal(applySnippets("Prompt", [prepend, append], ["pre.md", "post.md"]), "First\n\nPrompt\n\nLast");
});
