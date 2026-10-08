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
/** Bounds for the measured status/tags column width (px). */
const COL_STATUS_MAX = 220;
/** Horizontal padding added around a column's widest chip (10 px each side). */
const COL_STRIP_PAD = 20;
const COL_ICON_GAP = 8;
const COL_GAP = 32;
const COL_WIDTH_CAP = 2600;
const COL_HEADER_H = 150;
const COL_FOOTER_H = 70;
/** Vertical gap between stacked collection blocks (matches zen-mode spacing). */
const COL_BLOCK_GAP = 32;
/** How far an alt tile hangs past the main corner, as a fraction of tile size. */
const SWAP_OUTSET_RATIO = 0.12;
/** Horizontal stagger between a pair of alt tiles. */
const SWAP_STAGGER = 8;
/** Single-build card geometry: a 3x3 grid of ~210 px tiles (min the bag/abilities). */
const BUILD_PAD = 110;
/** Tile target size; the render CDN caps item art at 217 px, so stay at/below it. */
const BUILD_TILE = 210;
const BUILD_GAP = 20;
const BUILD_HEADER_TOP = 24;
const BUILD_HEADER_H = 132;
/** Top of the grid: below the header panel with a 16 px gap. */
const BUILD_GRID_TOP = BUILD_HEADER_TOP + BUILD_HEADER_H + 16;
const BUILD_FOOTER_H = 70;

/** Maps each visible slot to its single-item field and swap bucket. */
interface SlotSpec {
  field: keyof PlayerBuild;
  swap: keyof BuildSwap;
}

/** One status chip: a tag, tier requirement or approval flag, plus its colours. */
interface StatusChip {
  text: string;
  fill: string;
  border: string | null;
  color: string;
}

/**
 * 3x3 cell order for the single-build card; numbers index `slots`, the `'offhand'`
 * sentinel is the weapon's off-hand alternative, null = empty cell.
 * Rows: [- , head, cape] / [weapon, chest, offhand] / [potion, shoes, food].
 */
type BuildCell = number | 'offhand' | null;
const BUILD_GRID: BuildCell[] = [null, 1, 4, 0, 2, 'offhand', 6, 3, 5];

/** Computed layout for a collection card. */
interface CollectionLayout {
  width: number;
  height: number;
  columns: number;
  perColumn: number;
  rowsUsed: number;
  iconSize: number;
  swapSize: number;
  /** How far alt tiles hang past the main tile's bottom-right corner. */
  outset: number;
  /** Per-column chip strip width; 0 means that column draws no strip. */
  stripWidths: number[];
  /** Per-column content width (strip + icons + alt overflow). */
  contentWs: number[];
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
  /** Cached 1x1 scratch context for text measurement (created on first use). */
  private scratch: CanvasRenderingContext2D | null = null;
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

