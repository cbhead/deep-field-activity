import { createRenderer } from './render/pixiApp.ts';
import { createTextures } from './render/textures.ts';
import { buildMapLayer } from './render/mapLayer.ts';
import { WorldView } from './render/worldView.ts';
import { Overlay } from './render/overlay.ts';
import { Effects } from './render/effects.ts';
import { tilesToPx } from './render/constants.ts';
import { applyHudTheme } from './render/theme.ts';
import { LEVEL01 } from './content/maps/level01.ts';
import { CAMPAIGN, levelById, levelIndex, type LevelDef } from './content/levels.ts';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, type DifficultyId } from './content/difficulty.ts';
import { parseMap } from './sim/util/grid.ts';
import { hashSeed, formatSeed } from './sim/util/rng.ts';
import { DEFAULT_RULES, resolveRules, type Rules } from './sim/rules.ts';
import { createWorld, type World } from './sim/world.ts';
import { grade } from './sim/analysis.ts';
import { recordRun } from './app/progress.ts';
import { createMenuScreen } from './ui/menuScreen.ts';
import { createLoop } from './app/loop.ts';
import { attachInput } from './app/input.ts';
import { createUiState } from './app/uiState.ts';
import { createHud, type CampaignPorts } from './ui/hud.ts';
import { planWave, waveCount } from './sim/wavePlan.ts';
import { BALANCE } from './content/balance.ts';
import { serverUrl } from './net/NetClient.ts';
import { DEFAULT_PORT } from './net/protocol.ts';
import { MatchController } from './net/MatchController.ts';
import { createLobbyScreen } from './ui/lobbyScreen.ts';
import { createRaceHud, type RaceHud } from './ui/raceHud.ts';
import { showResults } from './ui/resultsScreen.ts';
import { getWebhook, matchReport, postToDiscord } from './ui/discord.ts';

/**
 * The match seed comes from the URL so any run is reproducible: `?seed=hunter2`
 * turns "reproduce that bug" and "race the same board again" into free features.
 * In Race mode (phase 2) the server supplies this instead.
 */
function resolveSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '') {
    // Presentation-layer randomness, so Math.random is correct here.
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  const asInt = Number(raw);
  return Number.isInteger(asInt) && asInt >= 0 ? asInt >>> 0 : hashSeed(raw);
}

/** The HUD is text; 10Hz is indistinguishable from 60 and does a sixth the work. */
const HUD_INTERVAL_MS = 100;

// Before main(), not inside it: main is async and the stylesheet resolves every
// colour through these properties, so deferring them to the first await would
// paint an unstyled HUD.
applyHudTheme();

