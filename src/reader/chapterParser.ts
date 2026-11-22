import * as cheerio from 'cheerio';

export type ChapterBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'divider' }
  | { type: 'image'; uri: string; alt?: string };

function resolveImageUrl(src: string, baseUrl?: string): string {
  const trimmed = src.trim();
  if (/^(https?:|file:|data:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function cleanText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseChapterHtml(html: string, baseUrl?: string): ChapterBlock[] {
  if (!html || !html.trim()) return [];
  const $ = cheerio.load(`<div id="__root__">${html}</div>`);
  $('#__root__ script, #__root__ style, #__root__ noscript, #__root__ iframe').remove();

  const blocks: ChapterBlock[] = [];
  const root = $('#__root__');

  const emitImagesIn = (el: cheerio.Cheerio<any>) => {
    el.find('img').each((_, img) => {
      const src = $(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-lazy-src');
      if (src && src.trim()) {
        const alt = $(img).attr('alt')?.trim();
        const block: ChapterBlock = {
          type: 'image',
          uri: resolveImageUrl(src, baseUrl),
          ...(alt ? { alt } : {}),
        };
        blocks.push(block);
      }
    });
  };

  const walk = (container: cheerio.Cheerio<any>) => {
    container.contents().each((_, node) => {
      if (node.type === 'text') {
        const txt = cleanText((node as { data?: string }).data ?? '');
        if (txt) blocks.push({ type: 'paragraph', text: txt });
        return;
      }

      if (node.type !== 'tag') return;
      const tag = node.tagName.toLowerCase();
      const $el = $(node);

      if (tag === 'hr') {
        blocks.push({ type: 'divider' });
        return;
      }

      if (tag === 'img') {
        const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src');
        if (src && src.trim()) {
          const alt = $el.attr('alt')?.trim();
          blocks.push({
            type: 'image',
            uri: resolveImageUrl(src, baseUrl),
            ...(alt ? { alt } : {}),
          });
        }
        return;
      }

      if (/^h[1-6]$/.test(tag)) {
        const txt = cleanText($el.text());
        if (txt) blocks.push({ type: 'heading', text: txt });
        return;
      }

      if (tag === 'blockquote') {
        const txt = cleanText($el.text());
        if (txt) blocks.push({ type: 'blockquote', text: txt });
        emitImagesIn($el);
        return;
      }

      if (tag === 'p' || tag === 'li') {
        // Emit any images inside the paragraph, plus its text if non-empty.
        const clone = $el.clone();
        clone.find('img').remove();
        const txt = cleanText(clone.text());
        if (txt) blocks.push({ type: 'paragraph', text: txt });
        emitImagesIn($el);
        return;
      }

      // Container tags (div, section, article, span, etc.) recurse cleanly
      const hasBlockChildren = $el.children('p, div, h1, h2, h3, h4, h5, h6, blockquote, hr, ul, ol, section, article, figure, img').length > 0;
      if (hasBlockChildren) {
        walk($el);
      } else {
        const txt = cleanText($el.text());
        if (txt) blocks.push({ type: 'paragraph', text: txt });
      }
    });
  };

  walk(root);
  return blocks;
}
