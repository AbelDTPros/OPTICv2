import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonLabel, ErrorHeading, Icon, StatusPill } from './Icon.js';

describe('Icon', () => {
  it('hides decorative marks from the accessible name', () => {
    render(
      <button type="button">
        <ButtonLabel icon="save">Save draft</ButtonLabel>
      </button>
    );
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps status and error text as the accessible name', () => {
    render(
      <>
        <StatusPill>DRAFT</StatusPill>
        <ErrorHeading />
      </>
    );
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'There is a problem' })).toBeInTheDocument();
    expect(document.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(1);
  });

  it('renders the requested icon mark', () => {
    const { container } = render(
      <>
        <Icon name="search" />
        <Icon name="clear" />
        <Icon name="trash" />
        <Icon name="scan" />
        <Icon name="calendar" />
      </>
    );
    expect(container.querySelectorAll('svg.optic-icon')).toHaveLength(5);
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(5);
  });

  it('keeps queue action labels as the accessible name', () => {
    render(
      <>
        <button type="button">
          <ButtonLabel icon="release">Release</ButtonLabel>
        </button>
        <button type="button">
          <ButtonLabel icon="reassign">Reassign</ButtonLabel>
        </button>
      </>
    );
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeInTheDocument();
    expect(document.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
    expect(document.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });
});
