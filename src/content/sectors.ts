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
 */
export const SECTOR_FIELD_IDS = ['switchback', 'cascade', 'pincer'] as const;

export type SectorFieldId = (typeof SECTOR_FIELD_IDS)[number];
