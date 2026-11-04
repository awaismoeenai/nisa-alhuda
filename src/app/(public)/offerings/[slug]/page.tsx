/**
 * Offering detail — the public page between the catalogue and the enrol wizard.
 *
 * Layout:
 *   - Full-width hero banner with aurora backdrop, type chips, title, subhead
 *   - Two-column body: "About" + subjects/instructor on left, sticky
 *     enrolment card on right (floats to top on mobile)
 *
 * Re-skinned onto the shared course vocabulary in `@/components/course`: every
 * body panel and the enrolment card are `courseCard` (white on cream, rose
 * hairline, soft rose shadow, `--radius` corners), the hero chips are the same
 * `badgeBase`/`pillTones` the course header uses, and the CTA is
 * `courseButtonPrimary`. A visitor who enrols lands on a student hub built from
 * the same parts.
 *
 * Kept from the marketing version, deliberately: the full-bleed aurora hero
 * with drifting blossoms, the display-scale title, the kufic-patterned
 * thumbnail, and the "What's included" reassurance list. Only the surfaces and
 * type scale moved.
 *
 * Data fetching is unchanged, as is the enrol link — this file is presentation.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Calendar,
  Clock,
  Users,
  BookOpen,
  ArrowRight,
  MapPin,
  Wifi,
  Lock,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PROFILE_SELECT_PUBLIC } from "@/lib/db/profiles";
import { cn } from "@/lib/utils";
import { FloatingBlossoms } from "@/components/landing/florals";
import {
  badgeBase,
  courseButtonPrimary,
  courseCard,
  courseCardHover,
  courseTag,
  iconTints,
  pillBase,
  pillTones,
} from "@/components/course/course-surface";
import { formatPriceWithFee } from "@/lib/constants";
import type {
  Offering,
  Subject,
  PublicProfile,
} from "@/lib/types/database";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: offering } = await supabase
    .from("offerings")
    .select("title, short_description")
    .eq("slug", slug)
    .single();

  if (!offering) return { title: "Not Found" };

  return {
    title: offering.title,
    description: offering.short_description || undefined,
  };
}

export default async function OfferingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: offering } = await supabase
    .from("offerings")
    .select("*")
    .eq("slug", slug)
    .in("status", ["published", "archived"])
    .single<Offering>();

  if (!offering) notFound();

  // This page is public, so both reads below run as `anon`. They must ask
  // for PROFILE_SELECT_PUBLIC and nothing more: a column `anon` was not
  // granted makes PostgREST refuse the WHOLE request with 401, which is
  // how `instructor:profiles(*)` had been quietly returning no subjects
  // at all ever since migration 046 narrowed the grant.
  let subjects: (Subject & { instructor: PublicProfile | null })[] = [];
  if (offering.type === "program") {
    const { data } = await supabase
      .from("subjects")
      .select(
        `*, instructor:profiles!subjects_instructor_id_fkey(${PROFILE_SELECT_PUBLIC})`
      )
      .eq("offering_id", offering.id)
      .order("sort_order", { ascending: true });
    subjects =
      (data as (Subject & { instructor: PublicProfile | null })[]) || [];
  }

  let instructor: PublicProfile | null = null;
  if (offering.instructor_id) {
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT_PUBLIC)
      .eq("id", offering.instructor_id)
      .single<PublicProfile>();
    instructor = data;
  }

  const typeLabels = {
    program: "Program",
    course: "Course",
    workshop: "Workshop",
    class: "Class",
  } as const;

  const modeLabel =
    offering.mode === "onsite"
      ? "Onsite"
      : offering.mode === "hybrid"
      ? "Hybrid"
      : "Online";
  const ModeIcon = offering.mode === "onsite" ? MapPin : Wifi;

  return (
    <div>
      {/* ─── Hero banner ─── */}
      <section className="relative overflow-hidden py-14 md:py-20">
        <div className="aurora absolute inset-0 -z-20 opacity-60" aria-hidden />
        <div className="grid-fade absolute inset-0 -z-10" aria-hidden />
        <FloatingBlossoms className="-z-10" />

        <div className="container relative mx-auto px-4">
          <Link
            href="/catalog"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-rose-700 dark:hover:text-rose-300"
          >
            ← Back to catalog
          </Link>

          <div className="mt-6 max-w-3xl">
            {/* Chips — the course header's badge row */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className={cn(badgeBase, pillTones.brand)}>
                {typeLabels[offering.type]}
              </span>
              {offering.type === "program" && (
                <span className={cn(badgeBase, pillTones.success)}>Age 12+</span>
              )}
              <span
                className={cn(
                  badgeBase,
                  pillTones.muted,
                  "inline-flex items-center gap-1"
                )}
              >
                <ModeIcon className="h-3 w-3" />
                {modeLabel}
              </span>
              {offering.is_new && (
                <span
                  className={cn(
                    badgeBase,
                    pillTones.warning,
                    "inline-flex items-center gap-1"
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  New
                </span>
              )}
              {offering.is_ongoing && (
                <span
                  className={cn(
                    badgeBase,
                    pillTones.success,
                    "inline-flex items-center gap-1"
                  )}
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  On-going
                </span>
              )}
              {offering.admission_closed && (
                <span
                  className={cn(
                    badgeBase,
                    "inline-flex items-center gap-1 bg-[#FBEEEE] text-[#9A3D3D] dark:bg-red-950/40 dark:text-red-300"
                  )}
                >
                  <Lock className="h-3 w-3" />
                  Admission Closed
                </span>
              )}
            </div>

            <h1 className="font-heading text-4xl leading-[1.1] font-bold tracking-[-0.01em] text-balance sm:text-5xl md:text-6xl">
              {offering.title}
            </h1>

            {offering.short_description && (
              <p className="mt-5 max-w-2xl text-lg text-plum-body dark:text-muted-foreground">
                {offering.short_description}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Body ─── */}
      <section className="pb-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Left: content */}
            <div className="space-y-5 lg:col-span-2">
              {/* About */}
              <Panel title={`About this ${typeLabels[offering.type].toLowerCase()}`}>
                <div className="mt-3.5 text-sm leading-relaxed whitespace-pre-line text-plum-body dark:text-muted-foreground">
                  {offering.description}
                </div>
              </Panel>

              {/* Subjects (programs) */}
              {offering.type === "program" && subjects.length > 0 && (
                <div>
                  <SectionHeading>Subjects covered</SectionHeading>
                  <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
                    {subjects.map((subject) => (
                      <div
                        key={subject.id}
                        className={cn(
                          courseCard,
                          courseCardHover,
                          "min-w-0 p-[18px]"
                        )}
                      >
                        <div
                          className={cn(
                            "mb-3.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px]",
                            iconTints.brand
                          )}
                        >
                          <BookOpen className="h-[18px] w-[18px]" />
                        </div>
                        <h3 className="font-heading text-[15px] font-semibold">
                          {subject.title}
                        </h3>
                        {subject.description && (
                          <p className="mt-1 text-[13px] leading-relaxed text-plum-body dark:text-muted-foreground">
                            {subject.description}
                          </p>
                        )}
                        {/* `steel` is the instructor hue across the product */}
                        <p
                          className={cn(
                            pillBase,
                            pillTones.steel,
                            "mt-3.5 inline-flex items-center gap-1.5"
                          )}
                        >
                          <Users className="h-3 w-3" />
                          {subject.instructor?.full_name || "Instructor TBA"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Instructor (non-programs) */}
              {instructor && offering.type !== "program" && (
                <div>
                  <SectionHeading>Your instructor</SectionHeading>
                  <div
                    className={cn(
                      courseCard,
                      "mt-3.5 flex items-center gap-3.5 p-[18px]"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px]",
                        pillTones.steel
                      )}
                    >
                      <Users className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-heading text-[15px] font-semibold">
                        {instructor.full_name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Instructor
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* What's included (static quality list) */}
              <Panel title="What's included">
                <ul className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {[
                    "Live classes with recordings",
                    "Lifetime access to resources",
                    "Private sisters-only group chat",
                    "Certificate of completion",
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-2 text-sm text-plum-body dark:text-muted-foreground"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-rose-500 dark:text-rose-300" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            {/* Right: sticky enrolment card */}
            <aside className="lg:col-span-1">
              <div className="lg:sticky lg:top-24">
                <div className={cn(courseCard, "overflow-hidden")}>
                  {/* Thumbnail */}
                  <div className="kufic-pattern relative aspect-video border-b border-border-soft bg-gradient-to-br from-rose-100 via-background to-rose-50 dark:border-border dark:from-rose-950/40 dark:via-card dark:to-card">
                    {offering.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={offering.thumbnail_url}
                        alt={offering.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <BookOpen className="h-16 w-16 text-rose-300 dark:text-rose-800" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 p-5 sm:p-6">
                    {/* Price */}
                    <div>
                      <div className="font-heading text-[28px] leading-none font-bold tracking-[-0.01em] text-rose-600 dark:text-rose-300">
                        {formatPriceWithFee(offering.price, offering.fee_type)}
                      </div>
                      {offering.fee_type === "monthly" &&
                        offering.price > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Billed monthly
                          </p>
                        )}
                      {offering.price_inr && offering.price_inr > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          🇮🇳 India: ₹
                          {Number(offering.price_inr).toLocaleString("en-IN")}
                          {offering.fee_type === "monthly" ? " per month" : ""}
                        </p>
                      )}
                      {offering.price_usd && offering.price_usd > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          🌍 Intl: $
                          {Number(offering.price_usd).toLocaleString("en-US", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          })}{" "}
                          USD
                          {offering.fee_type === "monthly" ? " per month" : ""}
                        </p>
                      )}
                    </div>

                    <div className="h-px bg-border-soft dark:bg-border" />

                    {/* Key details */}
                    <div className="flex flex-wrap gap-1.5">
                      {offering.schedule_start && (
                        <Chip icon={<Calendar className="h-3 w-3" />}>
                          Starts{" "}
                          {new Date(
                            offering.schedule_start
                          ).toLocaleDateString("en-PK", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </Chip>
                      )}
                      {offering.schedule_end && (
                        <Chip icon={<Clock className="h-3 w-3" />}>
                          Ends{" "}
                          {new Date(offering.schedule_end).toLocaleDateString(
                            "en-PK",
                            {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            }
                          )}
                        </Chip>
                      )}
                      {offering.type === "program" && (
                        <Chip icon={<BookOpen className="h-3 w-3" />}>
                          {subjects.length} subjects included
                        </Chip>
                      )}
                      <Chip icon={<ModeIcon className="h-3 w-3" />}>
                        {modeLabel}
                      </Chip>
                    </div>

                    {/* CTA */}
                    {offering.admission_closed ? (
                      <div className="flex items-center justify-center gap-2 rounded-[10px] border border-[#E4A9A9] bg-[#FBEEEE] py-2.5 text-[13px] font-semibold text-[#9A3D3D] dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        <Lock className="h-4 w-4" />
                        Admission Closed
                      </div>
                    ) : (
                      <Link
                        href={`/offerings/${offering.slug}/enroll`}
                        className={cn(
                          courseButtonPrimary,
                          "press group h-11 w-full justify-center text-sm"
                        )}
                      >
                        Enroll Now
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    )}

                    <p className="text-center text-[11px] text-muted-foreground">
                      Lifetime access to recordings &amp; resources
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Section titles sit at the card's heading scale, not the hero's. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-heading text-[17px] font-bold tracking-[-0.01em]">
      {children}
    </h2>
  );
}

/** A titled body panel on the course card surface. */
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(courseCard, "p-5 sm:px-6 sm:py-[22px]")}>
      <SectionHeading>{title}</SectionHeading>
      {children}
    </div>
  );
}

/** A key detail on the enrolment card, in the shared meta-chip style. */
function Chip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(courseTag, "inline-flex items-center gap-1.5")}>
      <span className="text-rose-500 dark:text-rose-300">{icon}</span>
      {children}
    </span>
  );
}
