import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageContent } from '../src/MessageContent.js';
import { Markdown } from '../src/Markdown.js';
test('thinking grouped into a closed block, tools have named disclosures', () => {
 const html = renderToStaticMarkup(createElement(MessageContent, {workspace:'/work', message:{role:'assistant',content:[{type:'thinking',thinking:'one'},{type:'thinking',thinking:'two'},{type:'text',text:'Answer'},{type:'toolCall',name:'bash',arguments:{command:'pwd'}}]}}));
 assert.equal((html.match(/class="reasoning"/g) ?? []).length,1);
 assert.ok(!html.includes(' open=""'));
 assert.match(html,/Wywołanie/); assert.match(html,/bash/); assert.match(html,/Answer/);
});
test('local links survive Markdown sanitization without permitting javascript', () => {
 const html = renderToStaticMarkup(createElement(Markdown, {workspace:'/work',children:'See `src/app.ts` and [bad](javascript:alert).'}));
 assert.match(html,/title="\/work\/src\/app.ts"/);
 assert.ok(!html.includes('href="javascript:'));
 assert.ok(!html.includes('title="/work"'));
});
