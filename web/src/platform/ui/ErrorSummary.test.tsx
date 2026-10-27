import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api-error.js';
import { ErrorSummary } from './ErrorSummary.js';

describe('ErrorSummary', () => {
  it('renders the API envelope: summary, details, and support id', () => {
    render(
      <ErrorSummary
        error={
          new ApiError({
            summary: 'Complete-action schema failed.',
            errorCode: 'OPTIC-WF-40050',
            referenceId: 'OPTIC-8F71C239',
            details: [{ message: 'receiptNumber is required', inputId: 'field-receiptNumber' }]
          })
        }
      />
    );
    expect(screen.getByText('Complete-action schema failed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'receiptNumber is required' })).toHaveAttribute('href', '#field-receiptNumber');
    expect(screen.getByText('Give this id to support: OPTIC-8F71C239')).toBeInTheDocument();
  });
});
