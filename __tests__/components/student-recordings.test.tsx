/**
 * Student Learning Hub — the recording-watch guarantee.
 *
 * `lessons.recording_url` is the only copy of a class recording, and the
 * student accordion is where it is *watched*. The Phase 4 re-skin is
 * presentation-only, so this file pins the two watch paths to the DOM, in
 * terms of the URL itself rather than the styling around it:
 *
 *   1. A YouTube `recording_url` must reach `RecordingPlayer`. We let the real
 *      player run (Plyr is stubbed) and assert that the embed target it hands
 *      to Plyr carries the video id extracted from that exact URL — so the URL
 *      demonstrably flowed from the lesson row into the player.
 *   2. A non-YouTube `recording_url` must remain a plain external anchor whose
 *      `href` is byte-identical to the stored URL.
 *
 * Both are asserted with a recording present on a completed lesson and on an
 * un-completed one, because completion state must never hide a recording.
 *
 * The local dev database has zero recordings, so these assertions — not the
 * `recordings-snapshot` baseline — are what prove the affordances still work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubjectAccordion } from "@/app/dashboard/student/offerings/[id]/subject-accordion";
import type { Lesson, Subject } from "@/lib/types/database";
import { isClassDayPkt } from "@/lib/recurring-schedule";

/**
 * Plyr boots from a dynamic import inside an effect and expects a real media
 * pipeline. Stub the constructor and record the element it was given — that
 * element is where the URL-derived embed id lands.
 */
const plyrTargets: HTMLElement[] = [];
vi.mock("plyr", () => ({
  default: class {
    constructor(target: HTMLElement) {
      plyrTargets.push(target);
    }
    destroy() {}
    togglePlay() {}
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "stu-1" } } }) },
    from: () => ({
      insert: async () => ({ error: null }),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  }),
}));

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YOUTUBE_ID = "dQw4w9WgXcQ";
const VIMEO_URL = "https://vimeo.com/987654321/abcdef";
const ZOOM_RECORDING_URL =
  "https://us02web.zoom.us/rec/share/xYz-123_recording";
const LIVE_URL = "https://zoom.us/j/555000111";

const SUBJECT: Subject & { instructor: { full_name: string } | null } = {
  id: "sub-1",
  offering_id: "off-1",
  title: "Makhārij al-Ḥurūf",
  slug: "makharij-al-huruf",
  description: null,
  instructor_id: "ins-1",
  sort_order: 0,
  recurring_meeting_url: null,
  recurring_schedule_label: null,
  recurring_day_of_week: null,
  recurring_start_time: null,
  recurring_duration_minutes: null,
  quiz_url: null,
  created_at: "2025-12-01T00:00:00Z",
  updated_at: "2025-12-01T00:00:00Z",
  instructor: { full_name: "Ustadha Maryam" },
};

const PAST = "2020-01-05T13:00:00Z";
const FUTURE = "2099-01-05T13:00:00Z";

