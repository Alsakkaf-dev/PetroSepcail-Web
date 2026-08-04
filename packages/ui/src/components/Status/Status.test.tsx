import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Countdown } from "./Countdown";
import { ConnectivityBadge, SyncQueueBadge } from "./Connectivity";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const format = (p: { days: number; hours: number; minutes: number; seconds: number }) =>
  `${p.days}d ${p.hours}h ${p.minutes}m ${p.seconds}s`;

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down to the deadline", () => {
    render(
      <Countdown
        deadline="2026-08-06T10:00:00Z"
        format={format}
        expiredLabel="انتهت المهلة"
        label="الوقت المتبقي"
      />
    );
    // The 48-hour bank-transfer window.
    expect(screen.getByText("2d 0h 0m 0s")).toBeInTheDocument();
  });

  it("ticks once a minute above an hour, so a 30-day clock doesn't wake the device every second", () => {
    render(
      <Countdown deadline="2026-09-03T10:00:00Z" format={format} expiredLabel="x" label="l" />
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("29d 23h 59m 0s")).toBeInTheDocument();
  });

  it("shows the expired label and fires onExpire exactly once", () => {
    const onExpire = vi.fn();
    render(
      <Countdown
        deadline="2026-08-04T10:00:05Z"
        format={format}
        expiredLabel="انتهت المهلة"
        label="l"
        onExpire={onExpire}
      />
    );
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByText("انتهت المهلة")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("marks urgency without relying on the reader watching the number", () => {
    const { container } = render(
      <Countdown
        deadline="2026-08-04T10:20:00Z"
        format={format}
        expiredLabel="x"
        label="l"
        urgentBelowMs={30 * 60 * 1000}
      />
    );
    expect(container.firstElementChild).toHaveClass("ps-countdown--urgent");
  });

  it("announces politely — a screen reader interrupting every second is unusable", () => {
    const { container } = render(
      <Countdown deadline="2026-08-05T10:00:00Z" format={format} expiredLabel="x" label="l" />
    );
    expect(container.firstElementChild).toHaveAttribute("aria-live", "polite");
  });

  it("renders nothing for an unparseable deadline rather than NaN", () => {
    const { container } = render(<Countdown deadline="not-a-date" format={format} expiredLabel="x" label="l" />);
    expect(container.firstElementChild).toBeNull();
  });
});

describe("ConnectivityBadge", () => {
  it("changes glyph and wording together, never colour alone", () => {
    const { rerender, container } = render(
      <ConnectivityBadge online onlineLabel="متصل" offlineLabel="غير متصل" />
    );
    expect(screen.getByText("متصل")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("ps-connectivity--online");
    rerender(<ConnectivityBadge online={false} onlineLabel="متصل" offlineLabel="غير متصل" />);
    expect(screen.getByText("غير متصل")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("ps-connectivity--offline");
  });

  it("announces the change politely", () => {
    const { container } = render(<ConnectivityBadge online onlineLabel="a" offlineLabel="b" />);
    expect(container.firstElementChild).toHaveAttribute("aria-live", "polite");
  });
});

describe("SyncQueueBadge", () => {
  it("shows the queue while anything is waiting to reach the server", () => {
    render(<SyncQueueBadge pending={3} label="3 بانتظار المزامنة" />);
    expect(screen.getByText("3 بانتظار المزامنة")).toBeInTheDocument();
  });

  it("says so when the queue has drained, rather than vanishing silently", () => {
    render(<SyncQueueBadge pending={0} label="x" syncedLabel="تمت المزامنة" />);
    expect(screen.getByText("تمت المزامنة")).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<SyncQueueBadge pending={0} label="x" />);
    expect(container.firstElementChild).toBeNull();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = () => (
      <div>
        <ConnectivityBadge online={false} onlineLabel="a" offlineLabel="b" />
        <SyncQueueBadge pending={2} label="l" syncedLabel="s" />
      </div>
    );
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
  });
});
