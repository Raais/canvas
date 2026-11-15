export type ShortcutGuard = {
  defaultPrevented: boolean;
  composing: boolean;
  repeat: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  tag: string | null;
  editable: boolean;
  inOverlay: boolean;
  editing: boolean;
  blocked: boolean;
};

export function plainShortcutBlocked(guard: ShortcutGuard): boolean {
  if (guard.defaultPrevented || guard.composing || guard.repeat) return true;
  if (guard.meta || guard.ctrl || guard.alt || guard.shift) return true;
  if (guard.editing || guard.blocked || guard.inOverlay) return true;
  if (guard.editable) return true;
  if (guard.tag === 'INPUT' || guard.tag === 'TEXTAREA' || guard.tag === 'SELECT' || guard.tag === 'BUTTON' || guard.tag === 'A') return true;
  return false;
}

export function zoomSelectionKey(key: string, selectedCount: number): boolean {
  return key.toLowerCase() === 'g' && selectedCount === 1;
}

export function collapseSelectionKey(key: string, selectedCount: number): boolean {
  return key.toLowerCase() === 'u' && selectedCount === 1;
}

export function canLinkSelection(count: number, alreadyLinked: boolean): boolean {
  return count === 2 && !alreadyLinked;
}

export function searchShortcut(input: {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  composing: boolean;
  repeat: boolean;
  editingField: boolean;
  confirming: boolean;
  editing: boolean;
}): boolean {
  if (input.composing || input.repeat || input.alt || input.shift || input.editingField || input.confirming || input.editing) return false;
  if (!input.meta && !input.ctrl) return false;
  return input.key.toLowerCase() === 'k';
}

export function canEditSelection(count: number, kind: string | null): boolean {
  return count === 1 && kind === 'text';
}
