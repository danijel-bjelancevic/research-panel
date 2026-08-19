import { describe, expect, it } from 'vitest';
import { escapeHtml, mdToHtml } from '../src/md.js';

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<script>"a" & \'b\'</script>')).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
  });
});

describe('mdToHtml', () => {
  it('renders headings, paragraphs and inline styles', () => {
    const html = mdToHtml('## Title\n\nSome **bold** and _italic_ text with `code`.');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders lists', () => {
    const html = mdToHtml('- one\n- two\n\n1. first\n2. second');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
  });

  it('renders links but only for http(s) URLs', () => {
    const html = mdToHtml('[site](https://example.com) and [bad](javascript:alert(1))');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener">site</a>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('[bad]');
  });

  it('renders tables', () => {
    const html = mdToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('renders fenced code without inline processing', () => {
    const html = mdToHtml('```\nconst a = "**not bold**";\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('**not bold**');
    expect(html).not.toContain('<strong>');
  });

  it('escapes HTML inside markdown so model output cannot inject markup', () => {
    const html = mdToHtml('Hello <img src=x onerror=alert(1)> **world**');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>world</strong>');
  });

  it('renders blockquotes and horizontal rules', () => {
    const html = mdToHtml('> quoted wisdom\n\n---\n\nafter');
    expect(html).toContain('<blockquote>quoted wisdom</blockquote>');
    expect(html).toContain('<hr>');
  });
});
