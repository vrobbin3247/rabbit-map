import { memo, useMemo, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { protectCurrency, resolve, wikilinksToMarkdownLinks } from '@mindmapper/shared';
import { toneOf } from '../canvas/ConceptNodeView';
import { useStore } from '../state/store';

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

/** Only http, https, mailto, in-page and our own concept: links survive. */
export const safeUrl = (url: string) => (/^(https?:|mailto:|concept:|#)/i.test(url) ? url : '');

function ConceptLink({ href, fromNodeId, children }: { href: string; fromNodeId: string; children: ReactNode }) {
  const index = useStore((s) => s.index);
  const map = useStore((s) => s.map);
  const target = (() => {
    try {
      return decodeURIComponent(href.slice('concept:'.length));
    } catch {
      return href.slice('concept:'.length);
    }
  })();
  const id = index ? resolve(index, target) : undefined;
  const node = id && map ? map.nodes[id] : undefined;

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const st = useStore.getState();
    if (id) return st.select(id);
    const snippet = e.currentTarget.closest('p, li, blockquote')?.textContent ?? '';
    void st.openConcept(fromNodeId, target, snippet.trim());
  };

  return (
    <button
      type="button"
      className={node ? (node.status === 'stub' ? 'link-concept stub' : 'link-concept') : 'link-ghost'}
      data-tone={node && index ? toneOf(node, index.depth.get(node.id) ?? 0) : undefined}
      data-concept={target}
      data-existing={node ? 'true' : 'false'}
      title={node ? node.summary || node.title : 'Not opened yet. Click to add.'}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const Markdown = memo(function Markdown({ text, fromNodeId }: { text: string; fromNodeId: string }) {
  const source = useMemo(() => protectCurrency(wikilinksToMarkdownLinks(text)), [text]);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={safeUrl}
        components={{
          // Never load an image from the internet: that would send a request out of this machine.
          img: ({ alt }) => <span className="muted">[image{alt ? `: ${alt}` : ''}]</span>,
          a: ({ href, children }) =>
            href?.startsWith('concept:') ? (
              <ConceptLink href={href} fromNodeId={fromNodeId}>{children}</ConceptLink>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
            ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
