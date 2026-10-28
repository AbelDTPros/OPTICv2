import type { MouseEvent, ReactNode } from 'react';
import { focusFormField } from './focus-field.js';

/** In-page field jump that does not use fragment navigation (avoids squashing drawers). */
export function ErrorFieldLink({
  inputId,
  children
}: {
  inputId: string;
  children: ReactNode;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    focusFormField(inputId);
  }

  return (
    <a href={`#${inputId}`} onClick={onClick}>
      {children}
    </a>
  );
}
