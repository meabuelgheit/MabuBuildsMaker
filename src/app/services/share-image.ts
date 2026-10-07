import { Injectable, inject } from '@angular/core';
import {
  BuildCollection,
  BuildSwap,
  GearItem,
  PlayerBuild,
  tierLabel,
} from '../shared/models/item';
import { PreferencesService } from './preferences';

/** Result of rendering a share image. */
export interface ShareResult {
  blob: Blob;
  width: number;
  height: number;
  missingIcons: number;
}

/** Optional metadata for a single-build share card. */
export interface ShareBuildOptions {
  subtitle?: string;
}

/** Per-render network counters (for diagnostics/tests). */
export interface ShareStats {
  bytesFetched: number;
  iconRequests: number;
}

const PANEL = '#0b0b0d';
const PANEL_ALT = '#121214';
const GOLD = '#d4af37';
const TEXT = '#e2e8f0';
const MUTED = '#a1a1aa';
const BORDER = '#27272a';
const ICON_REQUEST_PX = 217;
const COLLECTION_ICON_PX = 128;
/** Maximum cached icon bitmaps; oldest unpinned entries are evicted (and closed). */
const CACHE_LIMIT = 200;

/** Maps each visible slot to its single-item field and swap bucket. */
interface SlotSpec {
  field: keyof PlayerBuild;
  swap: keyof BuildSwap;
}

/**
 * Renders builds and collections to PNG share cards using a Canvas 2D pipeline.
 * All DOM/canvas work happens inside the render methods (user-action reachable only).
 */
@Injectable({ providedIn: 'root' })
export class ShareImageService {
  private cache = new Map<string, ImageBitmap | null>();
  /** Keys an in-flight render still needs; never evicted/closed until it ends. */
  private pinned = new Set<string>();
  private fontsReady = false;
  private missingIcons = 0;

  private preferences = inject(PreferencesService);

  /** Counters for the most recent render call. */
  readonly lastStats: ShareStats = { bytesFetched: 0, iconRequests: 0 };

  private readonly slots: SlotSpec[] = [
    { field: 'mainHand', swap: 'weapon' },
    { field: 'head', swap: 'head' },
    { field: 'chest', swap: 'chest' },
    { field: 'shoes', swap: 'shoes' },
    { field: 'cape', swap: 'cape' },
    { field: 'food', swap: 'food' },
    { field: 'potion', swap: 'potion' },
  ];