  /** Renders a single-build card: a 3x3 tile grid with hanging alt tiles. */
  async renderBuild(build: PlayerBuild, opts?: ShareBuildOptions): Promise<ShareResult> {
    this.beginRender();
    await this.loadFonts();
    const background = await this.loadBackground();
    // Size the card from the grid, leaving room for the alt overflow and footer.
    const width = 2 * BUILD_PAD + 3 * BUILD_TILE + 2 * BUILD_GAP;
    const altOverflow = Math.round(BUILD_TILE * SWAP_OUTSET_RATIO) + SWAP_STAGGER;
    const height = BUILD_GRID_TOP + 3 * BUILD_TILE + 2 * BUILD_GAP + altOverflow + BUILD_FOOTER_H;
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
    const layout = this.computeCollectionLayout(collection);
    const { width, height } = layout;

    const items: GearItem[] = [];
    for (const b of collection.builds) items.push(...this.collectItems(b));
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

  /**
   * Renders every given collection as one stacked image: each block keeps its own
   * zen layout and is centred on the widest block, with a single footer at the end.
   */
  async renderCollections(collections: BuildCollection[]): Promise<ShareResult> {
    this.beginRender();
    await this.loadFonts();
    const background = await this.loadBackground();

    if (!collections.length) {
      throw new Error('renderCollections requires at least one collection');
    }
    const blocks = collections.map((collection) => ({
      collection,
      layout: this.computeCollectionLayout(collection),
    }));

    // Width is the widest block; height stacks the content with a gap between blocks.
    const width = Math.max(...blocks.map((b) => b.layout.width));
    const height =
      blocks.reduce((sum, b) => sum + (b.layout.height - COL_FOOTER_H), 0) +
      COL_BLOCK_GAP * (blocks.length - 1) +
      COL_FOOTER_H;

    const items: GearItem[] = [];
    for (const { collection } of blocks) {
      for (const build of collection.builds) items.push(...this.collectItems(build));
    }
    const keys = await this.preload(items, COLLECTION_ICON_PX);

    try {
      const canvas = this.createCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      this.drawBackground(ctx, width, height, background);
      let y = 0;
      for (const block of blocks) {
        const originX = Math.round((width - block.layout.width) / 2);
        this.drawCollectionBlock(
          ctx,
          block.collection,
          block.layout,
          this.preferences.showTierLabels,
          originX,
          y,
        );
        y += block.layout.height - COL_FOOTER_H + COL_BLOCK_GAP;
      }
      this.drawFooter(ctx, width, height);
      const blob = await this.toBlob(canvas);
      return { blob, width, height, missingIcons: this.missingIcons };
    } finally {
      this.unpin(keys);
    }
  }

  /**
   * Pure layout computation for one collection: columns, sizing, strips and rows.
   * No await and no canvas, so the single and stacked renderers share it exactly.
   */
  private computeCollectionLayout(collection: BuildCollection): CollectionLayout {
    const builds = collection.builds;
    const perColumnPref =
      this.preferences.buildsPerColumn ?? (collection.type === 'party' ? 10 : 6);
    let perColumn = perColumnPref;
    let columns = builds.length ? Math.ceil(builds.length / perColumn) : 1;

    const iconGap = COL_ICON_GAP;
    // Pre-pass: raise builds-per-column until a 32 px-minimum card fits the width cap.
    // Fewer, taller columns beat an unbounded row; the preference is honoured when it fits.
    const minOutset = Math.round(32 * SWAP_OUTSET_RATIO);
    const minWidth = (per: number, cols: number): number => {
      const columnBuilds = (c: number) => builds.slice(c * per, c * per + per);
      const strips = Array.from({ length: cols }, (_, c) =>
        this.measureColumnStrip(columnBuilds(c)),
      );
      const overs = strips.map((_, c) => this.columnAltOverhang(columnBuilds(c), minOutset));
      const minColW = Math.max(
        ...strips.map(
          (strip, c) =>
            strip +
            this.slots.length * 32 +
            (this.slots.length - 1) * iconGap +
            2 * overs[c],
        ),
      );
      return 2 * COL_PAD + cols * minColW + (cols - 1) * COL_GAP;
    };
    while (columns > 1 && minWidth(perColumn, columns) > COL_WIDTH_CAP) {
      perColumn++;
      columns = Math.ceil(builds.length / perColumn);
    }
    const rowsUsed = builds.length ? Math.min(perColumn, builds.length) : 0;

    // Widen the canvas to keep big icons; only shrink icons past the width cap.
    let iconSize = 96;
    const swapSize = 60;
    // Per-column chip strips: a column reserves one only if it actually has chips.
    const stripWidths = Array.from({ length: columns }, (_, c) => {
      const start = c * perColumn;
      return this.measureColumnStrip(builds.slice(start, start + perColumn));
    });
    const anyChips = stripWidths.some((w) => w > 0);
    // Alt tiles hang past the main corner; reserve the overhang symmetrically per column.
    let outset = Math.round(iconSize * SWAP_OUTSET_RATIO);
    // Per-column overhang: only a column whose last drawn slot has alts can overhang.
    let overs = stripWidths.map((_, c) =>
      this.columnAltOverhang(builds.slice(c * perColumn, c * perColumn + perColumn), outset),
    );
    // Width of one column's icon band (independent of the strip and alt overhang).
    const iconRun = () => this.slots.length * iconSize + (this.slots.length - 1) * iconGap;
    // Content width for a column: strip + icons + symmetric alt reserve (one per side).
    const contentW = (c: number) => stripWidths[c] + iconRun() + 2 * overs[c];
    const maxColW = () => Math.max(...stripWidths.map((_, c) => contentW(c)));
    let colW = maxColW();
    let width = Math.max(1200, 2 * COL_PAD + columns * colW + (columns - 1) * COL_GAP);
    if (!anyChips) {
      // Grow icons into the freed strip width, capped at 128 px.
      iconSize = Math.max(
        32,
        Math.min(
          128,
          Math.floor(
            (width -
              2 * COL_PAD -
              (columns - 1) * COL_GAP -
              columns * (this.slots.length - 1) * iconGap) /
              (columns * this.slots.length),
          ),
        ),
      );
      outset = Math.round(iconSize * SWAP_OUTSET_RATIO);
      // The overhang depends on the outset, so recompute it after any outset change.
      overs = stripWidths.map((_, c) =>
        this.columnAltOverhang(builds.slice(c * perColumn, c * perColumn + perColumn), outset),
      );
      colW = maxColW();
      width = Math.max(1200, 2 * COL_PAD + columns * colW + (columns - 1) * COL_GAP);
    }
    if (width > COL_WIDTH_CAP) {
      // Space left for the icons once strips, alt reserves and column gaps are removed.
      const stripTotal = stripWidths.reduce((sum, w, c) => sum + w + 2 * overs[c], 0);
      const avail =
        COL_WIDTH_CAP -
        2 * COL_PAD -
        (columns - 1) * COL_GAP -
        stripTotal -
        columns * (this.slots.length - 1) * iconGap;
      iconSize = Math.max(32, Math.floor(avail / (columns * this.slots.length)));
      outset = Math.round(iconSize * SWAP_OUTSET_RATIO);
      // The overhang depends on the outset, so recompute it after any outset change.
      overs = stripWidths.map((_, c) =>
        this.columnAltOverhang(builds.slice(c * perColumn, c * perColumn + perColumn), outset),
      );
      colW = maxColW();
      width = Math.max(1200, 2 * COL_PAD + columns * colW + (columns - 1) * COL_GAP);
    }
    const contentWs = stripWidths.map((_, c) => contentW(c));

    const rowH = iconSize + 44;
    const height = COL_HEADER_H + rowsUsed * rowH + COL_FOOTER_H;
    return {
      width,
      height,
      columns,
      perColumn,
      rowsUsed,
      iconSize,
      swapSize,
      outset,
      stripWidths,
      contentWs,
      iconGap,
      colW,
      colGap: COL_GAP,
      headerH: COL_HEADER_H,
      rowH,
    };
  }

  /**
   * Warms the icon cache for a set of builds so a later share render finds the
   * bitmaps cached. Best-effort, never throws, no-op outside the browser.
   */
  prefetch(builds: PlayerBuild[]): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const items: GearItem[] = [];
    for (const build of builds.slice(0, 24)) items.push(...this.collectItems(build));
    if (!items.length) return;
    void (async () => {
      // Save the miss counter so a failed prefetch does not inflate the next render.
      const savedMissing = this.missingIcons;
      // Single phase at the collection size: the single-build size (ICON_REQUEST_PX) is
      // deliberately not prefetched, so idle traffic stays at one request per item.
      const keys = await this.preload(items, COLLECTION_ICON_PX);
      // preload pins its keys; unpinning now keeps evictIfNeeded working.
      this.unpin(keys);
      this.missingIcons = savedMissing;
    })().catch(() => undefined);
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

  /**
   * Builds a single row's chips (tags, then tier, then approval) in draw order.
   * Shared by the strip measurement and the drawing so the two never disagree.
   */
  private buildChips(build: PlayerBuild): StatusChip[] {
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
    return chips;
  }

  /**
   * Measures a column's chip strip: 0 when no build in that column has a chip,
   * otherwise the widest chip plus padding, clamped to the strip bounds.
   */
  private measureColumnStrip(columnBuilds: PlayerBuild[]): number {
    const ctx = this.measureContext();
    if (ctx) ctx.font = '700 13px Inter, sans-serif';
    let any = false;
    let widest = 0;
    for (const build of columnBuilds) {
      for (const chip of this.buildChips(build)) {
        any = true;
        if (ctx) widest = Math.max(widest, ctx.measureText(chip.text).width + 16);
      }
    }
    if (!any) return 0;
    if (!ctx) {
      // SSR fallback: no canvas, keep the historical 130 px usable chip width.
      widest = 110;
    }
    return Math.min(COL_STATUS_MAX, widest + COL_STRIP_PAD);
  }

  /** How far this column's rightmost alt can hang past its icons (0 when none can). */
  private columnAltOverhang(columnBuilds: PlayerBuild[], outset: number): number {
    let over = 0;
    for (const build of columnBuilds) {
      // The rightmost (last drawn) main slot is the only one that can overhang the panel.
      let lastMain = -1;
      for (let i = this.slots.length - 1; i >= 0; i--) {
        if (build[this.slots[i].field]) {
          lastMain = i;
          break;
        }
      }
      if (lastMain < 0) continue;
      if ((build.swaps?.[this.slots[lastMain].swap] ?? []).length > 0) {
        over = outset + SWAP_STAGGER;
      }
    }
    return over;
  }

  /**
   * Cached scratch 2D context used to measure text before the card canvas exists.
   * Returns null during SSR; its single caller sets the font before measuring.
   */
  private measureContext(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (!this.scratch) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      this.scratch = canvas.getContext('2d');
    }
    return this.scratch;
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
    // Mirror the app's body overlay: linear-gradient(rgba(0,0,0,.75), rgba(0,0,0,.75)).
    const scrim = ctx.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
    scrim.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = scrim;
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

    // --- Measure the tags block first so the title can claim the remaining space.
    ctx.font = '600 16px Inter, sans-serif';
    const tagGap = 8;
    const tags = build.tags ?? [];
    const tagRight = width - padX;
    const maxTagWidth = width * 0.45;
    const areaLeft = tagRight - maxTagWidth;
    const tagFits: { text: string; tw: number }[] = [];
    let tagsUsed = 0;
    for (let i = tags.length - 1; i >= 0; i--) {
      let text = tags[i];
      let tw = ctx.measureText(text).width + 24;
      if (tw > maxTagWidth) {
        text = this.truncate(ctx, tags[i], maxTagWidth - 24);
        tw = ctx.measureText(text).width + 24;
      }
      const add = tw + (tagFits.length ? tagGap : 0);
      if (tagsUsed + add > maxTagWidth) break;
      tagFits.push({ text, tw });
      tagsUsed += add;
    }
    const dropped = tags.length - tagFits.length;
    let plusWidth = 0;
    if (dropped > 0) {
      plusWidth = ctx.measureText('+' + dropped).width + 20 + tagGap;
    }
    const tagsLeft = tags.length ? tagRight - tagsUsed - plusWidth : tagRight;

    // --- Measure the real badge widths (drawn right after the title).
    ctx.font = '700 20px Inter, sans-serif';
    const badgeGap = 12;
    const badgeTexts: string[] = [];
    if (build.minTier) badgeTexts.push(build.minTier);
    if (build.requiresApproval) badgeTexts.push('Approval Only');
    let badgeWidth = 0;
    badgeTexts.forEach((text, i) => {
      badgeWidth += ctx.measureText(text).width + 28 + (i > 0 ? badgeGap : 0);
    });

    // --- Title width from the measured tags + badges, with a small floor.
    const titleStart = padX + 8;
    const gapTitleBadges = 18;
    const gapBeforeTags = 16;
    let titleMax = width - padX * 2 - 20;
    if (tags.length || badgeTexts.length) {
      titleMax = Math.min(
        titleMax,
        tagsLeft -
          titleStart -
          badgeWidth -
          (badgeTexts.length ? gapTitleBadges : 0) -
          gapBeforeTags,
      );
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

    // Subtitle: only when it adds information (non-empty and differing from the title).
    const subtitleText = (subtitle ?? '').trim();
    const titleText = (build.title || '').trim();
    if (subtitleText && subtitleText.toLowerCase() !== titleText.toLowerCase()) {
      ctx.fillStyle = MUTED;
      ctx.font = '400 22px Inter, sans-serif';
      ctx.fillText(this.truncate(ctx, subtitleText, width - padX * 2 - 200), padX + 8, 126);
    }

    // Tags: draw the fitted chips right-to-left.
    if (tags.length) {
      ctx.font = '600 16px Inter, sans-serif';
      let tagX = tagRight;
      for (const fit of tagFits) {
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
        const w = ctx.measureText(plusText).width + 20;
        if (tagX - w >= areaLeft) {
          this.roundRect(ctx, tagX - w, 70, w, 30, 15);
          ctx.fillStyle = '#3f3f46';
          ctx.fill();
          ctx.fillStyle = TEXT;
          ctx.fillText(plusText, tagX - w + 10, 90);
        }
      }
    }

    // 3x3 grid (mirrors the Albion build display, minus the bag and abilities).
    const gridX = BUILD_PAD;
    const gridTop = BUILD_GRID_TOP;
    const tile = BUILD_TILE;
    const gap = BUILD_GAP;
    const swapSize = Math.round(tile * 0.5);
    const outset = Math.round(tile * SWAP_OUTSET_RATIO);

    // First off-hand alternative (shown in its own cell, not as a weapon overlay).
    const offhand = (build.swaps?.weapon ?? []).find((w) => w.category === 'offhand') ?? null;

    // Pass 1: main tiles; unmapped cells and an absent off-hand are skipped entirely.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = BUILD_GRID[r * 3 + c];
        if (cell === null) continue;
        const isOffhand = cell === 'offhand';
        const item = isOffhand ? offhand : (build[this.slots[cell].field] as GearItem | null);
        if (isOffhand && !item) continue;
        this.drawTile(
          ctx,
          gridX + c * (tile + gap),
          gridTop + r * (tile + gap),
          tile,
          item,
          ICON_REQUEST_PX,
          0,
          showTierLabels,
          'badge',
        );
      }
    }

