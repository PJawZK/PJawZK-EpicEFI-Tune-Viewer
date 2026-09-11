import type { ParsedTune, TuneConstant } from './model';

function attr(element: Element | undefined, name: string): string {
  return element?.getAttribute(name) ?? '';
}

function numberAttr(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export function parseMsq(raw: string): ParsedTune {
  const xml = new DOMParser().parseFromString(raw, 'text/xml');
  const parserError = xml.querySelector('parsererror');
  if (parserError) {
    throw new Error('The selected file is not valid XML/MSQ.');
  }

  const versionInfo = xml.querySelector('versionInfo') ?? undefined;
  if (!versionInfo) {
    throw new Error('MSQ versionInfo is missing.');
  }

  const bibliography = xml.querySelector('bibliography') ?? undefined;
  const pages = [...xml.querySelectorAll('page')];

  const constants: TuneConstant[] = [];
  pages.forEach((page, pageIndex) => {
    [...page.children]
      .filter((element) => element.tagName === 'constant')
      .forEach((element) => {
        const name = element.getAttribute('name') ?? '';
        if (!name) return;

        constants.push({
          name,
          value: (element.textContent ?? '').replaceAll('"', '').trim(),
          units: element.getAttribute('units'),
          page: numberAttr(page, 'number') ?? pageIndex,
          rows: numberAttr(element, 'rows'),
          cols: numberAttr(element, 'cols'),
        });
      });
  });

  if (constants.length === 0) {
    throw new Error('No tune constants were found in this MSQ.');
  }

  const nPagesRaw = attr(versionInfo, 'nPages');
  const nPages = nPagesRaw ? Number.parseInt(nPagesRaw, 10) : null;

  return {
    details: {
      author: attr(bibliography, 'author'),
      tuneComment: attr(bibliography, 'tuneComment').trim(),
      writeDate: attr(bibliography, 'writeDate'),
      fileFormat: attr(versionInfo, 'fileFormat'),
      firmwareInfo: attr(versionInfo, 'firmwareInfo'),
      nPages: nPages !== null && !Number.isNaN(nPages) ? nPages : null,
      signature: attr(versionInfo, 'signature'),
    },
    constants,
  };
}
