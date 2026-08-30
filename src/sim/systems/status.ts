import { ENEMIES } from '../../content/enemies.ts';
import type { World } from '../world.ts';

/**
 * Per-contact state that decays or recovers on its own.
 *
 * Runs before movement so a shield that came back this tick is up before
 * anything shoots at it.
 *
 * The gravitational slow deliberately stays in `moveCreeps`, where it is read.
 * Moving it here would be tidier by one measure and would shift slow expiry by
 * a tick — and the slow duration is already pinned by gates. Tidiness is not
 * worth perturbing verified behaviour; this system owns only what is new.
 */
export function updateStatuses(w: World, dt: number): void {
  for (const c of w.creeps) {
    if (c.dead || c.maxShield <= 0 || c.shield >= c.maxShield) continue;

    // Counts down from the def's delay, reset by every hit in `damageCreep`.
    if (c.shieldTimer > 0) {
      c.shieldTimer = Math.max(0, c.shieldTimer - dt);
      continue;
    }

    c.shield = Math.min(c.maxShield, c.shield + ENEMIES[c.defId].shieldRegenRate * dt);
  }
}