    // Pass 2: alt tiles hang past each tile's bottom-right corner, layered on top.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = BUILD_GRID[r * 3 + c];
        if (cell === null || cell === 'offhand') continue;
        const slot = this.slots[cell];
        const main = build[slot.field] as GearItem | null;
        if (!main) continue;
        // The off-hand already owns its own cell, so keep it off the weapon overlay.
        const swaps: GearItem[] =
          slot.field === 'mainHand'
            ? (build.swaps?.[slot.swap] ?? []).filter((s) => s.category !== 'offhand')
            : (build.swaps?.[slot.swap] ?? []);
        const tx = gridX + c * (tile + gap);
        const ty = gridTop + r * (tile + gap);
        swaps.slice(0, 2).forEach((swap, j) => {
          const sx = tx + tile - swapSize + outset + j * SWAP_STAGGER;
          const sy = ty + tile - swapSize + outset + j * SWAP_STAGGER;
          this.drawTile(ctx, sx, sy, swapSize, swap, ICON_REQUEST_PX, 0, showTierLabels);
        });
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
    this.drawCollectionBlock(ctx, collection, layout, showTierLabels, 0, 0);
    this.drawFooter(ctx, layout.width, layout.height);
  }

  /**
   * Draws one collection's header and rows at the given origin (no footer), so the
   * single card (origin 0,0) and the stacked "share all" image can share the code.
   */
  private drawCollectionBlock(
    ctx: CanvasRenderingContext2D,
    collection: BuildCollection,
    layout: CollectionLayout,
    showTierLabels: boolean,
    originX: number,
    originY: number,
  ): void {
    const { width, columns, perColumn, iconSize, swapSize, outset, stripWidths, contentWs, iconGap, colW, colGap, headerH, rowH } =
      layout;

    // Header: centred gold, uppercase, letter-spaced collection name only.
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 48px Inter, sans-serif';
    ctx.fillStyle = GOLD;
    this.fillTextSpaced(
      ctx,
      (collection.name || 'Untitled').toUpperCase(),
      originX + width / 2,
      originY + 92,
      3,
    );
    ctx.textAlign = 'left';

    // Centre the whole column block horizontally inside this block's own width.
    const blockW = columns * colW + (columns - 1) * colGap;
    const startX = Math.round((width - blockW) / 2);

    collection.builds.forEach((build, idx) => {
      const col = Math.floor(idx / perColumn);
      const row = idx % perColumn;
      const colX = originX + startX + col * (colW + colGap);
      const rowY = originY + headerH + row * rowH;

      // Row panel (zen tint).
      this.roundRect(ctx, colX, rowY + 4, colW, rowH - 10, 10);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.64)';
      ctx.fill();

      // Centre this column's content (strip + icons) in its equal-width container.
      const contentX = colX + (colW - contentWs[col]) / 2;
      const stripX = contentX;
      const iconAreaX = contentX + stripWidths[col];

      // Status column (tags, tier, approval) — only when this column has chips.
      if (stripWidths[col] > 0) {
        this.drawStatusColumn(ctx, build, stripX, rowY + 12, rowH - 20, stripWidths[col]);
      }

      const iconTop = rowY + 8;

      // Pass 1: all main icons, so alt overlays can be layered on top afterwards.
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        const main = build[slot.field] as GearItem | null;
        if (main) {
          this.drawTile(
            ctx,
            iconAreaX + i * (iconSize + iconGap),
            iconTop,
            iconSize,
            main,
            COLLECTION_ICON_PX,
            14,
            showTierLabels,
          );
        }
      }

      // Pass 2: alt tiles hang past the main corner (app-like z-order).
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        const main = build[slot.field] as GearItem | null;
        if (!main) continue;
        const ix = iconAreaX + i * (iconSize + iconGap);
        const swaps = build.swaps?.[slot.swap] ?? [];
        swaps.slice(0, 2).forEach((swap, j) => {
          // Outset (~12%) hangs the tile past the corner; stagger the pair.
          const sx = ix + iconSize - swapSize + outset + j * SWAP_STAGGER;
          const sy = iconTop + iconSize - swapSize + outset + j * SWAP_STAGGER;
          this.drawTile(ctx, sx, sy, swapSize, swap, COLLECTION_ICON_PX, 0, showTierLabels);
        });
      }
    });
  }

  /** Draws one tile: bitmap, placeholder, and a tier label (below chip or corner badge). */
  private drawTile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    item: GearItem | null,
    px: number,
    tierFont: number,
    showTierLabels: boolean,
    tierStyle: 'below' | 'badge' = 'below',
  ): void {
    const bmp = item ? this.cache.get(`${item.id}@${px}`) ?? null : null;

    if (item && bmp) {
      // Real icon: no opaque tile, so transparent regions reveal the artwork (zen parity).
      ctx.drawImage(bmp, x, y, size, size);
    } else {
      // Empty slot or missing bitmap: opaque tile + border.
      this.roundRect(ctx, x, y, size, size, Math.max(6, size * 0.12));
      ctx.fillStyle = '#101013';
      ctx.fill();
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();

      if (item) {
        // Placeholder: lighter fill plus the tier label as the tile's only content.
        ctx.fillStyle = '#1c1c20';
        ctx.fill();
        ctx.fillStyle = MUTED;
        ctx.font = `700 ${Math.max(10, Math.round(size * 0.26))}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(tierLabel(item.name), x + size / 2, y + size / 2 + size * 0.1);
        ctx.textAlign = 'left';
      }
    }

    // Tier label: corner badge (single card) or beneath chip (collection card).
    // Only when the bitmap was drawn — placeholders keep their label inside the tile.
    if (item && bmp && showTierLabels) {
      const label = tierLabel(item.name);
      if (tierStyle === 'badge') {
        this.drawTierBadge(ctx, label, x, y, size);
      } else if (tierFont > 0) {
        ctx.font = `700 ${tierFont}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const chipW = ctx.measureText(label).width + 8;
        const chipH = tierFont + 4;
        const cx = x + size / 2;
        const cy = y + size + 3;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        this.roundRect(ctx, cx - chipW / 2, cy, chipW, chipH, 4);
        ctx.fill();
        ctx.fillStyle = GOLD;
        ctx.fillText(label, cx, cy + chipH - 4);
        ctx.textAlign = 'left';
      }
    }
  }

  /** Draws a small tier badge at the tile's top-left corner (single-build card). */
  private drawTierBadge(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    size: number,
  ): void {
    const font = Math.max(11, Math.round(size * 0.085));
    ctx.font = `700 ${font}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(label).width + 12;
    const h = font + 8;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.roundRect(ctx, x + 4, y + 4, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillText(label, x + 10, y + 4 + h - 5);
  }

  /** Stacks a build's chips, centred in the strip and on the icon band. */
  private drawStatusColumn(
    ctx: CanvasRenderingContext2D,
    build: PlayerBuild,
    x: number,
    y: number,
    maxH: number,
    width: number,
  ): void {
    const chips = this.buildChips(build);

    const chipH = 22;
    const gap = 6;
    ctx.font = '700 13px Inter, sans-serif';
    // Centre the chip stack vertically within the row band (y .. y + maxH).
    const total = chips.length * chipH + Math.max(0, chips.length - 1) * gap;
    let cy = y + Math.max(0, (maxH - total) / 2);
    for (const chip of chips) {
      if (cy + chipH > y + maxH) break;
      let text = chip.text;
      let tw = ctx.measureText(text).width + 16;
      if (tw > width) {
        text = this.truncate(ctx, chip.text, width - 16);
        tw = ctx.measureText(text).width + 16;
      }
      // Centre each chip horizontally in the strip.
      const cx = x + (width - tw) / 2;
      this.roundRect(ctx, cx, cy, tw, chipH, 4);
      ctx.fillStyle = chip.fill;
      ctx.fill();
      if (chip.border) {
        ctx.strokeStyle = chip.border;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = chip.color;
      ctx.fillText(text, cx + 8, cy + 15);
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

  /**
   * Re-encodes a rendered PNG as a JPEG (downloads only) on a base-coloured canvas
   * so no alpha artefacts appear. Browser-only; resolves null if encoding fails.
   */
  async toJpeg(blob: Blob, quality = 0.92): Promise<Blob | null> {
    if (
      typeof document === 'undefined' ||
      typeof createImageBitmap === 'undefined'
    ) {
      return null;
    }
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = this.createCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((out) => resolve(out), 'image/jpeg', quality);
      });
    } catch {
      return null;
    }
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
