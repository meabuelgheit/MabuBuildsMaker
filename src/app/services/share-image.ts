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
const CRIMSON_FILL = '#9f1239';
const CRIMSON_BORDER = '#be123c';
const ICON_REQUEST_PX = 217;
/** Collection icons are drawn at 96 px; 168 px is a ~1.75x request. */
const COLLECTION_ICON_PX = 168;
/** Maximum cached icon bitmaps; oldest unpinned entries are evicted (and closed). */
const CACHE_LIMIT = 200;
/** Shared geometry for the collection (zen-style) card. */
const COL_PAD = 48;
const COL_STATUS_W = 120;
const COL_ICON_GAP = 8;
const COL_GAP = 32;
const COL_WIDTH_CAP = 2600;
const COL_HEADER_H = 150;
const COL_FOOTER_H = 70;

/** Maps each visible slot to its single-item field and swap bucket. */
interface SlotSpec {
  field: keyof PlayerBuild;
  swap: keyof BuildSwap;
}

/** Computed layout for a collection card. */
interface CollectionLayout {
  width: number;
  height: number;
  columns: number;
  perColumn: number;
  rowsUsed: number;
  iconSize: number;
  swapSize: number;
  statusW: number;
  iconGap: number;
  colW: number;
  colGap: number;
  headerH: number;
  rowH: number;
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
    const background = await this.loadBackground();
    const width = 1200;
    const height = 630;
    const items = this.collectItems(build);
    const keys = await this.preload(items, ICON_REQUEST_PX);
    try {
      const canvas = this.createCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      this.drawBackground(ctx, width, height, background);
      this.drawBuildCard(ctx, build, opts?.subtitle, width, height, this.preferences.showTierLabels);
      const blob = await this.toBlob(canvas);
      return { blob, width, height, missingIcons: this.missingIcons };
    } finally {
      this.unpin(keys);
    }
  }

  /** Renders a collection card mirroring the app's zen (view) mode. */
  async renderCollection(collection: BuildCollection): Promise<ShareResult> {
    this.beginRender();
    await this.loadFonts();
    const background = await this.loadBackground();

    const builds = collection.builds;
    const perColumn =
      this.preferences.buildsPerColumn ?? (collection.type === 'party' ? 10 : 6);
    const columns = builds.length ? Math.ceil(builds.length / perColumn) : 1;
    const rowsUsed = builds.length ? Math.min(perColumn, builds.length) : 0;

    // Widen the canvas to keep big icons; only shrink icons past the width cap.
    const iconGap = COL_ICON_GAP;
    let iconSize = 96;
    const swapSize = 48;
    const measureCol = (icon: number) =>
      COL_STATUS_W + this.slots.length * icon + (this.slots.length - 1) * iconGap;
    let colW = measureCol(iconSize);
    let width = Math.max(1200, 2 * COL_PAD + columns * colW + (columns - 1) * COL_GAP);
    if (width > COL_WIDTH_CAP) {
      const avail =
        COL_WIDTH_CAP -
        2 * COL_PAD -
        (columns - 1) * COL_GAP -
        columns * COL_STATUS_W -
        columns * (this.slots.length - 1) * iconGap;
      iconSize = Math.max(32, Math.floor(avail / (columns * this.slots.length)));
      colW = measureCol(iconSize);
      width = Math.max(1200, 2 * COL_PAD + columns * colW + (columns - 1) * COL_GAP);
    }

    const rowH = iconSize + 44;
    const height = COL_HEADER_H + rowsUsed * rowH + COL_FOOTER_H;
    const layout: CollectionLayout = {
      width,
      height,
      columns,
      perColumn,
      rowsUsed,
      iconSize,
      swapSize,
      statusW: COL_STATUS_W,
      iconGap,
      colW,
      colGap: COL_GAP,
      headerH: COL_HEADER_H,
      rowH,
    };

    const items: GearItem[] = [];
    for (const b of builds) items.push(...this.collectItems(b));
    const keys = await this.preload(items, COLLECTION_ICON_PX);

    try {
      const canvas = this.createCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      this.drawBackground(ctx, width, height, background);
      this.drawCollectionCard(ctx, collection, layout, this.preferences.showTierLabels);
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

  /** Loads the active background image (preference data URL, else the default). */
  private loadBackground(): Promise<CanvasImageSource | null> {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      return Promise.resolve(null);
    }
    const src = this.preferences.backgroundImage ?? 'Background.jpg';
    return new Promise<CanvasImageSource | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /** Cover-fits the background and applies the app's flat 0.75 dark overlay. */
  private drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    image: CanvasImageSource | null,
  ): void {
    if (!image) {
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const iw = (image as HTMLImageElement).naturalWidth || (image as HTMLImageElement).width;
    const ih = (image as HTMLImageElement).naturalHeight || (image as HTMLImageElement).height;
    if (!iw || !ih) {
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const scale = Math.max(width / iw, height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, width, height);
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

    const hasTags = !!build.tags?.length;
    const badgeReserve = (build.minTier ? 150 : 0) + (build.requiresApproval ? 180 : 0);
    // Keep the title clear of the tags block (right ~45%).
    let titleMax = width - padX * 2 - 20;
    if (hasTags) {
      titleMax = Math.min(titleMax, width * 0.55 - (padX + 8) - badgeReserve - 16);
    }
    titleMax = Math.max(140, titleMax);

    // Title
    ctx.fillStyle = TEXT;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 46px Inter, sans-serif';
    const title = this.truncate(ctx, build.title || 'Untitled', titleMax);
    ctx.fillText(title, padX + 8, 96);

    // Tier + approval badges next to the title
    let cursor = padX + 8 + ctx.measureText(title).width + 18;
    if (build.minTier) {
      cursor = this.drawPill(ctx, build.minTier, cursor, 62, GOLD, null, '#09090b');
    }
    if (build.requiresApproval) {
      cursor = this.drawPill(ctx, 'Approval Only', cursor, 62, CRIMSON_FILL, CRIMSON_BORDER, '#ffffff');
    }

    // Subtitle
    if (subtitle) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 22px Inter, sans-serif';
      ctx.fillText(this.truncate(ctx, subtitle, width - padX * 2 - 200), padX + 8, 126);
    }

    // Tags: bounded to the right ~45% of the card so they never run into the title.
    if (hasTags) {
      ctx.font = '600 16px Inter, sans-serif';
      const tagGap = 8;
      const tagRight = width - padX;
      const maxTagWidth = width * 0.45;
      const areaLeft = tagRight - maxTagWidth;
      const tags = build.tags!;
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

    // Slots row (enlarged icons)
    const slotGap = 8;
    const usable = width - 2 * padX;
    const slotW = (usable - slotGap * 6) / 7;
    const iconSize = 132;
    const swapSize = 56;
    const slotTop = 196;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const slotX = padX + i * (slotW + slotGap);
      const tileX = slotX + (slotW - iconSize) / 2;
      const main = build[slot.field] as GearItem | null;
      this.drawTile(ctx, tileX, slotTop, iconSize, main, ICON_REQUEST_PX, 20, showTierLabels);

      const swaps = build.swaps?.[slot.swap] ?? [];
      let sx = tileX;
      const sy = slotTop + iconSize + 34;
      for (const swap of swaps.slice(0, 3)) {
        this.drawTile(ctx, sx, sy, swapSize, swap, ICON_REQUEST_PX, 12, showTierLabels);
        sx += swapSize + 6;
      }
    }

    this.drawFooter(ctx, width, height);
  }

  private drawCollectionCard(
    ctx: CanvasRenderingContext2D,
    collection: BuildCollection,
    layout: CollectionLayout,
    showTierLabels: boolean,
  ): void {
    const { width, height, columns, perColumn, iconSize, swapSize, statusW, iconGap, colW, colGap, headerH, rowH } =
      layout;

    // Header: centred gold, uppercase, letter-spaced collection name only.
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 48px Inter, sans-serif';
    ctx.fillStyle = GOLD;
    this.fillTextSpaced(ctx, (collection.name || 'Untitled').toUpperCase(), width / 2, 92, 3);
    ctx.textAlign = 'left';

    collection.builds.forEach((build, idx) => {
      const col = Math.floor(idx / perColumn);
      const row = idx % perColumn;
      const colX = COL_PAD + col * (colW + colGap);
      const rowY = headerH + row * rowH;

      // Row panel (zen tint).
      this.roundRect(ctx, colX, rowY + 4, colW, rowH - 10, 10);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.64)';
      ctx.fill();

      // Status column (tags, tier, approval).
      this.drawStatusColumn(ctx, build, colX + 10, rowY + 12, rowH - 20, statusW - 20);

      // Icon row.
      const iconTop = rowY + 8;
      const iconAreaX = colX + statusW;
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        const main = build[slot.field] as GearItem | null;
        const ix = iconAreaX + i * (iconSize + iconGap);
        if (main) {
          this.drawTile(ctx, ix, iconTop, iconSize, main, COLLECTION_ICON_PX, 14, showTierLabels);

          // Swaps as small overlays on the bottom-right of the main icon.
          const swaps = build.swaps?.[slot.swap] ?? [];
          swaps.slice(0, 2).forEach((swap, j) => {
            const sx = ix + iconSize - swapSize + j * 12;
            const sy = iconTop + iconSize - swapSize + j * 12;
            this.drawTile(ctx, sx, sy, swapSize, swap, COLLECTION_ICON_PX, 0, showTierLabels);
          });
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

  /** Stacks a build's tags, tier requirement and approval chip on the left. */
  private drawStatusColumn(
    ctx: CanvasRenderingContext2D,
    build: PlayerBuild,
    x: number,
    y: number,
    maxH: number,
    width: number,
  ): void {
    interface StatusChip {
      text: string;
      fill: string;
      border: string | null;
      color: string;
    }
    const chips: StatusChip[] = [];
    for (const tag of build.tags ?? []) {
      chips.push({ text: tag, fill: '#27272a', border: '#3f3f46', color: TEXT });
    }
    if (build.minTier) {
      chips.push({ text: build.minTier, fill: GOLD, border: null, color: '#09090b' });
    }
    if (build.requiresApproval) {
      chips.push({ text: 'Approval Only', fill: CRIMSON_FILL, border: CRIMSON_BORDER, color: '#ffffff' });
    }

    const chipH = 22;
    const gap = 6;
    ctx.font = '700 13px Inter, sans-serif';
    let cy = y;
    for (const chip of chips) {
      if (cy + chipH > y + maxH) break;
      let text = chip.text;
      let tw = ctx.measureText(text).width + 16;
      if (tw > width) {
        text = this.truncate(ctx, chip.text, width - 16);
        tw = ctx.measureText(text).width + 16;
      }
      this.roundRect(ctx, x, cy, tw, chipH, 4);
      ctx.fillStyle = chip.fill;
      ctx.fill();
      if (chip.border) {
        ctx.strokeStyle = chip.border;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = chip.color;
      ctx.fillText(text, x + 8, cy + 15);
      cy += chipH + gap;
    }
  }

  /** Draws a rounded inline pill and returns the cursor after it. */
  private drawPill(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fill: string,
    border: string | null,
    textColor: string,
  ): number {
    ctx.font = '700 20px Inter, sans-serif';
    const tw = ctx.measureText(text).width + 28;
    this.roundRect(ctx, x, y - 24, tw, 34, 17);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = textColor;
    ctx.fillText(text, x + 14, y);
    return x + tw + 12;
  }

  /** Draws text centred at `centerX` with a fixed letter-spacing in px. */
  private fillTextSpaced(
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    y: number,
    spacing: number,
  ): void {
    const chars = Array.from(text);
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total =
      widths.reduce((sum, w) => sum + w, 0) + spacing * Math.max(0, chars.length - 1);
    let x = centerX - total / 2;
    ctx.textAlign = 'left';
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], x, y);
      x += widths[i] + spacing;
    }
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