  /** Renders a single build card (1200×630). */
  async renderBuild(build: PlayerBuild, opts?: ShareBuildOptions): Promise<ShareResult> {
    this.beginRender();
    await this.loadFonts();
    const width = 1200;
    const height = 630;
    const items = this.collectItems(build);
    const keys = await this.preload(items, ICON_REQUEST_PX);
    try {
      const canvas = this.createCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, width, height);
      this.drawBuildCard(ctx, build, opts?.subtitle, width, height, this.preferences.showTierLabels);
      const blob = await this.toBlob(canvas);
      return { blob, width, height, missingIcons: this.missingIcons };
    } finally {
      this.unpin(keys);
    }
  }

  /** Renders a collection card (1200 wide, dynamic height). */
  async renderCollection(collection: BuildCollection): Promise<ShareResult> {
    this.beginRender();
    await this.loadFonts();
    const width = 1200;
    const builds = collection.builds;
    const twoCols = builds.length > 10;
    const rowH = 168;
    const rows = twoCols ? Math.ceil(builds.length / 2) : builds.length;
    const headerH = 150;
    const footerH = 70;
    const height = Math.min(headerH + rows * rowH + footerH, 2600);

    const items: GearItem[] = [];
    for (const b of builds) items.push(...this.collectItems(b));
    const keys = await this.preload(items, COLLECTION_ICON_PX);

    try {
      const canvas = this.createCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, width, height);
      this.drawCollectionCard(ctx, collection, width, height, rowH, headerH, twoCols, this.preferences.showTierLabels);
      const blob = await this.toBlob(canvas);
      return { blob, width, height, missingIcons: this.missingIcons };
    } finally {
      this.unpin(keys);
    }
  }

  // --- rendering internals -------------------------------------------------

  private beginRender(): void {
    this.missingIcons = 0;
    this.lastStats.bytesFetched = 0;
    this.lastStats.iconRequests = 0;
  }

  /** Collects every gear item (including swaps) referenced by a build. */
  private collectItems(build: PlayerBuild): GearItem[] {
    const items: GearItem[] = [];
    for (const slot of this.slots) {
      const main = build[slot.field] as GearItem | null;
      if (main) items.push(main);
      for (const swap of build.swaps?.[slot.swap] ?? []) items.push(swap);
    }
    return items;
  }

  private drawBuildCard(
    ctx: CanvasRenderingContext2D,
    build: PlayerBuild,
    subtitle: string | undefined,
    width: number,
    height: number,
    showTierLabels: boolean,
  ): void {
    const padX = 48;
    // Header panel
    this.roundRect(ctx, padX - 16, 24, width - 2 * (padX - 16), 132, 16);
    ctx.fillStyle = PANEL_ALT;
    ctx.fill();
    ctx.fillStyle = GOLD;
    this.roundRect(ctx, padX - 16, 24, 6, 132, 3);
    ctx.fill();

    // Title
    ctx.fillStyle = TEXT;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 46px Inter, sans-serif';
    const title = this.truncate(ctx, build.title || 'Untitled', width - padX * 2 - 240);
    ctx.fillText(title, padX + 8, 96);

    // Tier badge next to title
    let cursor = padX + 8 + ctx.measureText(title).width + 18;
    if (build.minTier) {
      cursor = this.drawBadge(ctx, build.minTier, cursor, 62);
    }

    // Subtitle
    if (subtitle) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 22px Inter, sans-serif';
      ctx.fillText(this.truncate(ctx, subtitle, width - padX * 2 - 200), padX + 8, 126);
    }

    // Tags: bounded to the right ~45% of the card so they never run into the title.
    if (build.tags?.length) {
      ctx.font = '600 16px Inter, sans-serif';
      const tagGap = 8;
      const tagRight = width - padX;
      const maxTagWidth = width * 0.45;
      const areaLeft = tagRight - maxTagWidth;
      const tags = build.tags;
      // Pass 1: pick the trailing tags that fit (drawn right-to-left).
      const fits: { text: string; tw: number }[] = [];
      let used = 0;
      for (let i = tags.length - 1; i >= 0; i--) {
        let text = tags[i];
        let tw = ctx.measureText(text).width + 24;
        if (tw > maxTagWidth) {
          text = this.truncate(ctx, tags[i], maxTagWidth - 24);
          tw = ctx.measureText(text).width + 24;
        }
        const add = tw + (fits.length ? tagGap : 0);
        if (used + add > maxTagWidth) break;
        fits.push({ text, tw });
        used += add;
      }
      const dropped = tags.length - fits.length;
      // Pass 2: draw the fitted chips right-to-left.
      let tagX = tagRight;
      for (const fit of fits) {
        const left = tagX - fit.tw;
        this.roundRect(ctx, left, 70, fit.tw, 30, 15);
        ctx.fillStyle = '#27272a';
        ctx.fill();
        ctx.fillStyle = TEXT;
        ctx.fillText(fit.text, left + 12, 90);
        tagX = left - tagGap;
      }
      // Optional overflow indicator for the dropped tags.
      if (dropped > 0) {
        const plusText = '+' + dropped;
        const plusW = ctx.measureText(plusText).width + 20;
        if (tagX - plusW >= areaLeft) {
          this.roundRect(ctx, tagX - plusW, 70, plusW, 30, 15);
          ctx.fillStyle = '#3f3f46';
          ctx.fill();
          ctx.fillStyle = TEXT;
          ctx.fillText(plusText, tagX - plusW + 10, 90);
        }
      }
    }

    // Slots row
    const slotGap = 8;
    const usable = width - 2 * padX;
    const slotW = (usable - slotGap * 6) / 7;
    const iconSize = 104;
    const slotTop = 210;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const slotX = padX + i * (slotW + slotGap);
      const tileX = slotX + (slotW - iconSize) / 2;
      const main = build[slot.field] as GearItem | null;
      this.drawTile(ctx, tileX, slotTop, iconSize, main, ICON_REQUEST_PX, 20, showTierLabels);

      const swaps = build.swaps?.[slot.swap] ?? [];
      const smallSize = 42;
      let sx = tileX;
      const sy = slotTop + iconSize + 36;
      for (const swap of swaps.slice(0, 3)) {
        this.drawTile(ctx, sx, sy, smallSize, swap, ICON_REQUEST_PX, 12, showTierLabels);
        sx += smallSize + 6;
      }
    }

    this.drawFooter(ctx, width, height);
  }

  private drawCollectionCard(
    ctx: CanvasRenderingContext2D,
    collection: BuildCollection,
    width: number,
    height: number,
    rowH: number,
    headerH: number,
    twoCols: boolean,
    showTierLabels: boolean,
  ): void {
    const padX = 48;
    // Header
    ctx.fillStyle = GOLD;
    this.roundRect(ctx, padX - 16, 28, 6, 96, 3);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 44px Inter, sans-serif';
    ctx.fillText(this.truncate(ctx, collection.name || 'Untitled', width - padX * 2 - 120), padX + 8, 84);
    ctx.fillStyle = MUTED;
    ctx.font = '400 22px Inter, sans-serif';
    const typeLabel = collection.type === 'party' ? 'Party' : 'Group';
    ctx.fillText(`${typeLabel} · ${collection.builds.length} build(s)`, padX + 8, 122);

    const colWidth = twoCols ? (width - padX * 2) / 2 : width - padX * 2;
    const innerW = colWidth - 12;
    const titleW = 200;
    const iconAreaW = innerW - titleW - 24;
    const step = iconAreaW / this.slots.length;
    const iconSize = Math.min(56, step - 8);

    collection.builds.forEach((build, idx) => {
      const col = twoCols ? idx % 2 : 0;
      const row = twoCols ? Math.floor(idx / 2) : idx;
      const x0 = padX + col * colWidth;
      const y0 = headerH + row * rowH;

      this.roundRect(ctx, x0, y0 + 6, innerW, rowH - 16, 12);
      ctx.fillStyle = PANEL_ALT;
      ctx.fill();

      // Build title column (vertically centred)
      ctx.fillStyle = TEXT;
      ctx.font = '600 20px Inter, sans-serif';
      const title = this.truncate(ctx, build.title || 'Untitled', titleW);
      ctx.fillText(title, x0 + 16, y0 + rowH / 2 + 6);

      // Icons row
      const iconAreaX = x0 + titleW + 12;
      const iy = y0 + 40;
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        const main = build[slot.field] as GearItem | null;
        const ix = iconAreaX + i * step + Math.max(0, (step - iconSize) / 2);
        if (main) {
          this.drawTile(ctx, ix, iy, iconSize, main, COLLECTION_ICON_PX, 12, showTierLabels);
        }
      }
    });

    this.drawFooter(ctx, width, height);
  }

  /** Draws one tile: bitmap, placeholder, and tier label beneath. */
  private drawTile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    item: GearItem | null,
    px: number,
    tierFont: number,
    showTierLabels: boolean,
  ): void {
    // Tile background
    this.roundRect(ctx, x, y, size, size, Math.max(6, size * 0.12));
    ctx.fillStyle = '#101013';
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!item) return;

    const bmp = this.cache.get(`${item.id}@${px}`) ?? null;
    const label = tierLabel(item.name);
    if (bmp) {
      ctx.drawImage(bmp, x, y, size, size);
    } else {
      // Placeholder tile
      ctx.fillStyle = '#1c1c20';
      ctx.fill();
      ctx.fillStyle = MUTED;
      ctx.font = `700 ${Math.max(10, Math.round(size * 0.26))}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + size / 2, y + size / 2 + size * 0.1);
      ctx.textAlign = 'left';
    }

    // Tier label beneath (hidden by preference; placeholders keep theirs above)
    if (tierFont > 0 && showTierLabels) {
      ctx.fillStyle = GOLD;
      ctx.font = `700 ${tierFont}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + size / 2, y + size + tierFont + 3);
      ctx.textAlign = 'left';
    }
  }

  private drawBadge(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
  ): number {
    ctx.font = '700 20px Inter, sans-serif';
    const tw = ctx.measureText(text).width + 28;
    this.roundRect(ctx, x, y - 24, tw, 34, 17);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.fillStyle = '#09090b';
    ctx.fillText(text, x + 14, y);
    return x + tw + 12;
  }

  private drawFooter(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(48, height - 58);
    ctx.lineTo(width - 48, height - 58);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = '600 20px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Mabu Builds Maker', 48, height - 24);
    ctx.textAlign = 'right';
    ctx.fillText('https://meabuelgheit.github.io/MabuBuildsMaker/', width - 48, height - 24);
    ctx.textAlign = 'left';
  }

  // --- helpers -------------------------------------------------------------

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  private truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  private createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob returned null'));
      }, 'image/png');
    });
  }

  private async loadFonts(): Promise<void> {
    if (this.fontsReady) return;
    if (typeof document === 'undefined' || !document.fonts) {
      this.fontsReady = true;
      return;
    }
    try {
      await document.fonts.ready;
      await Promise.all([
        document.fonts.load('400 16px Inter'),
        document.fonts.load('600 16px Inter'),
        document.fonts.load('700 16px Inter'),
      ]);
    } catch {
      /* fall back to whatever fonts are available */
    }
    this.fontsReady = true;
  }

  /** Preloads + caches the bitmaps for a set of items at a request size. */
  private async preload(items: GearItem[], px: number): Promise<string[]> {
    const unique = new Map<string, string>();
    for (const item of items) unique.set(`${item.id}@${px}`, item.id);
    const keys = Array.from(unique.keys());
    for (const key of keys) this.pinned.add(key);
    await Promise.all(keys.map((key) => this.loadBitmap(unique.get(key)!, px, key)));
    return keys;
  }

  /** Releases the pin on keys once a render has finished drawing. */
  private unpin(keys: string[]): void {
    for (const key of keys) this.pinned.delete(key);
  }

  private async loadBitmap(id: string, px: number, key: string): Promise<ImageBitmap | null> {
    if (this.cache.has(key)) return this.cache.get(key)!;
    let bmp = await this.fetchBitmap(id, px, 'webp');
    if (!bmp) bmp = await this.fetchBitmap(id, px, 'png');
    this.cache.set(key, bmp);
    this.evictIfNeeded(key);
    if (!bmp) this.missingIcons++;
    return bmp;
  }

  /**
   * Caps the bitmap cache with oldest-first eviction, closing freed bitmaps.
   * Never closes the just-inserted key or one pinned by an in-flight render.
   */
  private evictIfNeeded(justInsertedKey: string): void {
    while (this.cache.size > CACHE_LIMIT) {
      let evictKey: string | null = null;
      for (const candidate of this.cache.keys()) {
        if (candidate === justInsertedKey) continue;
        if (this.pinned.has(candidate)) continue;
        evictKey = candidate;
        break;
      }
      if (!evictKey) break; // everything else is still pinned
      const bmp = this.cache.get(evictKey);
      if (bmp) bmp.close();
      this.cache.delete(evictKey);
    }
  }

  private async fetchBitmap(
    id: string,
    px: number,
    format: 'webp' | 'png',
  ): Promise<ImageBitmap | null> {
    try {
      this.lastStats.iconRequests++;
      const response = await fetch(this.proxyUrl(id, px, format), { mode: 'cors' });
      const blob = await response.blob();
      this.lastStats.bytesFetched += blob.size;
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }

  private proxyUrl(id: string, px: number, format: 'webp' | 'png'): string {
    const target = `render.albiononline.com/v1/item/${id}.png?quality=4`;
    return `https://images.weserv.nl/?url=${encodeURIComponent(target)}&w=${px}&output=${format}&q=90`;
  }
}
