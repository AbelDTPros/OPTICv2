import { Icon } from './Icon.js';

export function PagerControls({
  page,
  totalPages,
  disabled,
  ariaLabel,
  onPageChange
}: {
  page: number;
  totalPages: number;
  disabled?: boolean;
  ariaLabel: string;
  onPageChange: (page: number) => void;
}) {
  const safeTotal = Math.max(0, totalPages);
  const safePage = safeTotal === 0 ? 0 : Math.min(Math.max(page, 1), safeTotal);

  return (
    <nav className="optic-pager" aria-label={ariaLabel}>
      <button
        type="button"
        className="optic-pager-button"
        aria-label="Previous page"
        disabled={disabled || safePage <= 1}
        onClick={() => onPageChange(safePage - 1)}
      >
        <Icon name="chevronLeft" />
      </button>
      <span className="optic-pager-status" aria-live="polite">
        Page {safePage} of {safeTotal}
      </span>
      <button
        type="button"
        className="optic-pager-button"
        aria-label="Next page"
        disabled={disabled || safeTotal === 0 || safePage >= safeTotal}
        onClick={() => onPageChange(safePage + 1)}
      >
        <Icon name="chevronRight" />
      </button>
    </nav>
  );
}
