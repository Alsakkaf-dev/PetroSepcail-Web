import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Brand } from "./Brand";
import { AppShell } from "./AppShell";
import { SideRail } from "./SideRail";
import { AppFooter } from "./AppFooter";
import { AuthShell } from "./AuthShell";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const LOGO = "/brand/petrospecial.png";

describe("Brand", () => {
  it("names the company in the alt text, not the file", () => {
    render(<Brand logoSrc={LOGO} logoAlt="بتروسبيشل" />);
    expect(screen.getByAltText("بتروسبيشل")).toBeInTheDocument();
  });

  it("reserves the mark's box so the header cannot reflow around it", () => {
    render(<Brand logoSrc={LOGO} logoAlt="بتروسبيشل" />);
    const img = screen.getByAltText("بتروسبيشل");
    expect(img).toHaveAttribute("width", "204");
    expect(img).toHaveAttribute("height", "68");
  });

  it("is a link only when it has somewhere to go", () => {
    const { container, rerender } = render(<Brand logoSrc={LOGO} logoAlt="بتروسبيشل" />);
    expect(container.querySelector("a")).toBeNull();
    rerender(<Brand href="/" logoSrc={LOGO} logoAlt="بتروسبيشل" />);
    expect(container.querySelector("a")).toHaveAttribute("href", "/");
  });

  it("says which portal you are in", () => {
    render(<Brand logoSrc={LOGO} logoAlt="بتروسبيشل" portal="منصة الموزّعين" />);
    expect(screen.getByText("منصة الموزّعين")).toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("draws header, rail, content and footer in that source order", () => {
    const { container } = render(
      <AppShell header={<header>h</header>} sidebar={<nav>r</nav>} footer={<footer>f</footer>}>
        <p>content</p>
      </AppShell>
    );
    const order = [...container.querySelectorAll("header, nav, p, footer")].map((el) => el.tagName.toLowerCase());
    expect(order).toEqual(["header", "nav", "p", "footer"]);
  });

  it("only becomes a two-column grid when there is a rail to put in it", () => {
    const { container, rerender } = render(<AppShell>x</AppShell>);
    expect(container.querySelector(".ps-shell__body--railed")).toBeNull();
    rerender(<AppShell sidebar={<nav>r</nav>}>x</AppShell>);
    expect(container.querySelector(".ps-shell__body--railed")).toBeInTheDocument();
  });
});

describe("SideRail", () => {
  const GROUPS = [
    { items: [{ href: "/dashboard", label: "لوحة التحكم", icon: "dashboard" as const, current: true }] },
    { label: "المالية", items: [{ href: "/finance", label: "المالية", badge: "٣" }] }
  ];

  it("names its landmark, because a railed app has two navigations", () => {
    render(<SideRail label="أقسام لوحة التحكم" groups={GROUPS} />);
    expect(screen.getByRole("navigation", { name: "أقسام لوحة التحكم" })).toBeInTheDocument();
  });

  it("marks the current page for assistive tech, not only in colour", () => {
    render(<SideRail label="x" groups={GROUPS} />);
    expect(screen.getByRole("link", { name: /لوحة التحكم/ })).toHaveAttribute("aria-current", "page");
  });

  it("keeps a count beside the destination it belongs to", () => {
    render(<SideRail label="x" groups={GROUPS} />);
    expect(screen.getByRole("link", { name: /المالية/ })).toHaveTextContent("٣");
  });
});

describe("AppFooter", () => {
  it("omits the nav landmark entirely when it has no links", () => {
    const { container } = render(<AppFooter legal="© ٢٠٢٦" />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("carries the legal line", () => {
    render(<AppFooter legal="© ٢٠٢٦ بتروسبيشل" />);
    expect(screen.getByText("© ٢٠٢٦ بتروسبيشل")).toBeInTheDocument();
  });
});

describe("AuthShell", () => {
  it("gives the screen exactly one h1 — the sign-in heading", () => {
    render(
      <AuthShell title="تسجيل الدخول" lead="بوابة السائقين">
        <form aria-label="f" />
      </AuthShell>
    );
    expect(screen.getByRole("heading", { level: 1, name: "تسجيل الدخول" })).toBeInTheDocument();
  });

  it("hides the decorative layer from assistive tech", () => {
    const { container } = render(<AuthShell title="t">x</AuthShell>);
    expect(container.querySelector(".ps-auth__decor")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("structural parity (TC-PC08-002)", () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ["Brand", () => <Brand href="/" logoSrc={LOGO} logoAlt="بتروسبيشل" portal="منصة الموزّعين" />],
    [
      "AppShell",
      () => (
        <AppShell header={<header>h</header>} sidebar={<nav>r</nav>} footer={<footer>f</footer>}>
          <p>c</p>
        </AppShell>
      )
    ],
    [
      "SideRail",
      () => (
        <SideRail
          label="x"
          groups={[{ label: "g", items: [{ href: "/a", label: "a", icon: "dashboard", current: true, badge: "٣" }] }]}
        />
      )
    ],
    ["AppFooter", () => <AppFooter brand={<span>b</span>} tagline="t" links={[{ href: "/a", label: "a" }]} legal="©" />],
    ["AuthShell", () => <AuthShell brand={<span>b</span>} title="t" lead="l" footer={<span>f</span>}>x</AuthShell>]
  ];

  it.each(cases)("%s renders an identical tree in both directions", (_name, node) => {
    const rtl = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(node());
      const sig = structuralSignature(container.firstElementChild!);
      cleanup();
      return sig;
    });
    const ltr = withDocumentDirection("ltr", "en", () => {
      const { container } = render(node());
      const sig = structuralSignature(container.firstElementChild!);
      cleanup();
      return sig;
    });
    expect(rtl).toEqual(ltr);
  });
});
