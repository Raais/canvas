const TASK = /^(\s*[-*+] )\[([ xX])\]/;

export function toggleTask(source: string, taskIndex: number): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  let fence = false;
  let seen = 0;
  const next = lines.map((line) => {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    if (line.includes('`') && !TASK.test(line)) return line;
    const match = TASK.exec(line);
    if (!match) return line;
    if (seen++ !== taskIndex) return line;
    const mark = match[2] === ' ' ? 'x' : ' ';
    return `${match[1]}[${mark}]${line.slice(match[0].length)}`;
  });
  return next.join(newline);
}

export function toggleHighlight(source: string, start: number, end: number): { text: string; start: number; end: number } | null {
  if (start === end) return null;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const selected = source.slice(from, to);
  const before = source.slice(Math.max(0, from - 2), from);
  const after = source.slice(to, to + 2);
  if (before === '==' && after === '==') {
    return { text: source.slice(0, from - 2) + selected + source.slice(to + 2), start: from - 2, end: to - 2 };
  }
  if (selected.startsWith('==') && selected.endsWith('==') && selected.length >= 4) {
    const inner = selected.slice(2, -2);
    return { text: source.slice(0, from) + inner + source.slice(to), start: from, end: from + inner.length };
  }
  const wrapped = `==${selected}==`;
  return { text: source.slice(0, from) + wrapped + source.slice(to), start: from, end: from + wrapped.length };
}

export function safeHref(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, 'https://canvas.local');
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}
