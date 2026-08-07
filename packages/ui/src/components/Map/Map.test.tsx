import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Map } from "./Map";
import { MapFallbackList, type MapPoint } from "./MapFallbackList";
import { MapMarker } from "./MapMarker";
import { centerOf, fitZoom, positionOf, project, tileHref, tilesFor, tileTemplate, viewFor } from "./geo";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

// A tile template with no scheme and no host — parity-grep fails any URL in
// library source, and the real one is a per-tier env var anyway.
const TEMPLATE = "/tiles/{z}/{x}/{y}.png";

const RIYADH = { lat: 24.7136, lng: 46.6753 };

const POINTS: MapPoint[] = [
  { id: "driver", lat: 24.72, lng: 46.68, label: "السائق", kind: "driver", live: true, detail: "٧ دقائق" },
  { id: "stop-1", lat: 24.7, lng: 46.66, label: "حي الملز", kind: "b2c_home", order: 1 },
  { id: "stop-2", lat: 24.69, lng: 46.71, label: "مؤسسة النور", kind: "b2b_drop", order: 2 }
];

function parity(build: () => JSX.Element) {
  const rtl = withDocumentDirection("rtl", "ar", () => {
    const { container } = render(build());
    const sig = structuralSignature(container.firstElementChild as Element);
    cleanup();
    return sig;
  });
  const ltr = withDocumentDirection("ltr", "en", () => {
    const { container } = render(build());
    const sig = structuralSignature(container.firstElementChild as Element);
    cleanup();
    return sig;
  });
  expect(ltr).toEqual(rtl);
}

describe("Web Mercator projection", () => {
  it("puts the prime meridian and the equator at the centre of the world", () => {
    const { x, y } = project({ lat: 0, lng: 0 }, 0);
    expect(x).toBeCloseTo(128, 5);
    expect(y).toBeCloseTo(128, 5);
  });

  it("moves east as longitude grows and south as latitude falls", () => {
    const west = project({ lat: 24, lng: 40 }, 10);
    const east = project({ lat: 24, lng: 50 }, 10);
    const north = project({ lat: 26, lng: 46 }, 10);
    const south = project({ lat: 22, lng: 46 }, 10);
    expect(east.x).toBeGreaterThan(west.x);
    expect(south.y).toBeGreaterThan(north.y);
  });

  it("centres a set of points on the middle of their bounding box", () => {
    const center = centerOf([
      { lat: 24, lng: 46 },
      { lat: 26, lng: 48 }
    ]);
    expect(center).toEqual({ lat: 25, lng: 47 });
    expect(centerOf([])).toBeNull();
  });

  it("zooms out until every point fits, and further apart means further out", () => {
    const tight = fitZoom([
      { lat: 24.7, lng: 46.67 },
      { lat: 24.72, lng: 46.69 }
    ]);
    const wide = fitZoom([
      { lat: 21.5, lng: 39.2 },
      { lat: 26.4, lng: 50.1 }
    ]);
    expect(wide).toBeLessThan(tight);
    // One point has no bounding box to derive a scale from.
    expect(fitZoom([RIYADH])).toBe(13);
  });

  it("places the centre point at the centre of the mosaic", () => {
    const view = viewFor(RIYADH, 13);
    const at = positionOf(RIYADH, view);
    expect(at.leftPct).toBeCloseTo(50, 6);
    expect(at.topPct).toBeCloseTo(50, 6);
    expect(at.inView).toBe(true);
  });

  it("reports a point outside the frame rather than clamping it onto the edge", () => {
    const view = viewFor(RIYADH, 13);
    expect(positionOf({ lat: 21.5, lng: 39.2 }, view).inView).toBe(false);
  });

  it("covers the frame with whole tiles and fills the template", () => {
    const view = viewFor(RIYADH, 13);
    const tiles = tilesFor(view);
    // 4x3 tiles plus the partial row and column the offset pulls in.
    expect(tiles.length).toBe(20);
    expect(tiles.every((tile) => tile.z === 13)).toBe(true);
    const first = tiles[0]!;
    expect(tileHref(TEMPLATE, first)).toBe(`/tiles/13/${first.x}/${first.y}.png`);
  });

  it("has no tile host until one is configured", () => {
    expect(tileTemplate()).toBeNull();
    expect(tileTemplate("")).toBeNull();
    expect(tileTemplate(TEMPLATE)).toBe(TEMPLATE);
  });
});

describe("Map", () => {
  it("always renders the places in words, tiles or no tiles", () => {
    render(
      <Map
        label="خريطة التتبع"
        points={POINTS}
        tileUrl={null}
        attribution="© مساهمو OpenStreetMap"
        fallbackLabel="المحطات"
        emptyLabel="لا توجد محطات"
        unavailableLabel="الخريطة غير متاحة"
      />
    );
    const list = screen.getByRole("list", { name: "المحطات" });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("مؤسسة النور")).toBeInTheDocument();
  });

  it("says why there is no picture instead of drawing an empty grey box", () => {
    render(
      <Map
        label="خريطة"
        points={POINTS}
        tileUrl={null}
        attribution="©"
        fallbackLabel="المحطات"
        emptyLabel="لا توجد محطات"
        unavailableLabel="لم يُضبط مزوّد البلاطات"
      />
    );
    expect(screen.getByText("لم يُضبط مزوّد البلاطات")).toBeInTheDocument();
  });

  it("draws tiles and one pin per visible point when a host is configured", () => {
    const { container } = render(
      <Map
        label="خريطة"
        points={POINTS}
        tileUrl={TEMPLATE}
        attribution="©"
        fallbackLabel="المحطات"
        emptyLabel="لا توجد محطات"
        unavailableLabel="غير متاحة"
      />
    );
    expect(container.querySelectorAll(".ps-map__tile").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".ps-map__marker")).toHaveLength(3);
    // The picture carries no information a screen reader needs — the list does.
    expect(container.querySelector(".ps-map__canvas")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks the moving point, and only the moving point, as live", () => {
    const { container } = render(
      <Map
        label="خريطة"
        points={POINTS}
        tileUrl={TEMPLATE}
        attribution="©"
        fallbackLabel="المحطات"
        emptyLabel="لا توجد"
        unavailableLabel="غير متاحة"
      />
    );
    expect(container.querySelectorAll(".ps-map__marker--live")).toHaveLength(1);
  });

  it("says there is nothing to plot rather than rendering an empty list", () => {
    render(
      <Map
        label="خريطة"
        points={[]}
        tileUrl={TEMPLATE}
        attribution="©"
        fallbackLabel="المحطات"
        emptyLabel="لا توجد محطات بعد"
        unavailableLabel="غير متاحة"
      />
    );
    expect(screen.getByText("لا توجد محطات بعد")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("keeps the same structure in both directions", () => {
    parity(() => (
      <Map
        label="خريطة"
        points={POINTS}
        tileUrl={TEMPLATE}
        attribution="©"
        fallbackLabel="المحطات"
        emptyLabel="لا توجد"
        unavailableLabel="غير متاحة"
      />
    ));
    parity(() => <MapFallbackList label="المحطات" points={POINTS} emptyLabel="لا توجد" />);
    parity(() => <MapMarker leftPct={40} topPct={60} kind="driver" live />);
  });
});
