/**
 * Which visual field a level is set in.
 *
 * An **id, not a colour**. Content may not import the renderer — see the
 * boundary in `eslint.config.js` — and it should not want to: a level saying
 * `field: 'cascade'` is naming a place, while a level carrying `#05090e` would
 * be naming a pixel, and the second is how a palette ends up scattered across
 * the content directory where no reskin can find it.
 *
 * The split mirrors how `TowerId` and `EnemyId` already work: the identifier
 * lives here, and `render/theme.ts` imports it to key the actual values. That
 * direction is legal and the reverse is not, which is precisely why the ids are
 * the half that lives in content.
 *
 * One field per board today, and the names match the maps. They are separate
 * types on purpose — two sectors sharing a look is a reasonable thing to want,
 * and `LevelDef.field` is what would express it.
 *
 * The five multi-lane sectors do not exercise that: they get fields of their
 * own, derived as *value steps* off the first three rather than authored from
 * nothing. Eight boards wearing three faces would make the back half of the
 * campaign feel like the front half relabelled, and the map spec's own rule for
 * lanes — value steps of the accent, no new hues — is the obvious one to hold
 * the palette to as well.
 */
export const SECTOR_FIELD_IDS = [
  'switchback',
  'cascade',
  'pincer',
  'fork',
  'delta',
  'braid',
  'sluice',
  'crown',
  /**
   * Front Line — the versus board, and the only field here that is not a
   * campaign sector. It shares the list because `LevelDef.field` is one type
   * and a second parallel one would be two places to add a board.
   */
  'frontline',
] as const;

export type SectorFieldId = (typeof SECTOR_FIELD_IDS)[number];
