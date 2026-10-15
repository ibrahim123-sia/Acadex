// Rich text: a light editor (bold, italic, headings, lists, links, quotes, code, maths) and the
// viewer. The server sanitises everything it stores; the viewer renders maths written as
// $…$ (inline) or $$…$$ (display) with KaTeX.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Quote, Sigma, Underline } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const MATH = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
/** the same pattern without the global flag (test() on a global regex keeps state between calls) */
const HAS_MATH = new RegExp(MATH.source);

/** Replace $…$ in text nodes with rendered maths (KaTeX escapes its input). */
function renderMath(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, .katex') ? NodeFilter.FILTER_REJECT : HAS_MATH.test(n.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(MATH)) {
      frag.append(text.slice(last, m.index));
      const span = document.createElement('span');
      try {
        katex.render(m[1] ?? m[2] ?? '', span, { displayMode: !!m[1], throwOnError: false, trust: false });
      } catch {
        span.textContent = m[0];
      }
      frag.append(span);
      last = (m.index ?? 0) + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/** Shows sanitised HTML from the server. */
export function RichText({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderMath(ref.current);
  }, [html]);
  return (
    <div
      ref={ref}
      className={cn('prose-acadex max-w-none break-words text-sm leading-relaxed text-fg', className)}
      // sanitised on the server (lib/html.ts) and again here, in case anything slipped through
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'] }) }}
    />
  );
}

/** A small rich-text editor on contentEditable. onChange gets HTML. */
export function RichEditor({ value, onChange, label, minHeight = 'min-h-40' }: { value: string; onChange: (html: string) => void; label: string; minHeight?: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // set the initial content once; afterwards the element owns it (re-setting would move the caret)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value && (document.activeElement !== ref.current || value === '')) ref.current.innerHTML = DOMPurify.sanitize(value);
  }, [value]);
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  };
  const link = () => {
    const url = window.prompt(t('editor.linkPrompt', 'Link address (https://…)'));
    if (url && /^https?:\/\//.test(url)) exec('createLink', url);
  };
  const math = () => {
    const tex = window.prompt(t('editor.mathPrompt', 'Formula in LaTeX, e.g. \\frac{a}{b}'));
    if (tex) exec('insertText', `$${tex}$`);
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      link();
    }
  };
  const tools: [string, typeof Bold, () => void][] = [
    [t('editor.bold', 'Bold'), Bold, () => exec('bold')],
    [t('editor.italic', 'Italic'), Italic, () => exec('italic')],
    [t('editor.underline', 'Underline'), Underline, () => exec('underline')],
    [t('editor.heading', 'Heading'), Heading2, () => exec('formatBlock', 'h2')],
    [t('editor.bullets', 'Bulleted list'), List, () => exec('insertUnorderedList')],
    [t('editor.numbers', 'Numbered list'), ListOrdered, () => exec('insertOrderedList')],
    [t('editor.quote', 'Quote'), Quote, () => exec('formatBlock', 'blockquote')],
    [t('editor.code', 'Code block'), Code, () => exec('formatBlock', 'pre')],
    [t('editor.link', 'Link (Ctrl+K)'), Link2, link],
    [t('editor.math', 'Formula'), Sigma, math],
  ];
  return (
    <div className="rounded-lg border border-border bg-surface focus-within:ring-2 focus-within:ring-ring">
      <div role="toolbar" aria-label={t('editor.toolbar', 'Formatting')} className="flex flex-wrap gap-0.5 border-b border-border p-1">
        {tools.map(([name, Icon, fn]) => (
          <button key={name} type="button" title={name} aria-label={name} onMouseDown={(e) => e.preventDefault()} onClick={fn} className="rounded p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onKeyDown={onKey}
        className={cn('prose-acadex max-w-none px-3 py-2 text-sm outline-none', minHeight)}
      />
    </div>
  );
}
