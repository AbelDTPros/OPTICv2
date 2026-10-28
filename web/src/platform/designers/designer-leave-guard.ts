let designerHasUnsavedChanges = false;

export function setDesignerUnsavedChanges(dirty: boolean): void {
  designerHasUnsavedChanges = dirty;
}

export function designerHasUnsaved(): boolean {
  return designerHasUnsavedChanges;
}

/** Returns true when navigation away from Designer should proceed. */
export function confirmLeaveDesigner(message?: string): boolean {
  if (!designerHasUnsavedChanges) {
    return true;
  }
  return window.confirm(
    message ?? 'You have unsaved Designer changes. Leave without saving?'
  );
}
