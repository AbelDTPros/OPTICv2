import { ButtonLabel } from '../ui/Icon.js';

export function SaveDraftButton({
  dirty,
  disabled,
  onClick
}: {
  dirty: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const blocked = Boolean(disabled) || !dirty;
  return (
    <button
      type="button"
      className={dirty ? 'optic-button-primary' : 'optic-button-save-clean'}
      disabled={blocked}
      title={
        disabled
          ? undefined
          : dirty
            ? 'Save unsaved changes on this draft'
            : 'No unsaved changes'
      }
      onClick={onClick}
    >
      <ButtonLabel icon="save">{dirty ? 'Save draft' : 'Saved'}</ButtonLabel>
    </button>
  );
}
