export type EscapeDecision = 'password' | 'close-search' | 'close-views' | 'ignore' | 'release-tool' | 'exit-xray' | 'idle';

export function decideEscape(input: {
  passwordPrompt: boolean;
  searchOpen: boolean;
  viewsOpen: boolean;
  editingField: boolean;
  editing: boolean;
  inDialog: boolean;
  inkGesture: boolean;
  framing: boolean;
  tool: string;
  xrayLens: boolean;
}): EscapeDecision {
  if (input.passwordPrompt) return 'password';
  if (input.searchOpen) return 'close-search';
  if (input.viewsOpen && !input.editingField) return 'close-views';
  if (input.editingField || input.editing) return 'ignore';
  if (input.tool !== 'select' || input.framing || input.inkGesture) return 'release-tool';
  if (input.inDialog) return 'idle';
  if (input.xrayLens) return 'exit-xray';
  return 'idle';
}
