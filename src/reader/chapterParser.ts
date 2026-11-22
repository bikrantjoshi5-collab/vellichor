import * as cheerio from 'cheerio/slim';

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

function pickImageSource($img: cheerio.Cheerio<any>): string | null {
  const candidates = [
    $img.attr('data-src'),
    $img.attr('data-lazy-src'),
    $img.attr('data-original'),
    $img.attr('src'),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    // Skip 1x1 lazy-load placeholder gifs if another candidate exists
    if (/^data:image\/gif/i.test(trimmed) || /loading\.gif|placeholder/i.test(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return $img.attr('src')?.trim() || null;
}

function cleanLine(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/[ \t\r]+/g, ' ').trim();
}

function extractLinesWithBr($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string[] {
  const clone = $el.clone();
  clone.find('img').remove();
  clone.find('br').replaceWith('\n');
  return clone
    .text()
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line.length > 0);
}

export function parseChapterHtml(html: string, baseUrl?: string): ChapterBlock[] {
  if (!html || !html.trim()) return [];
  const $ = cheerio.load(`<div id="__root__">${html}</div>`);
  $('#__root__ script, #__root__ style, #__root__ noscript, #__root__ iframe').remove();

  const blocks: ChapterBlock[] = [];
  const root = $('#__root__');

  const emitImagesIn = ($el: cheerio.Cheerio<any>) => {
    $el.find('img').each((_, img) => {
      const $img = $(img);
      const src = pickImageSource($img);
      if (src) {
        const alt = $img.attr('alt')?.trim();
        blocks.push({
          type: 'image',
          uri: resolveImageUrl(src, baseUrl),
          ...(alt ? { alt } : {}),
        });
      }
    });
  };

  const walk = (container: cheerio.Cheerio<any>) => {
    container.contents().each((_, node) => {
      if (node.type === 'text') {
        const txt = cleanLine((node as { data?: string }).data ?? '');
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

      if (tag === 'br') {
        return;
      }

      if (tag === 'img') {
        const src = pickImageSource($el);
        if (src) {
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
        const txt = cleanLine($el.text());
        if (txt) blocks.push({ type: 'heading', text: txt });
        return;
      }

      if (tag === 'blockquote') {
        const lines = extractLinesWithBr($, $el);
        for (const line of lines) {
          blocks.push({ type: 'blockquote', text: line });
        }
        emitImagesIn($el);
        return;
      }

      if (tag === 'p' || tag === 'li') {
        const lines = extractLinesWithBr($, $el);
        for (const line of lines) {
          blocks.push({ type: 'paragraph', text: line });
        }
        emitImagesIn($el);
        return;
      }

      // Recurse into any wrapper element containing block children OR nested <img> (e.g. <div><a><img/></a></div>, <center><img/></center>)
      const hasStructuredChildren =
        $el.children('p, div, h1, h2, h3, h4, h5, h6, blockquote, hr, ul, ol, section, article, figure, center, a, span, img').length > 0 &&
        ($el.find('img').length > 0 ||
          $el.children('p, div, h1, h2, h3, h4, h5, h6, blockquote, hr, ul, ol, section, article, figure, center').length > 0);

      if (hasStructuredChildren) {
        walk($el);
      } else {
        const lines = extractLinesWithBr($, $el);
        for (const line of lines) {
          blocks.push({ type: 'paragraph', text: line });
        }
      }
    });
  };

  walk(root);
  return blocks;
}
