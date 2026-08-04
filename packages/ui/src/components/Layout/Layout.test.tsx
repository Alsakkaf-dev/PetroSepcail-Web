import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Container } from "./Container";
import { Page, SkipLink } from "./Page";
import { Section } from "./Section";
import { Divider, Eyebrow, SectionHead } from "./SectionHead";
import { Stack } from "./Stack";
import { Cluster } from "./Cluster";
import { Grid } from "./Grid";
import { Rail } from "./Rail";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

/** Renders the same element under both document directions and asserts one
 * markup tree comes out — the whole point of the primitive layer being CSS
 * logical properties rather than direction branches. */
function expectStructuralParity(build: () => JSX.Element) {
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

describe("Page", () => {
  it("is the main landmark and is focusable so the skip link lands on it", () => {
    render(<Page>content</Page>);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveClass("ps-page", "ps-page--standard", "ps-page--air-app");
  });

  it("defaults to the dense application ramp, not brochure air", () => {
    render(<Page>content</Page>);
    expect(screen.getByRole("main")).not.toHaveClass("ps-page--air-brochure");
  });

  it("points the skip link at the page id", () => {
    render(<SkipLink label="تخطَّ إلى المحتوى" />);
    expect(screen.getByRole("link", { name: "تخطَّ إلى المحتوى" })).toHaveAttribute("href", "#main");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    expectStructuralParity(() => (
      <Page width="wide">
        <Stack>content</Stack>
      </Page>
    ));
  });
});

describe("Section", () => {
  it("omits the decorative layer unless one is asked for", () => {
    const { container } = render(<Section>body</Section>);
    expect(container.querySelector(".ps-section__decor")).toBeNull();
  });

  it("hides the decorative layer from assistive tech", () => {
    const { container } = render(<Section decor="viscosity">body</Section>);
    const decor = container.querySelector(".ps-section__decor");
    expect(decor).toHaveClass("ps-section__decor--viscosity");
    expect(decor).toHaveAttribute("aria-hidden", "true");
  });

  it("can be named by its own heading", () => {
    render(
      <Section aria-labelledby="s1">
        <SectionHead level={2} titleId="s1" title="الذمم المدينة" />
      </Section>
    );
    expect(screen.getByRole("region", { name: "الذمم المدينة" })).toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    expectStructuralParity(() => (
      <Section tone="mesh" decor="contours">
        body
      </Section>
    ));
  });
});

describe("SectionHead", () => {
  it("renders the brand triplet: eyebrow, heading, divider", () => {
    const { container } = render(<SectionHead eyebrow="الفواتير" title="فواتيرك" lead="آخر 12 شهرًا" />);
    expect(container.querySelector(".ps-eyebrow")).toHaveTextContent("الفواتير");
    expect(screen.getByRole("heading", { level: 2, name: "فواتيرك" })).toBeInTheDocument();
    const divider = container.querySelector(".ps-divider");
    expect(divider).toHaveAttribute("aria-hidden", "true");
    expect(divider?.querySelector("svg")).not.toBeNull();
  });

  it("takes its heading rank from the outline, not from the wanted size", () => {
    render(<SectionHead level={1} title="لوحة التحكم" />);
    expect(screen.getByRole("heading", { level: 1, name: "لوحة التحكم" })).toBeInTheDocument();
  });

  it("keeps trailing actions in the heading row", () => {
    const { container } = render(<SectionHead title="الطلبات" actions={<button type="button">تصدير</button>} />);
    expect(container.querySelector(".ps-section-head__actions")).toContainElement(
      screen.getByRole("button", { name: "تصدير" })
    );
  });

  it("renders a line divider with no diamond", () => {
    const { container } = render(<Divider variant="line" />);
    expect(container.querySelector(".ps-divider--line")?.querySelector("svg")).toBeNull();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    expectStructuralParity(() => (
      <SectionHead
        eyebrow={<Eyebrow>x</Eyebrow>}
        title="t"
        lead="l"
        titleId="t1"
        actions={<button type="button">a</button>}
      />
    ));
  });
});

describe("Stack, Cluster and Grid", () => {
  it("share one gap ramp", () => {
    const { container } = render(
      <Stack gap="xl">
        <Cluster gap="xl">a</Cluster>
        <Grid gap="xl">b</Grid>
      </Stack>
    );
    expect(container.querySelectorAll(".ps-gap-xl")).toHaveLength(3);
  });

  it("defaults Cluster to wrapping, so a chip row never scrolls at 360px", () => {
    const { container } = render(<Cluster>chips</Cluster>);
    expect(container.firstElementChild).not.toHaveClass("ps-cluster--nowrap");
  });

  it("expresses alignment as start/end rather than left/right", () => {
    const { container } = render(
      <Cluster justify="between" align="baseline">
        x
      </Cluster>
    );
    expect(container.firstElementChild).toHaveClass("ps-cluster--justify-between", "ps-cluster--align-baseline");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    expectStructuralParity(() => (
      <Stack gap="lg" align="start">
        <Cluster justify="between">
          <span>a</span>
          <span>b</span>
        </Cluster>
        <Grid cols="4">
          <span>c</span>
        </Grid>
        <Container width="narrow">d</Container>
      </Stack>
    ));
  });
});

describe("Rail", () => {
  it("keeps source order rail-then-main, which is also the stacked order", () => {
    const { container } = render(<Rail rail={<span>filters</span>}>results</Rail>);
    const root = container.firstElementChild;
    expect(root?.children[0]).toHaveClass("ps-rail__side");
    expect(root?.children[1]).toHaveClass("ps-rail__main");
    // Which side the rail takes on desktop resolves from the document
    // direction, never from a mirrored stylesheet.
    expect(root).toHaveClass("ps-rail--start");
  });

  it("does not stick by default", () => {
    const { container } = render(<Rail rail={<span>x</span>}>y</Rail>);
    expect(container.firstElementChild).not.toHaveClass("ps-rail--sticky");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    expectStructuralParity(() => (
      <Rail rail={<span>r</span>} placement="end" sticky>
        <span>m</span>
      </Rail>
    ));
  });
});
