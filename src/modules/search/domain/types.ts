export interface SearchRequest {
  q?: string;
  receiptNumber?: string;
  entityType?: string;
  definitionKey?: string;
  currentStageKey?: string;
  assignedTo?: string;
  /** Extra Catalog search field keys → typed values (e.g. Status). */
  criteria?: Record<string, string>;
  page: number;
  pageSize: number;
}

export interface SearchHitField {
  fieldKey: string;
  value: string;
  pii: boolean;
}

export interface SearchHit {
  trackingId: string;
  entityType: string;
  definitionKey: string;
  version: string;
  currentStageKey: string;
  assignedTo: string | null;
  slaState: string | null;
  rowVersion: number;
  matchedFields: SearchHitField[];
}

export interface SearchResultPage {
  q: string;
  receiptNumber?: string;
  page: number;
  pageSize: number;
  total: number;
  hits: SearchHit[];
}

export interface ProjectionSearchQuery {
  q?: string;
  receiptNumber?: string;
  entityType?: string;
  definitionKey?: string;
  currentStageKey?: string;
  assignedTo?: string;
  page: number;
  pageSize: number;
}
