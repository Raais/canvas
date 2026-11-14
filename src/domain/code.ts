export type CodeGuess = {
  presentation: 'text' | 'code';
  language?: string;
};

const FENCE = /^```([a-z0-9+#-]*)\s*\n([\s\S]*?)\n?```\s*$/i;

const LANGUAGES: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript',
  jsx: 'JavaScript',
  py: 'Python',
  python: 'Python',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
};

export function classifyPlainText(text: string): CodeGuess {
  const trimmed = text.trim();
  const fence = FENCE.exec(trimmed);
  if (fence) {
    const declared = fence[1]?.toLowerCase() ?? '';
    return { presentation: 'code', ...(LANGUAGES[declared] ? { language: LANGUAGES[declared] } : {}) };
  }
  if (!trimmed.includes('\n')) return { presentation: 'text' };
  if (looksLikeJson(trimmed)) return { presentation: 'code', language: 'JSON' };
  if (strongCode(trimmed)) return { presentation: 'code', language: guessLanguage(trimmed) };
  return { presentation: 'text' };
}

function looksLikeJson(text: string): boolean {
  if (!/^[[{]/.test(text)) return false;
  try {
    const value = JSON.parse(text);
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}

function strongCode(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  let signals = 0;
  if (/^(import|export|from)\s/m.test(text)) signals += 1;
  if (/^(def|class|function)\s/m.test(text)) signals += 1;
  if (/=>\s*[{(]/m.test(text)) signals += 1;
  if (/^(const|let|var)\s+\w+\s*=/m.test(text) && /[{;}]/m.test(text)) signals += 1;
  if (/^#!/.test(text) || /\b(if|for|while)\s*\(.*\)\s*[{:]/m.test(text)) signals += 1;
  return signals >= 2;
}

function guessLanguage(text: string): string | undefined {
  if (/^def |:\s*$/m.test(text) && /:\n/.test(text)) return 'Python';
  if (/^(import|export)\s/m.test(text) || /=>/.test(text)) return 'TypeScript';
  if (/^#!/.test(text)) return 'Shell';
  if (/<[a-z][\s\S]*>/i.test(text) && /<\/[a-z]/i.test(text)) return 'HTML';
  return undefined;
}
