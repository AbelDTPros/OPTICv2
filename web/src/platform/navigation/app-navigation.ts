export type AppViewId = 'workspace' | 'supervisor' | 'designer' | 'admin';

export type WorkspaceFocusHint = {
  kindKey?: string;
  stageKey?: string;
  trackingId?: string;
  entityType?: string;
  findCase?: boolean;
};

export type DesignerFocusHint = {
  tab?: 'workflow' | 'form' | 'schema' | 'catalog' | 'lifecycle' | 'simulate' | 'try' | 'diff';
};

export type AdminFocusHint = {
  section?: 'features' | 'audit' | 'integrations';
};

const WORKSPACE_FOCUS_KEY = 'optic.workspace.focus';
const DESIGNER_FOCUS_KEY = 'optic.designer.focus';
const ADMIN_FOCUS_KEY = 'optic.admin.focus';
export const APP_NAVIGATE_EVENT = 'optic:navigate';

export function requestAppView(
  view: AppViewId,
  workspaceFocus?: WorkspaceFocusHint,
  designerFocus?: DesignerFocusHint,
  adminFocus?: AdminFocusHint
): void {
  if (workspaceFocus) {
    try {
      window.sessionStorage.setItem(WORKSPACE_FOCUS_KEY, JSON.stringify(workspaceFocus));
    } catch {
      // ignore storage failures
    }
  }
  if (designerFocus) {
    try {
      window.sessionStorage.setItem(DESIGNER_FOCUS_KEY, JSON.stringify(designerFocus));
    } catch {
      // ignore storage failures
    }
  }
  if (adminFocus) {
    try {
      window.sessionStorage.setItem(ADMIN_FOCUS_KEY, JSON.stringify(adminFocus));
    } catch {
      // ignore storage failures
    }
  }
  window.dispatchEvent(
    new CustomEvent(APP_NAVIGATE_EVENT, {
      detail: { view, workspaceFocus, designerFocus, adminFocus }
    })
  );
}

export function consumeWorkspaceFocusHint(): WorkspaceFocusHint | undefined {
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_FOCUS_KEY);
    window.sessionStorage.removeItem(WORKSPACE_FOCUS_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as WorkspaceFocusHint;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function consumeDesignerFocusHint(): DesignerFocusHint | undefined {
  try {
    const raw = window.sessionStorage.getItem(DESIGNER_FOCUS_KEY);
    window.sessionStorage.removeItem(DESIGNER_FOCUS_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as DesignerFocusHint;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function consumeAdminFocusHint(): AdminFocusHint | undefined {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_FOCUS_KEY);
    window.sessionStorage.removeItem(ADMIN_FOCUS_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as AdminFocusHint;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
