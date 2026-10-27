-- Admin audit trail filters (event type + time range).

CREATE INDEX ix_audit_occurred_at ON audit_event (occurred_at, id);
CREATE INDEX ix_audit_event_type_occurred ON audit_event (event_type, occurred_at, id);
CREATE INDEX ix_audit_definition_occurred ON audit_event (definition_key, occurred_at, id);
