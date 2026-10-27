import type { ReactNode } from 'react';

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let part = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${part++}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="optic-guide-code">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const href = link[2]!;
        const label = link[1]!;
        if (href.startsWith('#')) {
          nodes.push(
            <a key={key} href={href} className="optic-guide-anchor">
              {label}
            </a>
          );
        } else if (href.endsWith('.md') || href.includes('.md#')) {
          nodes.push(
            <span key={key} className="optic-guide-doc-ref">
              {label}
            </span>
          );
        } else {
          nodes.push(
            <a key={key} href={href} target="_blank" rel="noreferrer">
              {label}
            </a>
          );
        }
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes.length > 0 ? nodes : [text];
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Renders the subset of Markdown used by OPTIC end-user guides. */
export function MarkdownGuide({ source }: { source: string }): ReactNode {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let block = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed === '---') {
      blocks.push(<hr key={`hr-${block++}`} className="optic-guide-rule" />);
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      const id = slugify(text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, ''));
      const children = inline(text, `h-${block}`);
      if (level === 1) {
        blocks.push(
          <h1 key={`h-${block++}`} id={id} className="optic-guide-title">
            {children}
          </h1>
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={`h-${block++}`} id={id}>
            {children}
          </h2>
        );
      } else {
        blocks.push(
          <h3 key={`h-${block++}`} id={id}>
            {children}
          </h3>
        );
      }
      i += 1;
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? '')) {
      const header = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]!));
        i += 1;
      }
      blocks.push(
        <div key={`table-${block++}`} className="optic-guide-table-wrap">
          <table className="optic-guide-table">
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={index}>{inline(cell, `th-${block}-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, colIndex) => (
                    <td key={colIndex}>{inline(row[colIndex] ?? '', `td-${block}-${rowIndex}-${colIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${block++}`} className="optic-guide-list">
          {items.map((item, index) => (
            <li key={index}>{inline(item, `ul-${block}-${index}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${block++}`} className="optic-guide-list">
          {items.map((item, index) => (
            <li key={index}>{inline(item, `ol-${block}-${index}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraph: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] ?? '').trim();
      if (
        !next ||
        next === '---' ||
        next.startsWith('#') ||
        next.startsWith('|') ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      i += 1;
    }
    blocks.push(
      <p key={`p-${block++}`} className="optic-guide-paragraph">
        {inline(paragraph.join(' '), `p-${block}`)}
      </p>
    );
  }

  return <div className="optic-guide-body">{blocks}</div>;
}