async function main(): Promise<void> {
  const mount = document.getElementById('game-root');
  const hudRoot = document.getElementById('hud');
  if (!mount || !hudRoot) throw new Error('#game-root or #hud missing from index.html');

  const params = new URLSearchParams(location.search);
  const race = params.get('race');
  if (race === null) {
    await startSinglePlayer(mount, hudRoot, params);
    return;
  }

  // Race mode: `?race` opens the lobby screen, `?race=CODE` deep-links into a
  // room. Port is explicit because dev serves the page from Vite while the
  // relay listens on DEFAULT_PORT; at N6 one process serves both and the two
  // collapse to the same host:port.
  let controller: MatchController;
  let raceHud: RaceHud | null = null;
  let opponentName = 'opponent';
  let currentRoom = '';
  let playerName = '';
  let matchSeed = 0;

  // A rematch reloads the page with {name, room} stashed, then rejoins and
  // readies up without touching the form. Cleared immediately so a plain
  // reload never accidentally re-enters a room.
  const rejoinRaw = sessionStorage.getItem('race-rejoin');
  sessionStorage.removeItem('race-rejoin');
  const rejoin = rejoinRaw !== null ? (JSON.parse(rejoinRaw) as { name: string; room: string }) : null;

  const lobby = createLobbyScreen(mount, {
    ...(rejoin !== null ? { autoJoin: rejoin } : race === '' ? {} : { prefillRoom: race }),
    facts: { sector: LEVEL01.name, waves: waveCount(), lives: BALANCE.startingLives },
    onReady: (ready) => controller.ready(ready),
    onSubmit: (name, room) => {
      playerName = name;
      controller = new MatchController({
        url: serverUrl(`${location.hostname}:${DEFAULT_PORT}`, location.protocol === 'https:'),
        name,
        ...(room === undefined ? {} : { room }),
        autoReady: rejoin !== null,
        hooks: {
          onLobby: (roomCode, players) => {
            currentRoom = roomCode;
            opponentName = players.find((p) => p.playerId !== controller.playerId)?.name ?? 'opponent';
            lobby.showRoster(roomCode, players, controller.playerId);
          },
          onCountdown: (ms, seed) => lobby.showCountdown(ms, seed),
          onError: (reason) => lobby.showError(reason),
          onPeer: (status) => raceHud?.peer(status),
          onPeerConn: (connected) => raceHud?.peerConn(connected),
          onSelfConn: (connected) => raceHud?.selfConn(connected),
          onResult: (winnerId, standings, reason) => {
            showResults(mount, {
              myId: controller.playerId,
              winnerId,
              standings,
              ...(reason !== undefined ? { reason } : {}),
              onRematch: () => {
                sessionStorage.setItem('race-rejoin', JSON.stringify({ name: playerName, room: currentRoom }));
                location.reload();
              },
            });
            // Log the match to the shared channel — the webhook doubles as
            // the match ledger. Only browsers with a webhook configured post
            // (normally just the host's), so results arrive once.
            if (getWebhook() !== null) {
              void postToDiscord(
                matchReport(LEVEL01.name, currentRoom, matchSeed, winnerId, standings, reason === 'forfeit'),
              ).then((ok) => {
                const log = document.getElementById('results-log');
                if (log) log.textContent = ok ? 'match logged to Discord ✓' : "couldn't log to Discord — check the webhook";
              });
            }
          },
          boot: (seed) => {
            matchSeed = seed;
            lobby.remove();
            void startGame(mount, hudRoot, seed).then(({ world }) => {
              raceHud = createRaceHud(mount, opponentName, currentRoom);
              const bootAt = performance.now();
              const sample = (): Parameters<typeof controller.finish>[0] => ({
                wave: world.wave.clearedThrough + 1,
                lives: world.lives,
                elapsedMs: Math.round(performance.now() - bootAt),
                ...(document.hidden ? { hidden: true } : {}),
              });
              controller.startStatusPump(() => {
                const status = sample();
                raceHud?.own(status);
                // Defeat or full clear alike: report final figures once and
                // let the server settle the match when both runs are over.
                if (world.phase !== 'playing') controller.finish(status);
                return status;
              });
              // The pump is throttled in hidden tabs, so tell the opponent
              // immediately that our sim froze (and when it thawed).
              document.addEventListener('visibilitychange', () =>
                controller.client.send({ t: 'status', ...sample() }),
              );
            });
          },
        },
      });
      void controller.run();
    },
  });
}

/**
 * The single-player front door.
 *
 * Three entries, and the order matters. `?level=` plays a named campaign level;
 * `?seed=` alone still means "level 1 on this seed", which is what the plan
 * documented and what the fairness gate and every bug report already use — a
 * front door is not a reason to break a URL that works. Anything else opens the
 * menu.
 *
 * Navigation between levels goes through the URL rather than tearing the game
 * down in place, for the reason `restart` already reloads: a reload rebuilds the
 * world and every renderer pool with no chance of a stale reference surviving,
 * and it makes each run linkable for free.
 */
async function startSinglePlayer(
  mount: HTMLElement,
  hudRoot: HTMLElement,
  params: URLSearchParams,
): Promise<void> {
  const named = params.get('level');
  const level = named !== null ? levelById(named) : params.has('seed') ? CAMPAIGN[0] : undefined;

  if (level === undefined) {
    createMenuScreen(mount, {
      onLaunch: (chosen, difficulty, seed) => {
        location.search = runQuery(chosen, difficulty, seed);
      },
      onRace: () => {
        location.search = '?race';
      },
    });
    return;
  }

  const raw = params.get('difficulty');
  const difficulty: DifficultyId =
    raw !== null && Object.hasOwn(DIFFICULTIES, raw) ? (raw as DifficultyId) : DEFAULT_DIFFICULTY;

  const index = levelIndex(level.id);
  const nextLevel = CAMPAIGN[index + 1];

  await startGame(mount, hudRoot, resolveSeed(), {
    level,
    rules: resolveRules(level, difficulty),
    campaign: {
      nextName: nextLevel?.name ?? null,
      menu: () => {
        location.search = '';
      },
      next: () => {
        // Carrying the difficulty and dropping the seed is the useful default:
        // the next sector should be as hard as the last one, on a fresh board.
        if (nextLevel !== undefined) location.search = runQuery(nextLevel, difficulty, '');
      },
    },
    onEnd: (w) => {
      recordRun(
        level.id,
        difficulty,
        {
          grade: grade(w),
          lives: w.lives,
          startingLives: w.rules.startingLives,
          seconds: w.time,
          waves: w.wave.clearedThrough + 1,
        },
        w.phase === 'won',
      );
    },
  });
}

