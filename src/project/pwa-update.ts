export type PwaSaveStatus = 'saving' | 'saved' | 'unsaved' | 'error';

export type PwaUpdateInput = {
  editingNote: boolean;
  editingRelationship: boolean;
  confirming: boolean;
  ingesting: boolean;
  adjustingRotation: boolean;
  drawing?: boolean;
  pdfViewing?: boolean;
  focusedField: boolean;
  readOnly: boolean;
  saveStatus: PwaSaveStatus;
  hasUnpersisted: boolean;
  hasRecovery: boolean;
  expectationMatches: boolean;
};

export type PwaUpdateDecision =
  | { action: 'allow' }
  | { action: 'flush' }
  | { action: 'block'; reason: string };

export function decidePwaUpdate(input: PwaUpdateInput): PwaUpdateDecision {
  if (input.editingNote || input.focusedField) return { action: 'block', reason: 'Finish editing before updating.' };
  if (input.editingRelationship) return { action: 'block', reason: 'Finish the relationship edit before updating.' };
  if (input.confirming) return { action: 'block', reason: 'Finish the open confirmation before updating.' };
  if (input.ingesting) return { action: 'block', reason: 'Wait for the image to finish before updating.' };
  if (input.adjustingRotation) return { action: 'block', reason: 'Finish the image rotation before updating.' };
  if (input.drawing) return { action: 'block', reason: 'Finish the pen stroke before updating.' };
  if (input.pdfViewing) return { action: 'block', reason: 'Close the PDF viewer before updating.' };
  if (input.saveStatus === 'error' || input.hasRecovery) {
    return { action: 'block', reason: 'A save still needs attention. Keep this board, or download a recovery ZIP, before updating.' };
  }
  if (input.readOnly && input.hasUnpersisted) {
    return { action: 'block', reason: 'This tab does not own the board. Download a recovery ZIP before updating.' };
  }
  if (input.hasUnpersisted || input.saveStatus === 'saving' || input.saveStatus === 'unsaved') return { action: 'flush' };
  if (!input.expectationMatches) {
    return { action: 'block', reason: 'The stored board does not match this tab. The update was not applied.' };
  }
  return { action: 'allow' };
}

export function shouldActivateWorker(decision: PwaUpdateDecision): boolean {
  return decision.action === 'allow';
}
