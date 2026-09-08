import type { BrowserExpectation, BrowserObservation } from '@xopcai/browser-control-contract';

export function verifyBrowserExpectation(
  expectation: BrowserExpectation | undefined,
  observation: BrowserObservation,
): string | null {
  if (!expectation) return null;
  if (expectation.urlIncludes && !observation.url.includes(expectation.urlIncludes)) {
    return `URL does not include ${JSON.stringify(expectation.urlIncludes)}`;
  }
  if (expectation.titleIncludes && !observation.title.includes(expectation.titleIncludes)) {
    return `Title does not include ${JSON.stringify(expectation.titleIncludes)}`;
  }
  if (expectation.textIncludes) {
    const text = observation.nodes.map((node) => `${node.name}\n${node.value ?? ''}\n${node.description ?? ''}`).join('\n');
    if (!text.includes(expectation.textIncludes)) {
      return `Page does not include ${JSON.stringify(expectation.textIncludes)}`;
    }
  }
  if (expectation.ref && expectation.state) {
    const present = observation.nodes.some((node) => node.ref === expectation.ref);
    if (expectation.state === 'visible' && !present) return `Target ${expectation.ref} is not visible`;
    if (expectation.state === 'hidden' && present) return `Target ${expectation.ref} is still visible`;
  }
  return null;
}
