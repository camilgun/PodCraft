import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TranscriptViewer } from "./transcript-viewer";
import type { AlignedSegment } from "@podcraft/shared";

// jsdom doesn't implement scrollIntoView — mock it to avoid errors.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

function makeSegment(
  id: string,
  text: string,
  startTime: number,
  endTime: number,
): AlignedSegment {
  return {
    id,
    text,
    startTime,
    endTime,
    orderIndex: 0,
    words: [{ word: text, startTime, endTime, confidence: 1.0 }],
  };
}

const segments: AlignedSegment[] = [
  makeSegment("s1", "primo segmento", 0.0, 5.0),
  makeSegment("s2", "secondo segmento", 5.5, 10.0),
  makeSegment("s3", "terzo segmento", 11.0, 15.0),
];

describe("TranscriptViewer", () => {
  it("renders all segments", () => {
    render(<TranscriptViewer segments={segments} currentTime={0} onSeek={vi.fn()} />);
    // getByText throws if element is absent, so no extra assertion needed.
    expect(screen.getByText("primo segmento")).toBeTruthy();
    expect(screen.getByText("secondo segmento")).toBeTruthy();
    expect(screen.getByText("terzo segmento")).toBeTruthy();
  });

  it("highlights the active segment when currentTime is within its range", () => {
    render(<TranscriptViewer segments={segments} currentTime={3.0} onSeek={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    // First segment (0–5s) should be active
    expect(buttons[0]!.className).toContain("bg-primary/10");
    expect(buttons[1]!.className).not.toContain("bg-primary/10");
    expect(buttons[2]!.className).not.toContain("bg-primary/10");
  });

  it("highlights the second segment when currentTime is within its range", () => {
    render(<TranscriptViewer segments={segments} currentTime={7.0} onSeek={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]!.className).not.toContain("bg-primary/10");
    expect(buttons[1]!.className).toContain("bg-primary/10");
  });

  it("highlights nothing when currentTime is in a gap between segments", () => {
    // Gap between s1 (0–5) and s2 (5.5–10): currentTime 5.2
    render(<TranscriptViewer segments={segments} currentTime={5.2} onSeek={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.className).not.toContain("bg-primary/10");
    }
  });

  it("calls onSeek with segment startTime on click", async () => {
    const onSeek = vi.fn();
    const user = userEvent.setup();
    render(<TranscriptViewer segments={segments} currentTime={0} onSeek={onSeek} />);
    await user.click(screen.getByText("secondo segmento"));
    expect(onSeek).toHaveBeenCalledWith(5.5);
  });

  it("shows formatted timestamps for each segment", () => {
    render(<TranscriptViewer segments={segments} currentTime={0} onSeek={vi.fn()} />);
    // startTime 0 → "0:00", 5.5 → "0:05", 11.0 → "0:11"
    expect(screen.getByText("0:00")).toBeTruthy();
    expect(screen.getByText("0:05")).toBeTruthy();
    expect(screen.getByText("0:11")).toBeTruthy();
  });

  it("renders empty container when segments is empty", () => {
    render(<TranscriptViewer segments={[]} currentTime={0} onSeek={vi.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
