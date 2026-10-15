// Rich text from the editor (course pages, instructions, feedback, posts) is untrusted: it is
// sanitised on the server before it is stored, whatever the browser sent. Allowed: formatting,
// lists, tables, links, images, code blocks, maths rendered by KaTeX (as spans with classes) and
// video embeds from a short list of hosts.
import sanitize from 'sanitize-html';

export interface VideoRef {
  provider: 'youtube' | 'vimeo' | 'loom' | 'drive' | 'file';
  ref: string;
  embedUrl: string;
}

/** A video link the course space can embed, or null when the host isn't allowed. */
export function parseVideoUrl(raw: string): VideoRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  const idOk = (s: string | null | undefined): s is string => !!s && /^[A-Za-z0-9_-]{6,64}$/.test(s);
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null);
    return idOk(v) ? { provider: 'youtube', ref: v, embedUrl: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === 'youtu.be') {
    const v = u.pathname.slice(1);
    return idOk(v) ? { provider: 'youtube', ref: v, embedUrl: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.split('/').filter(Boolean).pop();
    return v && /^\d{5,12}$/.test(v) ? { provider: 'vimeo', ref: v, embedUrl: `https://player.vimeo.com/video/${v}` } : null;
  }
  if (host === 'loom.com') {
    const v = u.pathname.split('/').filter(Boolean).pop();
    return idOk(v) ? { provider: 'loom', ref: v, embedUrl: `https://www.loom.com/embed/${v}` } : null;
  }
  if (host === 'drive.google.com') {
    const m = /\/file\/d\/([A-Za-z0-9_-]{10,80})/.exec(u.pathname);
    return m ? { provider: 'drive', ref: m[1]!, embedUrl: `https://drive.google.com/file/d/${m[1]}/preview` } : null;
  }
  return null;
}

const EMBED_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com', 'www.loom.com', 'drive.google.com'];

const OPTIONS: sanitize.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'pre', 'code', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'iframe', 'details', 'summary',
    // KaTeX output
    'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtext', 'annotation', 'mspace', 'mtable', 'mtr', 'mtd', 'munder', 'mover', 'munderover', 'mstyle', 'svg', 'path', 'line',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'title'],
    span: ['class', 'style', 'aria-hidden', 'data-latex'],
    div: ['class', 'data-latex'],
    code: ['class'],
    pre: ['class'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    ol: ['start'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    svg: ['xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio'],
    path: ['d'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke-width'],
    '*': ['dir', 'lang'],
  },
  allowedClasses: {
    span: [/^katex.*/, /^m[a-z]+$/, /^(base|strut|vlist.*|pstrut|sizing|reset-size\d+|size\d+|mord|mbin|mrel|mopen|mclose|mpunct|minner|mop|mspace|frac-line|sqrt|hide-tail|delimsizing|mult|nulldelimiter|accent.*|overline.*|underline.*|col-align-.|arraycolsep|svg-align|stretchy|hljs.*|text|rlap|llap|clap|thinbox|newline)$/],
    div: ['math-display', 'math-block', /^katex.*/],
    code: [/^language-[a-z0-9+#-]+$/, /^hljs.*/],
    pre: [/^language-[a-z0-9+#-]+$/],
  },
  allowedStyles: {
    span: {
      height: [/^-?[\d.]+em$/],
      'vertical-align': [/^-?[\d.]+em$/],
      'margin-right': [/^-?[\d.]+em$/],
      'margin-left': [/^-?[\d.]+em$/],
      top: [/^-?[\d.]+em$/],
      width: [/^-?[\d.]+em$/],
      'min-width': [/^-?[\d.]+em$/],
      'padding-left': [/^-?[\d.]+em$/],
      'border-bottom-width': [/^-?[\d.]+em$/],
    },
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedSchemesByTag: { img: ['https', 'http', 'data'] },
  allowedIframeHostnames: EMBED_HOSTS,
  allowProtocolRelative: false,
  transformTags: {
    // links open in a new tab without giving the target page a handle on ours
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer nofollow', ...(attribs.href?.startsWith('/') ? {} : { target: '_blank' }) } }),
    iframe: (tagName, attribs) => ({ tagName, attribs: { ...attribs, allow: 'fullscreen; picture-in-picture', allowfullscreen: 'true' } }),
  },
  // drop frames from hosts that aren't allowed (their src is removed), and non-image data URLs
  exclusiveFilter: (frame) =>
    (frame.tag === 'iframe' && !frame.attribs.src) ||
    (frame.tag === 'img' && !!frame.attribs.src && frame.attribs.src.startsWith('data:') && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(frame.attribs.src)),
};

/** Safe HTML for display. */
export function cleanHtml(html: string | null | undefined): string {
  if (!html) return '';
  return sanitize(html, OPTIONS).trim();
}

/** Plain text (for previews, emails, search). */
export function htmlToText(html: string | null | undefined, max = 300): string {
  const t = sanitize(html ?? '', { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Escape text for inclusion in HTML. */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
