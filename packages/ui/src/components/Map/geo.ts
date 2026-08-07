// Web-Mercator projection and slippy-tile arithmetic.
//
// Pure functions, no DOM, no dependency: this is the whole of the "map
// engine". DEFERRED-DECISIONS §4 item 23 records why a raster tile mosaic was
// chosen over MapLibre GL — the short version is that packages/ui must stay
// framework-agnostic and its tests run in plain jsdom with no WebGL context,
// and none of the five map screens asks for pan, zoom, rotation or vector
// styling. They ask for pins, an ETA, and a list.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Standard slippy-map tile edge. Not a design token — it is the tile
 * server's own coordinate system, and changing it would move every pin. */
const TILE_EDGE = 256;

/** Web Mercator stops here; beyond it the projection diverges. */
const MAX_LAT = 85.05112878;

/** The mosaic is always four tiles across and three down, which is where the
 * 4/3 aspect ratio in Map.css comes from. Both numbers live here so the
 * picture and the projection can never disagree. */
export const GRID_COLS = 4;
export const GRID_ROWS = 3;

export interface MapView {
  zoom: number;
  /** Pixel coordinate, at `zoom`, of the mosaic's top-left corner. */
  originX: number;
  originY: number;
  /** Mosaic size in projection pixels. */
  widthPx: number;
  heightPx: number;
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
  /** Position within the mosaic, as a percentage of its own size. */
  leftPct: number;
  topPct: number;
}

export interface PointPosition {
  leftPct: number;
  topPct: number;
  /** False when the point falls outside the mosaic. Such a point still
   * appears in the textual list — it just has nowhere to sit in the picture. */
  inView: boolean;
}

/** Longitude/latitude to absolute pixels at a zoom level. */
export function project(point: LatLng, zoom: number): { x: number; y: number } {
  const scale = TILE_EDGE * 2 ** zoom;
  const lat = Math.min(Math.max(point.lat, -MAX_LAT), MAX_LAT);
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(Math.round(zoom), 1), 18);
}

/** The centre of a set of points, as the middle of their bounding box. */
export function centerOf(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/** The largest zoom at which every point still fits inside the mosaic, with
 * a margin so no pin sits on the frame. A single point gets `fallbackZoom`,
 * since a bounding box of zero has no scale to derive. */
export function fitZoom(points: LatLng[], fallbackZoom = 13): number {
  if (points.length < 2) return clampZoom(fallbackZoom);
  const target = { width: GRID_COLS * TILE_EDGE * 0.8, height: GRID_ROWS * TILE_EDGE * 0.8 };
  for (let zoom = 18; zoom >= 1; zoom -= 1) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const { x, y } = project(p, zoom);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (maxX - minX <= target.width && maxY - minY <= target.height) return zoom;
  }
  return 1;
}

/** The mosaic frame for a centre and a zoom. */
export function viewFor(center: LatLng, zoom: number): MapView {
  const z = clampZoom(zoom);
  const widthPx = GRID_COLS * TILE_EDGE;
  const heightPx = GRID_ROWS * TILE_EDGE;
  const { x, y } = project(center, z);
  return { zoom: z, originX: x - widthPx / 2, originY: y - heightPx / 2, widthPx, heightPx };
}

/** Every tile the mosaic overlaps, positioned as a percentage of the frame so
 * the whole picture scales with its container instead of being pinned to a
 * pixel size the layout does not control. */
export function tilesFor(view: MapView): TileRef[] {
  const worldTiles = 2 ** view.zoom;
  const firstX = Math.floor(view.originX / TILE_EDGE);
  const firstY = Math.floor(view.originY / TILE_EDGE);
  const offsetX = view.originX - firstX * TILE_EDGE;
  const offsetY = view.originY - firstY * TILE_EDGE;
  const tiles: TileRef[] = [];
  for (let row = 0; row <= GRID_ROWS; row += 1) {
    for (let col = 0; col <= GRID_COLS; col += 1) {
      const y = firstY + row;
      // Above the north pole or below the south pole there is no tile.
      if (y < 0 || y >= worldTiles) continue;
      // Longitude wraps, so a mosaic straddling the antimeridian still works.
      const x = (((firstX + col) % worldTiles) + worldTiles) % worldTiles;
      tiles.push({
        z: view.zoom,
        x,
        y,
        leftPct: ((col * TILE_EDGE - offsetX) / view.widthPx) * 100,
        topPct: ((row * TILE_EDGE - offsetY) / view.heightPx) * 100
      });
    }
  }
  return tiles;
}

/** Where a coordinate sits inside the mosaic. */
export function positionOf(point: LatLng, view: MapView): PointPosition {
  const { x, y } = project(point, view.zoom);
  const leftPct = ((x - view.originX) / view.widthPx) * 100;
  const topPct = ((y - view.originY) / view.heightPx) * 100;
  return { leftPct, topPct, inView: leftPct >= 0 && leftPct <= 100 && topPct >= 0 && topPct <= 100 };
}

/** Fill a `{z}/{x}/{y}` tile template.
 *
 * The template itself is never written down in source — parity-grep fails any
 * URL in application or library code, and a tile host is a per-tier value by
 * nature. It arrives as a prop or as `NEXT_PUBLIC_MAP_TILE_URL`, and when it
 * arrives as neither the map renders its textual fallback and says why. */
export function tileHref(template: string, tile: TileRef): string {
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}

/** The configured tile template, or null when no host is configured. */
export function tileTemplate(explicit?: string | null): string | null {
  if (explicit) return explicit;
  const fromEnv =
    typeof process !== "undefined" && process.env ? process.env.NEXT_PUBLIC_MAP_TILE_URL : undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}