function lesson(overrides: Partial<Lesson> & { id: string }): Lesson {
  return {
    offering_id: "off-1",
    subject_id: "sub-1",
    title: "A class",
    description: null,
    scheduled_at: PAST,
    live_class_link: null,
    recording_url: null,
    sort_order: 0,
    is_published: true,
    created_at: "2025-12-01T00:00:00Z",
    updated_at: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

const LESSONS: Lesson[] = [
  lesson({
    id: "les-youtube",
    title: "Introduction & the throat letters",
    recording_url: YOUTUBE_URL,
    sort_order: 0,
  }),
  lesson({
    id: "les-vimeo",
    title: "The tongue letters",
    recording_url: VIMEO_URL,
    sort_order: 1,
  }),
  lesson({
    id: "les-zoom-done",
    title: "The lip letters",
    recording_url: ZOOM_RECORDING_URL,
    sort_order: 2,
  }),
  lesson({
    id: "les-live",
    title: "Revision & recitation",
    scheduled_at: FUTURE,
    live_class_link: LIVE_URL,
    sort_order: 3,
  }),
];

/** `les-zoom-done` is already marked watched — a recording must survive that. */
function renderAccordion(completed: string[] = ["les-zoom-done"]) {
  return render(
    <SubjectAccordion
      subjects={[SUBJECT]}
      lessonsBySubject={{ "sub-1": LESSONS }}
      resourcesBySubject={{}}
      quizzesBySubject={{}}
      completedLessonIds={completed}
      offeringId="off-1"
    />
  );
}

/** The `<li>` a given lesson title sits in. */
function row(title: string): HTMLElement {
  const el = screen.getByText(title).closest("li");
  if (!el) throw new Error(`No lesson row for "${title}"`);
  return el as HTMLElement;
}

beforeEach(() => {
  plyrTargets.length = 0;
});

describe("SubjectAccordion — recording watch paths", () => {
  it("renders a RecordingPlayer for a YouTube recording_url", () => {
    renderAccordion();

    // The player's own collapsed affordance — a button, not a link.
    const toggle = within(row("Introduction & the throat letters")).getByRole(
      "button",
      { name: /Watch recording/ }
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("passes the YouTube recording_url through to the player embed", async () => {
    const user = userEvent.setup();
    renderAccordion();

    await user.click(
      within(row("Introduction & the throat letters")).getByRole("button", {
        name: /Watch recording/,
      })
    );

    // Plyr is handed a target carrying the id extracted from the stored URL.
    await waitFor(() => expect(plyrTargets).toHaveLength(1));
    expect(plyrTargets[0].getAttribute("data-plyr-provider")).toBe("youtube");
    expect(plyrTargets[0].getAttribute("data-plyr-embed-id")).toBe(YOUTUBE_ID);
  });

  it("renders an external Watch link carrying a non-YouTube recording_url", () => {
    renderAccordion();

    const link = within(row("The tongue letters")).getByRole("link", {
      name: /Watch recording/,
    });
    expect(link).toHaveAttribute("href", VIMEO_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("keeps the recording reachable on a lesson already marked watched", () => {
    renderAccordion(["les-zoom-done"]);

    const watched = row("The lip letters");
    // Completion state is on the toggle, not on the recording.
    expect(
      within(watched).getByRole("button", { name: /Watched/ })
    ).toBeInTheDocument();
    expect(
      within(watched).getByRole("link", { name: /Watch recording/ })
    ).toHaveAttribute("href", ZOOM_RECORDING_URL);
  });

  it("offers no recording affordance for a lesson without one", () => {
    renderAccordion();

    const live = row("Revision & recitation");
    expect(
      within(live).queryByRole("link", { name: /Watch recording/ })
    ).toBeNull();
    expect(
      within(live).queryByRole("button", { name: /Watch recording/ })
    ).toBeNull();
  });

  it("keeps the live_class_link Join path on an upcoming lesson", () => {
    renderAccordion();

    const link = within(row("Revision & recitation")).getByRole("link", {
      name: /Join live/,
    });
    expect(link).toHaveAttribute("href", LIVE_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("keeps the Watch / Watched completion toggle on every class", () => {
    renderAccordion(["les-zoom-done"]);

    expect(screen.getAllByRole("button", { name: /^Watch$/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Watched$/ })).toHaveLength(1);
  });
});

/**
 * This product runs on Pakistan Standard Time, because the students are in
 * Pakistan. `isClassDayPkt` therefore shifts the instant by +5h and only then
 * reads `getUTCDay()`, and so does every other day-of-week in the app. The
 * fixture below used to build its day from the *true* UTC day instead, which
 * disagrees with the Pakistan day every evening from 19:00 UTC once the
 * Pakistan date has already rolled over — so the suite went red for five
 * hours a night with no code change involved (#71).
 *
 * Two things keep it honest now. The clock is frozen, so the result no longer
 * depends on what time of day the suite is run. And the day is read back
 * through the very helper the component reads it through, rather than
 * recomputed here — a second copy of the +5 offset living in the test would
 * be free to drift away from the one in `src/lib/recurring-schedule.ts`.
 */
// 21:30 UTC sits deliberately inside the window that used to fail: in
// Pakistan it is already 02:30 on the following day, a different weekday.
const FROZEN_NOW = new Date("2026-03-10T21:30:00.000Z");

/** The day-of-week the component will see, asked of the component's own helper. */
function pktDayOfWeek(now: Date): number {
  for (let day = 0; day < 7; day += 1) {
    if (isClassDayPkt({ ...SUBJECT, recurring_day_of_week: day }, now)) {
      return day;
    }
  }
  // An empty match is a broken check, never a clean result: if no day matches,
  // the Pakistan convention has changed shape and this test must say so.
  throw new Error(
    "isClassDayPkt matched no day of the week — the Pakistan day convention changed shape"
  );
}

describe("SubjectAccordion — subject-level actions", () => {
  beforeEach(() => {
    // Only `Date` is faked; React Testing Library still needs real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the recurring live class Join and the quiz launcher", () => {
    render(
      <SubjectAccordion
        subjects={[
          {
            ...SUBJECT,
            // A window wide enough that the class is always "live now",
            // so the day-gated Join is deterministic in CI.
            recurring_meeting_url: LIVE_URL,
            recurring_day_of_week: pktDayOfWeek(new Date()),
            recurring_start_time: "00:00:00",
            recurring_duration_minutes: 24 * 60,
            quiz_url: "https://forms.gle/abc123",
          },
        ]}
        lessonsBySubject={{ "sub-1": LESSONS }}
        resourcesBySubject={{}}
        completedLessonIds={[]}
        offeringId="off-1"
        quizzesBySubject={{}}
      />
    );

    expect(screen.getByRole("link", { name: /Join Live/ })).toHaveAttribute(
      "href",
      LIVE_URL
    );
    expect(screen.getByRole("link", { name: /Take Quiz/ })).toHaveAttribute(
      "href",
      "https://forms.gle/abc123"
    );
  });
});
