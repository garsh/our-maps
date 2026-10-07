import { Fragment } from 'react';
import { linkifySegments } from '../utils/linkify';

export function LinkifiedText({ text }: { text: string }) {
  const segments = linkifySegments(text);
  return segments.map((segment, index) =>
    segment.href ? (
      <a
        key={index}
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer"
        className="pin-description-link"
        onClick={(event) => event.stopPropagation()}
      >
        {segment.text}
      </a>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    )
  );
}
