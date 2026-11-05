/**
 * Extractors that Playwright evaluates inside the page.
 *
 * Playwright serialises these to source and runs them in the browser, where no
 * module scope exists. Each one must therefore be self-contained: no imports,
 * no closures, and no calls between them.
 */

/**
 * OLX wraps the description in a container that opens with a localised section
 * heading — "Opis", "Descrição", "Descriere". Reading the container's
 * textContent prefixed that heading onto every description, so the heading
 * elements are dropped and only the body blocks are read. Matching on the tag
 * rather than the words keeps this working on all five domains.
 *
 * The heading is either a direct child (<h3>Opis</h3><div>…</div>) or, in the
 * current markup on olx.ua, olx.pl and olx.pt, wrapped in an element of its
 * own (<div><h3>Opis</h3></div><div>…</div>), so a block holding nothing but
 * headings is dropped too.
 */
export const extractDescriptionText = (container: Element): string => {
  const isHeadingBlock = (element: Element): boolean =>
    /^H[1-6]$/.test(element.tagName) ||
    (element.children.length > 0 && Array.from(element.children).every(isHeadingBlock));

  const body = Array.from(container.children).filter(child => !isHeadingBlock(child));

  // No child elements means the markup is a plain text node, not a heading plus
  // a body, and the container's own text is the description.
  const text =
    body.length > 0 ? body.map(child => child.textContent || '').join('\n') : container.textContent;

  return (text || '').trim();
};

/**
 * The detail-page price container holds both the amount and a sibling badge
 * ("Negociável", "do negocjacji", ...) that the container's own textContent
 * would glue onto the amount — reading as "340 €Negociável". The amount
 * carries the same `ad-price` testid it has on search cards, so that element
 * is preferred; when the markup changes shape, fall back to the container's
 * direct text nodes only.
 */
export const extractDetailPriceText = (container: Element): string => {
  const amount = container.querySelector('[data-testid="ad-price"]');
  if (amount) return (amount.textContent || '').trim();

  const ownText = Array.from(container.childNodes)
    .filter(node => node.nodeType === 3)
    .map(node => node.textContent || '')
    .join('')
    .trim();
  if (ownText) return ownText;

  return (container.textContent || '').trim();
};

/**
 * The map section opens with a localised heading — "Localização",
 * "Lokalizacja", "Locație" — that the container's textContent would prepend
 * to the value, reading as "LocalizaçãoMassamá …". The address itself lives
 * in an <address> block; when there is none, heading elements are dropped
 * the same way extractDescriptionText handles the description heading.
 *
 * The current markup on olx.ua, olx.pl and olx.pt has no <address>, and its
 * heading is a <p>, not a heading element. The place is in a <section> next to
 * it, one <p> per line — "Chrzanów, <span>district</span>" then "Małopolskie" —
 * read as "Chrzanów, Małopolskie". The district span is empty on listings
 * without one, which leaves a dangling comma to trim.
 */
export const extractLocationText = (container: Element): string => {
  const address = container.querySelector('address');
  if (address) return (address.textContent || '').trim();

  const section = Array.from(container.children).find(child => child.tagName === 'SECTION');
  if (section) {
    const lines: string[] = [];
    const collect = (element: Element): void => {
      if (element.tagName === 'P') {
        const line = (element.textContent || '')
          .replace(/\s+/g, ' ')
          .replace(/\s+,/g, ',')
          .replace(/,(?=\S)/g, ', ')
          .replace(/[\s,]+$/, '')
          .trim();
        if (line) lines.push(line);
        return;
      }
      Array.from(element.children).forEach(collect);
    };
    collect(section);
    if (lines.length > 0) return lines.join(', ');
  }

  const body = Array.from(container.children).filter(child => !/^H[1-6]$/.test(child.tagName));
  const text =
    body.length > 0 ? body.map(child => child.textContent || '').join('\n') : container.textContent;

  return (text || '').trim();
};

/**
 * Gallery sources, in page order. `data-src` covers slides the gallery has not
 * lazy-loaded yet, and non-absolute values are dropped: those are inline
 * placeholders and static badge assets, not photos of the item.
 */
export const extractGalleryImages = (images: Element[]): string[] => {
  const urls = images
    .map(image => image.getAttribute('src') || image.getAttribute('data-src') || '')
    .filter(url => url.startsWith('http://') || url.startsWith('https://'));

  // The thumbnail strip repeats the slides it scrolls through.
  return Array.from(new Set(urls));
};
