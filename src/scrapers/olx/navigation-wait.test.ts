import { describe, it, expect, vi } from 'vitest';
import type { Browser } from 'playwright';

import { OlxScraperFactory } from './scraper.factory.js';
import type { ListingId } from '../../core/types.js';

/**
 * OLX pages keep ad requests open indefinitely, so `waitUntil: 'networkidle'`
 * never resolves and every navigation times out. These tests pin that no
 * navigation waits for network idle, and that each one waits for the content
 * it reads instead.
 */

function createFakePage() {
  const page = {
    goto: vi.fn().mockResolvedValue(null),
    waitForSelector: vi.fn().mockResolvedValue(null),
    setDefaultTimeout: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    $$eval: vi.fn().mockResolvedValue([]),
    $eval: vi.fn().mockRejectedValue(new Error('no element')),
    $: vi.fn().mockResolvedValue(null),
    // page.locator(selector).first().waitFor(options), recorded as [selector, options]
    waitFor: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(),
  };
  page.locator.mockImplementation((selector: string) => ({
    first: () => ({ waitFor: (options: unknown) => page.waitFor(selector, options) }),
  }));
  const browser = { newPage: vi.fn().mockResolvedValue(page) } as unknown as Browser;
  return { page, browser };
}

function gotoWaitUntils(page: ReturnType<typeof createFakePage>['page']): unknown[] {
  return page.goto.mock.calls.map(([, options]) => (options as { waitUntil?: unknown }).waitUntil);
}

describe.each(['olx.ua', 'olx.pt', 'olx.pl'] as const)('%s navigation waits', domain => {
  it('search does not wait for network idle and waits for listing cards', async () => {
    const { page, browser } = createFakePage();
    const scraper = new OlxScraperFactory(browser).getScraper(domain);

    const result = await scraper.scrape({ domain, query: 'iphone' });

    expect(result.success).toBe(true);
    expect(gotoWaitUntils(page)).toEqual(['domcontentloaded']);
    expect(page.waitForSelector).toHaveBeenCalledWith(
      expect.stringContaining('l-card'),
      expect.anything()
    );
  });

  it('listing details (uncached id) never wait for network idle', async () => {
    const { page, browser } = createFakePage();
    // findListingUrl looks the id up via search; return a matching card link.
    page.$$eval.mockResolvedValueOnce('/d/oferta/some-item-IDabc123.html');
    const scraper = new OlxScraperFactory(browser).getScraper(domain);

    const result = await scraper.getListingDetails('abc123' as ListingId, undefined, {
      includeImages: false,
      includeSellerInfo: false,
    });

    expect(result.success).toBe(true);
    const waits = gotoWaitUntils(page);
    expect(waits).toHaveLength(2); // lookup search + listing page
    expect(waits).not.toContain('networkidle');
    // Waited for the lookup's cards and for the listing title.
    expect(page.waitForSelector).toHaveBeenCalledWith(
      expect.stringContaining('l-card'),
      expect.anything()
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      expect.stringContaining('offer_title'),
      expect.anything()
    );
  });

  it('listing details wait for hydration and the location, then drop inline styles', async () => {
    const { page, browser } = createFakePage();
    page.$$eval.mockResolvedValueOnce('/d/oferta/some-item-IDabc123.html');
    // The location section exists on this listing.
    page.$.mockImplementation(async (selector: string) =>
      selector.includes('map-aside-section') ? {} : null
    );
    const scraper = new OlxScraperFactory(browser).getScraper(domain);

    await scraper.getListingDetails('abc123' as ListingId, undefined, {
      includeImages: false,
      includeSellerInfo: false,
    });

    expect(page.waitFor.mock.calls).toEqual([
      // hydrated: the title's inline styles are gone
      ['[data-testid="offer_title"] style', { state: 'detached', timeout: 5000 }],
      // the location rendered next to its heading
      [
        '[data-testid="map-aside-section"] > :not(style) ~ :not(style)',
        { state: 'attached', timeout: 5000 },
      ],
    ]);
    // Leftover inline styles are removed after the waits, before extraction.
    const styleCleanup = page.$$eval.mock.calls.findIndex(
      ([selector]) => selector === 'body style'
    );
    expect(styleCleanup).toBeGreaterThan(-1);
    expect(page.$$eval.mock.invocationCallOrder[styleCleanup]).toBeGreaterThan(
      Math.max(...page.waitFor.mock.invocationCallOrder)
    );
  });

  it('listing details skip the location wait when the listing has no location section', async () => {
    const { page, browser } = createFakePage();
    page.$$eval.mockResolvedValueOnce('/d/oferta/some-item-IDabc123.html');
    const scraper = new OlxScraperFactory(browser).getScraper(domain);

    await scraper.getListingDetails('abc123' as ListingId, undefined, {
      includeImages: false,
      includeSellerInfo: false,
    });

    const waitedFor = page.waitFor.mock.calls.map(([selector]) => selector);
    expect(waitedFor).toEqual(['[data-testid="offer_title"] style']);
  });

  it('listing details still succeed when the page never hydrates', async () => {
    const { page, browser } = createFakePage();
    page.$.mockImplementation(async (selector: string) =>
      selector.includes('map-aside-section') ? {} : null
    );
    page.waitFor.mockRejectedValue(new Error('Timeout 5000ms exceeded'));
    // findListingUrl's lookup succeeds; the style cleanup then fails.
    page.$$eval
      .mockResolvedValueOnce('/d/oferta/some-item-IDabc123.html')
      .mockRejectedValueOnce(new Error('page crashed'));
    const scraper = new OlxScraperFactory(browser).getScraper(domain);

    const result = await scraper.getListingDetails('abc123' as ListingId, undefined, {
      includeImages: false,
      includeSellerInfo: false,
    });

    expect(result.success).toBe(true);
    // Both the failing waits and the failing cleanup were actually reached.
    expect(page.waitFor).toHaveBeenCalledTimes(2);
    expect(page.$$eval).toHaveBeenCalledWith('body style', expect.any(Function));
  });
});
