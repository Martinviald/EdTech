'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Render seguro del markdown que produce el asistente (E21 — Ola 4).
 *
 * SEGURIDAD: usa `react-markdown` SIN `rehype-raw` → NO renderiza HTML crudo
 * (defensa contra inyección §4.3, ya que el texto es salida de un LLM que mezcla
 * datos de tools). Las URLs las sanea remark por defecto (descarta `javascript:`
 * etc.); los links se abren en pestaña nueva con `rel="noopener noreferrer"`. Las
 * imágenes se ignoran (no se renderizan) por minimización. NO agregar `rehype-raw`.
 *
 * Los elementos se estilan con clases Tailwind (sin el plugin `typography`),
 * compactas para el ancho del panel. Apto para streaming: markdown parcial
 * (p. ej. un `**` sin cerrar) degrada de forma elegante.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold">{children}</h4>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-1.5 overflow-x-auto rounded bg-background/60 p-2 text-xs">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  img: () => null, // minimización: no renderizar imágenes externas
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed [word-break:break-word]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
