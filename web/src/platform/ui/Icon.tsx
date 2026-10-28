import type { ReactNode } from 'react';

export type IconName =
  | 'queue'
  | 'live'
  | 'search'
  | 'form'
  | 'designer'
  | 'folder'
  | 'draft'
  | 'save'
  | 'assign'
  | 'alert'
  | 'inbox'
  | 'user'
  | 'check'
  | 'clock'
  | 'generate'
  | 'release'
  | 'reassign'
  | 'chevronLeft'
  | 'chevronRight'
  | 'diff'
  | 'calendar'
  | 'print'
  | 'scan'
  | 'clear'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'paste'
  | 'copy'
  | 'help'
  | 'settings'
  | 'layout';

const marks: Record<IconName, ReactNode> = {
  queue: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  live: (
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M7.2 7.2a6.8 6.8 0 0 0 0 9.6M16.8 7.2a6.8 6.8 0 0 1 0 9.6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  form: (
    <>
      <path d="M8 3.5h6.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5H8z" />
      <path d="M14 3.5V8h4.5M9.5 12.5h5M9.5 16h3.5" />
    </>
  ),
  designer: (
    <>
      <path d="M4 21V14M4 10V3M12 21v-4M12 13V3M20 21v-8M20 9V3" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="15" r="2" />
      <circle cx="20" cy="11" r="2" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l1.6 1.8H19A1.5 1.5 0 0 1 20.5 9.3v8.2A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  draft: (
    <>
      <path d="M8 3.5h6.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5H8z" />
      <path d="M14 3.5V8h4.5M12 12v6M9 15h6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4.5h11.2L19.5 8v11.5A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M8 21v-6.5h8V21M8 4.5V9h7" />
    </>
  ),
  assign: (
    <>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4.5 19a5.5 5.5 0 0 1 11 0M17 11v6M14 14h6" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.2" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5 6.2 5.8A1.5 1.5 0 0 1 7.6 4.8h8.8a1.5 1.5 0 0 1 1.4 1L20 13.5" />
      <path d="M4 13.5h4.2l1.3 2h5l1.3-2H20v5.2A1.3 1.3 0 0 1 18.7 20H5.3A1.3 1.3 0 0 1 4 18.7z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </>
  ),
  check: (
    <path d="m5 12.5 4.2 4.2L19 7.5" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  generate: (
    <>
      <path d="M12 3.5 13.2 7.4h4.1l-3.3 2.4 1.3 4-3.3-2.4-3.3 2.4 1.3-4-3.3-2.4h4.1z" />
      <path d="M6 19h5M17 15.5v6M14 18.5h6" />
    </>
  ),
  // Return an assigned case to the shared queue list.
  release: (
    <>
      <path d="M4 7h7M4 12h7M4 17h5" />
      <circle cx="4.5" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <path d="M20 12H12.5M15.5 9l-3.5 3 3.5 3" />
    </>
  ),
  // Hand a case from one officer to another.
  reassign: (
    <>
      <circle cx="7" cy="7.5" r="2.6" />
      <path d="M3 18a4 4 0 0 1 8 0" />
      <circle cx="17" cy="7.5" r="2.6" />
      <path d="M13 18a4 4 0 0 1 8 0" />
      <path d="M9.5 12.5h5M12.5 10.5l2.5 2-2.5 2" />
    </>
  ),
  chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  diff: (
    <>
      <rect x="3.5" y="5" width="10" height="14" rx="1.4" />
      <rect x="10.5" y="5" width="10" height="14" rx="1.4" />
      <path d="M13.5 9h4M13.5 12.5h4M13.5 16h2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="1.6" />
      <path d="M4 10h16M8 3.5v4M16 3.5v4M8 14h2.2M13.8 14H16" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V4.5h10V9" />
      <path d="M6 14.5H4.5A1.5 1.5 0 0 1 3 13V10a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 10v3a1.5 1.5 0 0 1-1.5 1.5H18" />
      <rect x="7" y="13" width="10" height="7" rx="1" />
    </>
  ),
  scan: (
    <>
      <path d="M5 8V5.5h3M16 5.5h3V8M19 16v2.5h-3M8 18.5H5V16" />
      <path d="M7 12h10" />
    </>
  ),
  clear: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7.5h14" />
      <path d="M9.5 7.5V5.5h5v2" />
      <path d="M8 7.5 8.8 19h6.4L16.4 7.5" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 8.5 4.5 13 9 17.5" />
      <path d="M4.5 13H14a5.5 5.5 0 1 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="M15 8.5 19.5 13 15 17.5" />
      <path d="M19.5 13H10a5.5 5.5 0 1 0 0 11h3" />
    </>
  ),
  paste: (
    <>
      <path d="M9 5.5h6" />
      <path d="M10 3.5h4v3H10z" />
      <rect x="5.5" y="6.5" width="13" height="14" rx="1.5" />
      <path d="M9 12h6M9 15.5h4" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.4" />
      <path d="M15.5 8.5V5.9A1.4 1.4 0 0 0 14.1 4.5H5.9A1.4 1.4 0 0 0 4.5 5.9v8.2A1.4 1.4 0 0 0 5.9 15.5H8.5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.6 2.6 0 1 1 3.7 2.4c-.7.4-1.3.9-1.3 1.9" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </>
  )
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="optic-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {marks[name]}
    </svg>
  );
}

export function ButtonLabel({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <>
      <Icon name={icon} />
      {children}
    </>
  );
}

export function ErrorHeading({ children = 'There is a problem' }: { children?: ReactNode }) {
  return (
    <h2>
      <Icon name="alert" />
      {children}
    </h2>
  );
}

export function StatusPill({ children }: { children: string }) {
  return (
    <span className="optic-status-pill">
      <Icon name={statusIcon(children)} />
      {children}
    </span>
  );
}

function statusIcon(status: string): IconName {
  const key = status.toUpperCase();
  if (key === 'PUBLISHED' || key === 'APPROVED' || key === 'ACTIVE') {
    return 'check';
  }
  if (key === 'IN_REVIEW') {
    return 'clock';
  }
  if (key === 'REJECTED') {
    return 'alert';
  }
  if (key === 'RETIRED') {
    return 'inbox';
  }
  return 'draft';
}