function runQuery(level: LevelDef, difficulty: DifficultyId, seed: string): string {
  const q = new URLSearchParams({ level: level.id, difficulty });
  if (seed !== '') q.set('seed', seed);
  return `?${q.toString()}`;
}

interface StartOptions {
  level?: LevelDef;
  rules?: Rules;
  campaign?: CampaignPorts;
  /** Fired once, the first frame the run is no longer playing. */
  onEnd?: (w: World) => void;
}

async function startGame(
  mount: HTMLElement,
  hudRoot: HTMLElement,
  seed: number,
  opts: StartOptions = {},
): Promise<{ world: World }> {
  // Race mode passes neither, and gets the baseline game it has always played.
  const map = parseMap(opts.level?.map ?? LEVEL01);
  const rules = opts.rules ?? DEFAULT_RULES;
  const world = createWorld(map, seed, rules);
  const ui = createUiState();

  const boardW = tilesToPx(map.cols);
  const boardH = tilesToPx(map.rows);
  const { app, layers } = await createRenderer(mount, boardW, boardH);

  const textures = createTextures(app.renderer);
  layers.map.addChild(buildMapLayer(map, textures));

  const view = new WorldView(layers, textures);
  const overlay = new Overlay(layers, textures);
  const effects = new Effects(layers, boardW, boardH);

  function togglePause(): void {
    ui.paused = !ui.paused;
    loop.paused = ui.paused;
  }

  const hud = createHud(hudRoot, {
    world,
    ui,
    dispatch: (cmd) => world.commands.push(cmd),
    speed: {
      get: () => loop.speed,
      set: (v) => {
        loop.speed = v;
      },
    },
    togglePause,
    // A full reload is the honest restart: it re-runs seed resolution, rebuilds
    // the world and resets every renderer pool, with no chance of a stale
    // reference surviving into the new run. Cheap, and impossible to get wrong.
    restart: () => {
      location.reload();
    },
    ...(opts.campaign === undefined ? {} : { campaign: opts.campaign }),
  });

  // main.ts is the only place that knows about both halves. The sim has no
  // reference to the view; the view only ever reads the world.
  let hudDue = 0;
  let lastRenderMs = performance.now();
  let ended = false;

  const loop = createLoop(world, () => {
    const now = performance.now();
    // Wall-clock delta, clamped: effects decay at the same rate at 1x and 4x,
    // and a backgrounded tab must not fast-forward them on return.
    const dt = Math.min(0.1, (now - lastRenderMs) / 1000);
    lastRenderMs = now;

    // One drain, three consumers. Whichever ran first would otherwise starve
    // the others, which is exactly the bug that made the HUD miss wave clears.
    effects.beginFrame();
    for (const ev of world.events) {
      view.onEvent(ev);
      effects.onEvent(ev, ui.prefs);
      hud.onEvent(ev);
    }
    world.events.length = 0;

    view.sync(world, dt);
    overlay.sync(world, ui.selected, ui.hover, ui.inspecting);
    effects.update(world, dt, ui.prefs);

    if (now >= hudDue) {
      hud.update();
      hudDue = now + HUD_INTERVAL_MS;
    }

    // Once, on the frame the run settles. Reading it here rather than polling
    // means the record is written from the same world state the victory card is
    // about to describe, so the two can never disagree.
    if (!ended && world.phase !== 'playing') {
      ended = true;
      opts.onEnd?.(world);
    }

    app.render();
  });

  attachInput(app, world, ui, togglePause);
  loop.start();

  console.info(
    `[td] "${map.name}" ${map.cols}x${map.rows}, ` +
      `${map.waypoints.length} waypoints, ${map.pathLength} tiles of path — ` +
      `seed ${formatSeed(seed)} (${seed})`,
  );

  // Dev-only console handle. Stripped from production builds by the constant
  // folding on import.meta.env.DEV. Being able to poke at `td.world` and
  // `td.loop.speed` from devtools is worth far more here than in a typical app,
  // because the interesting bugs are all "what is the sim actually doing".
  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>)['td'] = {
      world, loop, view, overlay, effects, ui, map, app, layers,
      // The N2 fairness gate: run this in two tabs of the same room and diff.
      // Byte-identical or the race is not fair.
      dumpWaves: (n = 20) =>
        JSON.stringify(Array.from({ length: n }, (_, i) => planWave(world.seed, i, world.rules))),
    };
  }

  // Race mode reads the world for the status pump; single player ignores this.
  return { world };
}

main().catch((err: unknown) => {
  console.error('[td] failed to start', err);
});
