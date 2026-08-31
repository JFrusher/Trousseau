/**
 * The editable timeline: Cadence's own document, unchanged.
 *
 * This module used to carry a trimmed copy of Cadence's model. It now re-exports
 * the real one from `lib/timeline/core`, so the scheduling resolver, the clash
 * checks, the solar calculation and all five printed pieces consume exactly the
 * document they were written against — rather than a lookalike that has to be
 * kept in step by hand.
 *
 * The slice holds the *source*: anchors, gaps and squeeze floors, before
 * anything is worked out. The envelope's `day` slice is the resolved
 * publication (`kind: "cadence.day"`) that the delegation board and any outside
 * reader consume. Both are kept, and only the first can be edited.
 *
 * `timeline` is not one of the contract package's `SLICE_NAMES`. The envelope is
 * a `looseObject` at every level precisely so a new slice can appear without a
 * release, so this is the intended way in — but the package should gain the name
 * when it is next touched.
 */

export type {
  Block,
  DaySettings,
  OutputId,
  OutputSpec,
  StyleSpec,
  TagDetail,
  TimelineDoc,
  UploadedFont,
} from "@/lib/timeline/core/model/types";

export { isMoment, OUTPUT_IDS } from "@/lib/timeline/core/model/types";

export {
  APP_VERSION,
  DEFAULT_BLOCK_OUTPUTS,
  DEFAULT_LANES,
  DEFAULT_OUTPUTS,
  SCHEMA_VERSION,
  defaultDay,
  defaultStyles,
  emptyDoc,
} from "@/lib/timeline/core/model/defaults";

/**
 * What the rest of the suite calls the timeline.
 *
 * An alias rather than a second interface: every consumer wants the whole
 * document, and a narrower type here would only mean casting at each use.
 */
export type { TimelineDoc as Timeline } from "@/lib/timeline/core/model/types";
