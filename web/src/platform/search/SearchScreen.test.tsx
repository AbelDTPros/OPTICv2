import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { SearchScreen } from './SearchScreen.js';
import * as searchApi from './search-api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchScreen', () => {
  it('renders a labeled search form', async () => {
    const { container } = render(<SearchScreen />);
    expect(screen.getByRole('heading', { name: 'Find a case' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tracking ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Receipt number')).toBeInTheDocument();
    expect(screen.getByLabelText('Entity type')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('keeps Workspace compact search short until Advanced is opened', async () => {
    const user = userEvent.setup();
    render(<SearchScreen compact />);
    expect(screen.getByLabelText('Tracking ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Receipt number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Entity type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assignee')).not.toBeInTheDocument();
    await user.click(screen.getByText(/Advanced search/));
    expect(screen.getByLabelText('Entity type')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
  });

  it('renders catalog extra fields and sends them as criteria', async () => {
    const user = userEvent.setup();
    const findCases = vi.spyOn(searchApi, 'findCases').mockResolvedValue({
      q: '',
      page: 1,
      pageSize: 25,
      total: 0,
      hits: []
    });
    render(
      <SearchScreen
        compact
        definitionKeys={['I_G325A_MAILITEM', 'I_G325A_WORKLOAD']}
        extraFields={[
          {
            fieldKey: 'Status',
            source: 'BUSINESS_DATA',
            path: '$.Status',
            match: 'EXACT_PREFIX',
            pii: false
          }
        ]}
      />
    );
    await user.click(screen.getByText(/Advanced search/));
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Status'), 'Accepted');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(findCases).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: { Status: 'Accepted' },
        definitionKeys: ['I_G325A_MAILITEM', 'I_G325A_WORKLOAD']
      })
    );
    expect(screen.getByText(/1 active/)).toBeInTheDocument();
    expect(screen.getByText(/limited to the selected Workload Type/)).toBeInTheDocument();
  });

  it('clears fields and hides results', async () => {
    const user = userEvent.setup();
    const findCases = vi.spyOn(searchApi, 'findCases').mockResolvedValue({
      q: 'W-9',
      page: 1,
      pageSize: 25,
      total: 1,
      hits: [
        {
          trackingId: 'W-9001',
          entityType: 'WORKLOAD',
          definitionKey: 'I_90',
          version: '0.1.0',
          currentStageKey: 'READY_FOR_DATA_ENTRY',
          assignedTo: null,
          slaState: null,
          rowVersion: 1,
          matchedFields: [{ fieldKey: 'trackingId', value: 'W-9001', pii: false }]
        }
      ]
    });
    render(<SearchScreen compact />);
    await user.click(screen.getByText(/Advanced search/));
    expect(screen.getByLabelText('Entity type')).toBeInTheDocument();
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tracking ID'), 'W-9');
    await user.type(screen.getByLabelText('Receipt number'), 'ABC');
    await user.type(screen.getByLabelText('Entity type'), 'workload');
    await user.type(screen.getByLabelText('Stage'), 'ready_for_data_entry');
    await user.type(screen.getByLabelText('Assignee'), 'officer@example.gov');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(findCases).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'W-9',
        receiptNumber: 'ABC',
        entityType: 'WORKLOAD',
        currentStageKey: 'READY_FOR_DATA_ENTRY',
        assignedTo: 'officer@example.gov'
      })
    );
    expect(await screen.findByText('1 result for tracking W-9')).toBeInTheDocument();
    expect(screen.getByText('W-9001')).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.optic-search-hit-index' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Tracking ID')).toHaveValue('');
    expect(screen.getByLabelText('Receipt number')).toHaveValue('');
    expect(screen.queryByLabelText('Entity type')).not.toBeInTheDocument();
    expect(screen.queryByText(/result/)).not.toBeInTheDocument();
    expect(screen.queryByText('W-9001')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByLabelText('Tracking ID')).toHaveFocus();
  });

  it('opens a result from the row instead of a separate Open button', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    vi.spyOn(searchApi, 'findCases').mockResolvedValue({
      q: 'W-9',
      page: 1,
      pageSize: 25,
      total: 1,
      hits: [
        {
          trackingId: 'W-9001',
          entityType: 'WORKLOAD',
          definitionKey: 'I_90',
          version: '0.1.0',
          currentStageKey: 'READY_FOR_DATA_ENTRY',
          assignedTo: null,
          slaState: null,
          rowVersion: 1,
          matchedFields: [{ fieldKey: 'trackingId', value: 'W-9001', pii: false }]
        }
      ]
    });
    render(<SearchScreen compact onOpen={onOpen} />);
    await user.type(screen.getByLabelText('Tracking ID'), 'W-9');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.queryByRole('button', { name: 'Open W-9001' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Open WORKLOAD W-9001, row 1' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ trackingId: 'W-9001' }));
  });

  it('marks the open search hit as current', async () => {
    const user = userEvent.setup();
    vi.spyOn(searchApi, 'findCases').mockResolvedValue({
      q: 'W-9',
      page: 1,
      pageSize: 25,
      total: 1,
      hits: [
        {
          trackingId: 'W-9001',
          entityType: 'WORKLOAD',
          definitionKey: 'I_90',
          version: '0.1.0',
          currentStageKey: 'READY_FOR_DATA_ENTRY',
          assignedTo: null,
          slaState: null,
          rowVersion: 1,
          matchedFields: [{ fieldKey: 'trackingId', value: 'W-9001', pii: false }]
        }
      ]
    });
    render(<SearchScreen compact openTrackingId="W-9001" onOpen={vi.fn()} />);
    await user.type(screen.getByLabelText('Tracking ID'), 'W-9');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('button', { name: 'Open WORKLOAD W-9001, row 1' })).toBeInTheDocument();
    expect(document.querySelector('.optic-search-hit[aria-current="true"]')).toBeTruthy();
  });
});
