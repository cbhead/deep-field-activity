import { createRenderer } from './render/pixiApp.ts';
import { createTextures } from './render/textures.ts';
import { buildMapLayer } from './render/mapLayer.ts';
import { WorldView } from './render/worldView.ts';
import { Overlay } from './render/overlay.ts';
import { Effects } from './render/effects.ts';
import { TowerChrome } from './render/towerChrome.ts';
import { CreepChrome } from './render/creepChrome.ts';
import { tilesToPx } from './render/constants.ts';
import { applyHudTheme, fieldFor, DEFAULT_FIELD } from './render/theme.ts';
import { AudioEngine } from './audio/engine.ts';
import { Soundscape } from './audio/soundscape.ts';
import {
  RACE_LEAD_CHANGE,
  RACE_OPPONENT_WAVE,
  RACE_START,
  SORTIE_INBOUND,
} from './audio/palette.ts';
import { LEVEL01 } from './content/maps/level01.ts';
import { CAMPAIGN, VERSUS_LEVEL, levelById, levelIndex, type LevelDef } from './content/levels.ts';
import type { SortieId } from './content/sorties.ts';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, type DifficultyId } from './content/difficulty.ts';
import { parseMap } from './sim/util/grid.ts';
import { hashSeed, formatSeed } from './sim/util/rng.ts';
import { DEFAULT_RULES, resolveRules, versusRules, type Rules } from './sim/rules.ts';
import { createWorld, type World } from './sim/world.ts';
import type { SimEvent } from './sim/types.ts';
import { grade } from './sim/analysis.ts';
import { visualTier } from './sim/build.ts';
import { recordRun } from './app/progress.ts';
import { createRouter, type Route, type Router } from './app/router.ts';
import { connectActivity, inActivity, type ActivitySession } from './discord/activity.ts';
import { createMenuScreen } from './ui/menuScreen.ts';
import { createHomeScreen } from './ui/homeScreen.ts';
import { trackKeyboardInset } from './ui/viewport.ts';
import { createLoop } from './app/loop.ts';
import { attachInput } from './app/input.ts';
import { createUiState } from './app/uiState.ts';
import { createHud, type CampaignPorts } from './ui/hud.ts';
import { planWave } from './sim/wavePlan.ts';
import { serverUrl } from './net/NetClient.ts';
import { relayHost } from './net/relay.ts';
import { MatchController } from './net/MatchController.ts';
import type { MatchMode } from './net/protocol.ts';
import { createLobbyScreen } from './ui/lobbyScreen.ts';
import { createRaceHud, type RaceCues, type RaceHud } from './ui/raceHud.ts';
import { showResults } from './ui/resultsScreen.ts';
import { recordSeries, formatSeries } from './app/raceSeries.ts';

/**
 * The match seed comes from the URL so any run is reproducible: `?seed=hunter2`
 * turns "reproduce that bug" and "race the same board again" into free features.
 * In Race mode the server supplies this instead.
 *
 * Takes the raw parameter rather than reading `location` itself, because it is
 * now resolved once per *mount* rather than once per page load — which is what
 * makes restart deal a new board when no seed is pinned, exactly as the reload
 * it replaces did.
 */
function resolveSeed(raw: string | null): number {
  if (raw === null || raw === '') {
    // Presentation-layer randomness, so Math.random is correct here.
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  const asInt = Number(raw);
  return Number.isInteger(asInt) && asInt >= 0 ? asInt >>> 0 : hashSeed(raw);
}

/**
 * Solo versus: your own sorties come straight back at you.
 *
 * The sim is deliberately blind to who is on the other end — `sortie` charges
 * a world and `inbound` spawns on one, and nothing in `sim/` knows whether
 * those are the same world. That is what makes this three lines: feed the
 * launch event back in as an arrival, and feed the landing back as a credit.
 *
 * It is a **balance harness, not a stub**. Playing both sides is how the sortie
 * economy gets tuned before any of the wire exists: every figure that matters —
 * what a send costs, what the defender earns for killing it, what it pays back
 * when it lands — is exercised exactly as it will be in a real match. The one
 * thing it cannot show is the tension of not knowing what is coming, and no
 * amount of local wiring would.
 *
 * V7 replaces this function with the relay and deletes nothing else.
 */
function localSortieRelay(world: World): (ev: SimEvent) => void {
  return (ev) => {
    if (ev.type === 'sortieLaunched') {
      world.commands.push({
        type: 'inbound',
        sortie: ev.sortie,
        lane: ev.lane,
        kickback: ev.kickback,
      });
    } else if (ev.type === 'sortieLanded') {
      world.commands.push({ type: 'creditSortie', amount: ev.kickback });
    }
  };
}

/** The HUD is text; 10Hz is indistinguishable from 60 and does a sixth the work. */
const HUD_INTERVAL_MS = 100;

// Before main(), not inside it: main is async and the stylesheet resolves every
// colour through these properties, so deferring them to the first await would
// paint an unstyled HUD.
applyHudTheme();

// Publishes --kb so a screen can pad itself clear of the on-screen keyboard.
// Cheap, idempotent, and needed before the first screen paints.
trackKeyboardInset();

/** A mounted screen or run, and how to take it down again. */
interface Scene {
  dispose(): void;
}

interface SceneDeps {
  mount: HTMLElement;
  hudRoot: HTMLElement;
  screens: HTMLElement;
  router: Router;
}

/**
 * A rematch's rejoin details, handed from the results card to the lobby that
 * replaces it.
 *
 * Deliberately not part of the Route: this is transient intent, not an address,
 * and `?race=ABCD` already means "join that room" without also meaning "and
 * skip the form". It travelled through sessionStorage before because the
 * rematch reloaded the document and nothing else survived; the scene swap now
 * happens in memory, so a module-level handoff is the entire mechanism.
 * Claimed exactly once, so a later visit to the lobby shows the form as normal.
 */
let pendingRejoin: { name: string; room: string } | null = null;

/**
 * The Discord session, once established. Null on every ordinary page load, and
 * also inside Discord if the handshake failed — see `openActivity`.
 */
let activity: ActivitySession | null = null;

/**
 * Complete the Discord handshake, if there is one to complete.
 *
 * Deliberately not fatal. Deep Field is a working game on a plain URL and the
 * failure this guards against — no client id, a relay with no secret, a
 * rejected code — costs the player a pre-filled name, not a game. Failing hard
 * here would turn a misconfigured Activity into a black screen instead of a
 * playable one, so it is loud in the console and silent on screen.
 *
 * Awaited before the first route mounts, because the lobby reads the saved name
 * as it renders and a name that arrives afterwards would not be seen.
 */
async function openActivity(): Promise<void> {
  if (!inActivity()) return;
  try {
    activity = await connectActivity();
    if (activity === null) return;
    console.info(`[td] Discord activity: ${activity.displayName} in instance ${activity.instanceId}`);
    // Seeds the saved callsign for the plain-URL lobby, which is the only place
    // a name is still typed. Inside an Activity the lobby does not ask at all —
    // it is handed this session and uses the display name directly — so this
    // only matters if the same browser later opens the game outside Discord.
    if (localStorage.getItem('race-name') === null) {
      localStorage.setItem('race-name', activity.displayName);
    }
  } catch (err) {
    console.error('[td] Discord handshake failed — playing on without it', err);
  }
}

async function main(): Promise<void> {
  const mount = document.getElementById('game-root');
  const hudRoot = document.getElementById('hud');
  // Full-viewport screens mount here, not on `mount`: #game-root is the board's
  // scaled box. See the comment on #screens in index.html.
  const screens = document.getElementById('screens');
  if (!mount || !hudRoot || !screens) {
    throw new Error('#game-root, #hud or #screens missing from index.html');
  }

  await openActivity();

  let scene: Scene | null = null;
  /**
   * Bumped on every navigation, so a mount that loses a race discards itself.
   * `startGame` awaits the renderer's async init, which is comfortably long
   * enough for a second navigation to land on a slow machine — and without
   * this the loser would install itself over the winner, becoming unreachable
   * but still running.
   */
  let generation = 0;

  const show = async (route: Route): Promise<void> => {
    const mine = ++generation;
    scene?.dispose();
    scene = null;
    // Backstop, not the mechanism: screens remove their own markup, but a scene
    // that threw partway through mounting may not have, and the results card
    // has never had a remove() of its own.
    screens.replaceChildren();

    const next = await mountRoute(route, { mount, hudRoot, screens, router });
    if (mine !== generation) {
      next.dispose();
      return;
    }
    scene = next;
  };

  const router = createRouter((route) => {
    void show(route).catch((err: unknown) => {
      console.error(`[td] could not mount ${route.k}`, err);
    });
  });

  // Dev-only, and app-level rather than per-run: `td` comes and goes with the
  // world, but the router outlives every scene. `tdApp.router.go({k:'home'})`
  // from devtools is the quickest way to reproduce a navigation bug, and it is
  // how tools/teardown.ts drives the navigation gate without clicking through
  // screens whose markup it would then be coupled to.
  if (import.meta.env.DEV) {
    // `activity` is null on an ordinary page load and populated inside Discord;
    // having it here is how "did the handshake actually run" is answered
    // without a debugger, and what tools/proxy.ts asserts against.
    (globalThis as Record<string, unknown>)['tdApp'] = { router, activity };
  }

  /**
   * The front door, inside Discord as everywhere else.
   *
   * This used to redirect straight into the Race lobby. The reason was real:
   * Discord's launch parameters are none that the router owns, so the query
   * parsed as `home` and everyone who launched together landed on a screen that
   * offered a single-player campaign and said nothing about the people they
   * opened it with. Nobody starts an activity in a voice channel to play alone.
   *
   * What changed is the front door, not that argument. It now carries Race and
   * Versus as first-class cards, so the multiplayer modes are on the landing
   * screen rather than one unmarked click from it — and there are two of them,
   * which is what makes the redirect actively wrong. Sending everyone to Race
   * picks one of the two games on their behalf, and Versus becomes reachable
   * only by going somewhere in order to leave it again.
   *
   * So the router simply starts where the URL says, which inside an Activity is
   * `home`. The screen knows where it is — see `createHomeScreen`'s `channel` —
   * and says "this channel's race" rather than "invite a friend".
   */
  router.start();
}

function mountRoute(route: Route, deps: SceneDeps): Promise<Scene> {
  switch (route.k) {
    case 'home':
      return Promise.resolve(mountHome(deps));
    case 'sectors':
      return Promise.resolve(mountSectors(deps));
    case 'run':
      return mountRun(route, deps);
    case 'race':
      return mountRace(route, deps);
  }
}

/**
 * The front door. It sits ahead of the picker so booting no longer lands on a
 * file dialog, and Continue is a shortcut rather than a gate.
 *
 * Campaign now pushes `?sectors` instead of swapping the picker in silently.
 * The picker was always a linkable place; giving it a history entry is what
 * makes Back mean "the front door" rather than "leave the game".
 */
function mountHome({ screens, router }: SceneDeps): Scene {
  const home = createHomeScreen(screens, {
    // Where the page is, not who is signed in — the same question `main` asks.
    // A failed handshake still means the two seats are filled by whoever is in
    // the channel, so the cards should still say so; it costs a name, not a room.
    channel: inActivity(),
    onPlay: (chosen, difficulty) =>
      router.go({ k: 'run', level: chosen.id, difficulty, seed: null, bank: null }),
    onCampaign: () => router.go({ k: 'sectors' }),
    onRace: () => router.go({ k: 'race', room: null, mode: 'race' }),
    onVersus: () => router.go({ k: 'race', room: null, mode: 'versus' }),
    // Erasing progress rebuilds this same screen from the now-empty record,
    // rather than reloading the document to achieve the same thing.
    onReset: () => router.remount(),
  });
  return { dispose: () => home.destroy() };
}

function mountSectors({ screens, router }: SceneDeps): Scene {
  const menu = createMenuScreen(screens, {
    onLaunch: (chosen, difficulty, seed) =>
      router.go({ k: 'run', level: chosen.id, difficulty, seed: seed === '' ? null : seed, bank: null }),
    onRace: () => router.go({ k: 'race', room: null, mode: 'race' }),
    onBack: () => router.go({ k: 'home' }),
  });
  return { dispose: () => menu.remove() };
}

async function mountRun(
  route: Extract<Route, { k: 'run' }>,
  { mount, hudRoot, router }: SceneDeps,
): Promise<Scene> {
  // parseRoute already sent an unknown level to the menu, so this only defends
  // against CAMPAIGN changing underneath a URL somebody kept.
  const level = levelById(route.level) ?? CAMPAIGN[0]!;

  // Front Line is not a sector: it has no place in the unlock chain, cannot be
  // cleared, and must not write campaign progress. `?level=versus` reaches it
  // because `levelById` resolves it, and this is where that stops being a
  // campaign run — without it `levelIndex` returns -1, `CAMPAIGN[0]` becomes
  // the "next sector", and a board that can only be lost would be offering to
  // advance to Switchback.
  //
  // Solo, it is the balance harness: `startGame` falls back to the local
  // loopback, so you play both sides of the sortie economy on one screen. The
  // networked version of this board is `?versus`, which goes through mountRace.
  const isVersus = level.id === VERSUS_LEVEL.id;
  const nextLevel = isVersus ? undefined : CAMPAIGN[levelIndex(level.id) + 1];

  // Set when the run settles, read by `next`. The victory card is the only way
  // to reach `next`, and it cannot be shown before `onEnd` has fired, so this
  // is always populated by the time it is used.
  let finalMoney = 0;

  const { dispose } = await startGame(mount, hudRoot, resolveSeed(route.seed), {
    level,
    rules: isVersus
      ? versusRules(level, route.difficulty)
      : resolveRules(level, route.difficulty, route.bank ?? undefined),
    // Re-enter the same route rather than reloading the document. With no
    // `?seed=` pinned that resolves a fresh board, which is exactly what the
    // reload bought — see Router.remount.
    restart: () => router.remount(),
    campaign: {
      nextName: nextLevel?.name ?? null,
      menu: () => router.go({ k: 'home' }),
      next: () => {
        // Carrying the difficulty and dropping the seed is the useful default:
        // the next sector should be as hard as the last one, on a fresh board.
        // The bank travels with it — that is what makes the campaign a run.
        if (nextLevel !== undefined) {
          router.go({
            k: 'run',
            level: nextLevel.id,
            difficulty: route.difficulty,
            seed: null,
            bank: finalMoney,
          });
        }
      },
    },
    onEnd: (w) => {
      finalMoney = Math.floor(w.money);
      // A versus run is not a sector result. Recording it would put a board
      // with no win state into the progress store, where Continue reads from.
      if (isVersus) return;
      recordRun(
        level.id,
        route.difficulty,
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

  return { dispose };
}

/**
 * The lobby, and the match it turns into.
 *
 * One scene rather than two, because the match is not addressable: there is no
 * URL for "mid-race", the server decides when it starts, and a reload during
 * one has always meant rejoining through the lobby. So the route stays `?race`
 * throughout and this scene owns everything the mode builds.
 */
function mountRace(
  route: Extract<Route, { k: 'race' }>,
  { mount, hudRoot, screens, router }: SceneDeps,
): Promise<Scene> {
  // Derived in one place — net/relay.ts — because the front door probes the
  // same relay this dials, and a probe aimed at a different port from the
  // socket is worse than no probe at all.
  const host = relayHost();

  /**
   * What we *asked* to play, from the address. Sent on the join, and it decides
   * the game only when this client is the one creating the room.
   *
   * Not the same question as what the room is playing — see `matchMode`. Joining
   * `?race=ABCD` when ABCD is a versus room gets you versus, because the room
   * already existed and had already decided.
   */
  const joinMode = route.mode;

  /**
   * What the room is actually playing, as last told by the server.
   *
   * This is the one the game boots from. It cannot be read off our own URL any
   * more: inside an Activity everyone arrives at the same address and seat one
   * chooses the game from inside the lobby, so the URL says nothing about what
   * is being played. `start` carries it, and that is what `boot` receives.
   */
  let matchMode: MatchMode = joinMode;

  let controller: MatchController | null = null;
  let raceHud: RaceHud | null = null;
  let run: { dispose(): void } | null = null;
  let onVisibility: (() => void) | null = null;
  /** Set by dispose, read by the async boot that may still be in flight. */
  let disposed = false;

  let opponentName = 'opponent';
  let currentRoom = '';
  let playerName = '';
  let matchSeed = 0;
  let matchSector = CAMPAIGN[0]!.name;
  // Serialized last-sent tower layout; '' forces a resend (fresh boot, or a
  // reconnect where the opponent may have missed frames).
  let sentPins = '';
  // The booted world, once there is one. Inbound sorties arrive on the socket
  // and have to reach it, and the socket is wired before the world exists.
  let liveWorld: World | null = null;

  const rejoin = pendingRejoin;
  pendingRejoin = null;

  // Leaving a room you joined by code should return to a lobby that is not
  // still holding that code, so it navigates; leaving one you created is
  // already at `?race` and only needs re-entering.
  const leave = (): void => {
    // Inside an Activity there is no other lobby to fall back to — the instance
    // is the only room there is — so `remount()` re-entered the very screen the
    // player was trying to leave, and Leave did nothing at all. It means "back
    // to the front door" here, which is now also where the launch lands, so
    // leaving returns you to the screen you came from rather than to one you
    // had never seen.
    if (inActivity()) router.go({ k: 'home' });
    else if (route.room === null) router.remount();
    // The room's game, not the URL's: if seat one switched us to Versus, the
    // lobby you land back in should be the one you were just in.
    else router.go({ k: 'race', room: null, mode: matchMode });
  };

  const lobby = createLobbyScreen(screens, {
    // Inside Discord, identity wins over everything: there is no name to ask
    // for and the instance replaces both the room code and the rematch's
    // remembered room, since re-entering the channel's race *is* the rematch.
    ...(activity !== null
      ? { identity: { name: activity.displayName, instance: activity.instanceId } }
      : rejoin !== null
        ? { autoJoin: rejoin }
        : route.room !== null
          ? { prefillRoom: route.room }
          : {}),
    relayHost: host,
    mode: joinMode,
    onLeave: leave,
    onReady: (ready) => controller?.ready(ready),
    onPick: (level, diff, mode) => controller?.pick(level, diff, mode),
    onSubmit: ({ name, room, instance, choice }) => {
      playerName = name;
      const c = new MatchController({
        url: serverUrl(host, location.protocol === 'https:'),
        name,
        ...(room === undefined ? {} : { room }),
        ...(instance === undefined ? {} : { instance }),
        ...(choice === undefined ? {} : { choice }),
        mode: joinMode,
        autoReady: rejoin !== null,
        hooks: {
          onLobby: (roomCode, players, watchers, level, diff, mode) => {
            currentRoom = roomCode;
            // Server truth, and it can differ from what we asked for: joining an
            // existing room means playing whatever that room already decided.
            matchMode = mode;
            opponentName = players.find((p) => p.playerId !== c.playerId)?.name ?? 'opponent';
            // Seated or watching is decided by one thing — whether the roster
            // has us in it. Being promoted out of the queue therefore needs no
            // message of its own: the next broadcast simply lists us elsewhere,
            // and this switches screens.
            if (players.some((p) => p.playerId === c.playerId)) {
              lobby.showRoster(roomCode, players, c.playerId, level, diff, mode);
            } else {
              lobby.showWatching(players, watchers, c.playerId, level, diff, mode);
            }
          },
          onWatchStatus: (standings) => lobby.showWatchStatus(standings),
          onCountdown: (ms, seed) => lobby.showCountdown(ms, seed),
          onError: (reason) => lobby.showError(reason),
          onPeer: (status) => raceHud?.peer(status),
          // The two hooks that make a match a match. Both push a command
          // rather than touching world state directly, so an arrival lands on
          // a tick boundary exactly like a click does — and re-validates the
          // same way, which matters because a credit can arrive after the run
          // it belongs to has already ended.
          onInbound: (sortie, lane, kickback) => {
            liveWorld?.commands.push({
              type: 'inbound',
              sortie: sortie as SortieId,
              lane,
              kickback,
            });
            raceHud?.incoming(sortie, lane);
          },
          onCredit: (amount) => {
            liveWorld?.commands.push({ type: 'creditSortie', amount });
          },
          onPeerConn: (connected) => raceHud?.peerConn(connected),
          onSelfConn: (connected) => {
            if (connected) sentPins = '';
            raceHud?.selfConn(connected);
          },
          onResult: (winnerId, standings, reason) => {
            const outcome = winnerId === null ? 't' : winnerId === c.playerId ? 'w' : 'l';
            // The sector goes in too, so the front door can say what happened
            // rather than only how the rivalry stands.
            const series = formatSeries(
              opponentName,
              recordSeries(opponentName, outcome, matchSector),
            );
            showResults(screens, {
              myId: c.playerId,
              winnerId,
              standings,
              ...(reason !== undefined ? { reason } : {}),
              sector: matchSector,
              room: currentRoom,
              seed: matchSeed,
              series,
              ...(matchMode === 'versus' ? { versus: true } : {}),
              onRematch: () => {
                pendingRejoin = { name: playerName, room: currentRoom };
                router.remount();
              },
              // The same `leave` the lobby uses, so "out of here" means one
              // thing wherever it is pressed. It was an anchor while Race was
              // the only mode, which inside an Activity is a document load and
              // costs the handshake — see ResultsOptions.onLeave.
              onLeave: leave,
            });
            // No Discord post from here any more. The relay sends the match
            // report, because a browser inside an Activity cannot reach
            // discord.com at all and because one sender means one message
            // without anyone being told to configure only one machine. See
            // net/report.ts.
          },
          boot: (seed, levelId, diffId, mode) => {
            matchSeed = seed;
            // The server's word on what is being played, not ours. Inside an
            // Activity the URL never said, and even outside one the room may
            // have been switched after we joined it — so this arrives with the
            // seed rather than being read back off `route.mode`.
            matchMode = mode;
            const bootVersus = mode === 'versus';
            // The room's pick arrives unvalidated; unknown values fall back to
            // the baseline on BOTH clients, so a version-skewed pair still
            // plays the same board. Versus ignores the pick entirely — there
            // is one board, and letting a stale lobby choice send two players
            // to different maps is a failure with no upside.
            const level = bootVersus ? VERSUS_LEVEL : (levelById(levelId) ?? CAMPAIGN[0]!);
            const difficulty: DifficultyId =
              Object.hasOwn(DIFFICULTIES, diffId) ? (diffId as DifficultyId) : DEFAULT_DIFFICULTY;
            matchSector = `${level.name} · ${DIFFICULTIES[difficulty].name}`;
            lobby.remove();
            void startGame(mount, hudRoot, seed, {
              level,
              rules: bootVersus ? versusRules(level, difficulty) : resolveRules(level, difficulty),
              restart: () => router.remount(),
              ...(bootVersus
                ? {
                    // The relay stands in for the loopback: a launch goes out
                    // over the socket instead of straight back at us, and a
                    // landing is reported so the server can pay whoever sent it.
                    sortieRelay: (ev: SimEvent) => {
                      if (ev.type === 'sortieLaunched') {
                        c.sendSortie(ev.sortie, ev.lane, ev.kickback);
                      } else if (ev.type === 'sortieLanded') {
                        c.reportLanded(ev.kickback);
                      }
                    },
                  }
                : {}),
            }).then((game) => {
              // Navigating away during the countdown or the renderer's init
              // lands here with nowhere to put a world.
              if (disposed) {
                game.dispose();
                return;
              }
              const { world, raceCues, startRaceTone } = game;
              run = game;
              liveWorld = world;
              raceHud = createRaceHud(mount, opponentName, currentRoom, world.map, raceCues);
              startRaceTone();
              const bootAt = performance.now();
              sentPins = '';
              const sample = (): Parameters<typeof c.finish>[0] => {
                const status: Parameters<typeof c.finish>[0] = {
                  wave: world.wave.clearedThrough + 1,
                  lives: world.lives,
                  elapsedMs: Math.round(performance.now() - bootAt),
                  ...(document.hidden ? { hidden: true } : {}),
                  ...(bootVersus ? { era: world.era } : {}),
                };
                // The layout rides along only when it changed — most frames
                // carry three numbers, a build frame carries the board.
                const pins = world.towers.map((t) => ({ c: t.col, r: t.row, k: t.defId, tier: visualTier(t) }));
                const enc = JSON.stringify(pins);
                if (enc !== sentPins) {
                  sentPins = enc;
                  status.towers = pins;
                }
                return status;
              };
              c.startStatusPump(() => {
                const status = sample();
                raceHud?.own(status);
                // Defeat or full clear alike: report final figures once and
                // let the server settle the match when both runs are over.
                if (world.phase !== 'playing') c.finish(status);
                return status;
              });
              // The pump is throttled in hidden tabs, so tell the opponent
              // immediately that our sim froze (and when it thawed).
              onVisibility = () => c.client.send({ t: 'status', ...sample() });
              document.addEventListener('visibilitychange', onVisibility);
            });
          },
        },
      });
      controller = c;
      void c.run();
    },
  });

  return Promise.resolve({
    dispose(): void {
      // The controller goes first: it silences the socket, cancels the
      // countdown's deferred boot and stops the reconnect loop, so nothing
      // below can be reached by a message arriving mid-teardown.
      disposed = true;
      controller?.dispose();
      if (onVisibility !== null) document.removeEventListener('visibilitychange', onVisibility);
      raceHud?.remove();
      run?.dispose();
      lobby.remove();
    },
  });
}

interface StartOptions {
  level?: LevelDef;
  rules?: Rules;
  campaign?: CampaignPorts;
  /**
   * What the HUD's restart button does. Injected rather than assumed: it used
   * to be `location.reload()`, and the whole point of the router is that there
   * is no longer a document reload to fall back on.
   */
  restart: () => void;
  /**
   * Where a launched sortie goes, and where a landing is reported.
   *
   * Absent means the local loopback — you play both sides, which is how the
   * economy gets tuned. A real match supplies the relay instead. Neither the
   * sim nor this function knows which it got, and that is the point.
   */
  sortieRelay?: (ev: SimEvent) => void;
  /** Fired once, the first frame the run is no longer playing. */
  onEnd?: (w: World) => void;
}

async function startGame(
  mount: HTMLElement,
  hudRoot: HTMLElement,
  seed: number,
  opts: StartOptions,
): Promise<{
  world: World;
  raceCues: RaceCues;
  startRaceTone: () => void;
  /** Tears the run down completely. Nothing calls this until the router does. */
  dispose: () => void;
}> {
  // Race mode passes neither, and gets the baseline game it has always played.
  const map = parseMap(opts.level?.map ?? LEVEL01);
  const rules = opts.rules ?? DEFAULT_RULES;
  const world = createWorld(map, seed, rules);
  const ui = createUiState();

  // A real match passes the relay; solo versus falls back to playing both
  // sides. Everything else is blind to which of the two it got.
  const sortieRelay = opts.sortieRelay ?? (rules.sorties ? localSortieRelay(world) : null);

  const boardW = tilesToPx(map.cols);
  const boardH = tilesToPx(map.rows);

  // Race passes no level, so it plays the baseline ground — the same one on both
  // clients, which is what keeps two screens comparable at a glance.
  const field = fieldFor(opts.level?.field);
  const renderer = await createRenderer(mount, boardW, boardH, field);
  const { app, layers } = renderer;

  const textures = createTextures(app.renderer);
  const mapLayer = buildMapLayer(map, textures, field);
  layers.map.addChild(mapLayer.view);

  const view = new WorldView(layers, textures);
  const overlay = new Overlay(layers, textures);
  const effects = new Effects(layers, boardW, boardH);
  const audio = new AudioEngine();
  // The id, not the resolved `field` — the bed is keyed by which sector this is,
  // and `SectorField` is a palette of colours with no identity of its own.
  const soundscape = new Soundscape(audio, opts.level?.field ?? DEFAULT_FIELD);
  const towerChrome = new TowerChrome(layers, field);
  const creepChrome = new CreepChrome(layers, textures);

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
    audio: {
      apply: (prefs) => {
        audio.setVolume(prefs.volume);
        audio.setMuted(prefs.muted);
      },
    },
    // Restart used to be `location.reload()` — honest, and impossible to get
    // wrong, because a reload cannot leave a stale reference behind. The router
    // re-enters the route instead, which means the guarantee now has to be
    // earned by `dispose` below rather than granted by the browser. That is
    // what tools/teardown.ts exists to check.
    restart: opts.restart,
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
    soundscape.beginFrame();
    for (const ev of world.events) {
      creepChrome.onEvent(ev);
      effects.onEvent(ev, ui.prefs);
      soundscape.onEvent(ev);
      hud.onEvent(ev);
      sortieRelay?.(ev);
    }
    world.events.length = 0;

    // Real seconds, not `dt` scaled by the speed multiplier: the current is a
    // property of the road, not of how fast the game is being run.
    if (ui.prefs.stream) mapLayer.step(1 / 60);

    view.sync(world);
    // Before the overlay reads it: if the player disarmed by any route, the
    // parked touch preview has nothing left to describe.
    input.reconcile();
    overlay.sync(world, ui.selected, ui.hover, ui.inspecting, ui.touchPreview);
    effects.update(world, dt);
    soundscape.update(world, ui.selected, dt);
    creepChrome.sync(world, dt);
    towerChrome.sync(world, ui.prefs);

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

  const input = attachInput(app, world, ui, togglePause, hudRoot);

  // Any gesture voids the 10Hz throttle: a hotkey arming a station or a click
  // opening the inspector shows on the next frame, not up to 100ms later. The
  // HUD's own buttons update synchronously in hud.ts; this covers the rest.
  //
  // It is also where the mixer comes to life. A browser refuses to start an
  // AudioContext outside a user gesture, so the game is genuinely silent until
  // the first click or keypress — correct behaviour, not a bug to route around.
  // `unlock` returns immediately once the graph exists, so this stays cheap.
  const wake = (): void => {
    hudDue = 0;
    audio.unlock();
    audio.setVolume(ui.prefs.volume);
    audio.setMuted(ui.prefs.muted);
  };
  window.addEventListener('keydown', wake);
  window.addEventListener('pointerdown', wake);

  loop.start();

  /** The dev console handle, so `dispose` can tell ours from a successor's. */
  let devHandle: unknown = null;

  /**
   * Undo everything above, in the reverse of the order it was built.
   *
   * The loop stops first because every other teardown pulls something out from
   * under a frame that might otherwise still be in flight. The renderer goes
   * last for the same reason: `view`, `overlay` and the chromes all hold
   * containers that belong to the Application it destroys.
   *
   * The baked textures are deliberately not enumerated. They were allocated by
   * this Application's WebGL context, and `renderer.dispose()` destroys that
   * context — the GPU memory goes with it. Walking the Textures record here
   * would be more code making the same thing happen.
   */
  const dispose = (): void => {
    loop.stop();
    window.removeEventListener('keydown', wake);
    window.removeEventListener('pointerdown', wake);
    input.dispose();
    hud.destroy();
    audio.dispose();
    renderer.dispose();
    // Only if it is still ours. Two runs can briefly overlap — a navigation
    // landing while another is still awaiting its renderer — and the loser
    // must not delete the winner's handle on its way out.
    if (import.meta.env.DEV) {
      const g = globalThis as Record<string, unknown>;
      if (g['td'] === devHandle) delete g['td'];
    }
  };

  console.info(
    `[td] "${map.name}" ${map.cols}x${map.rows}, ` +
      `${map.routes.length} route(s) — ${map.routes.map((r) => `${r.id} ${r.length}t`).join(', ')} — ` +
      `seed ${formatSeed(seed)} (${seed})`,
  );

  // Dev-only console handle. Stripped from production builds by the constant
  // folding on import.meta.env.DEV. Being able to poke at `td.world` and
  // `td.loop.speed` from devtools is worth far more here than in a typical app,
  // because the interesting bugs are all "what is the sim actually doing".
  if (import.meta.env.DEV) {
    devHandle = {
      world, loop, view, overlay, effects, ui, map, app, layers,
      // Exposed so teardown is testable from outside the app: `td.dispose()`
      // in devtools should leave no canvas, no listeners and no <html> classes
      // behind. tools/teardown.ts asserts exactly that.
      dispose,
      // `td.input.tapMs = 200` on the device itself: how long a press must last
      // before releasing it buys the station. The one number here that can only
      // really be judged with a thumb.
      input,
      // The N2 fairness gate: run this in two tabs of the same room and diff.
      // Byte-identical or the race is not fair.
      dumpWaves: (n = 20) =>
        JSON.stringify(
          Array.from({ length: n }, (_, i) => planWave(world.seed, i, world.rules, world.map.routes)),
        ),
      // Auditioning the mix without playing a match out. `td.soundscape.audition
      // ('lance')` for one sound, and `td.soundscape.stress('lance', 120)` for
      // the question that actually matters — what happens at a rate no board can
      // reach — which is the one thing a real playthrough cannot be made to show
      // on demand.
      audio,
      soundscape,
    };
    (globalThis as Record<string, unknown>)['td'] = devHandle;
  }

  // Race mode reads the world for the status pump; single player ignores this.
  // The cues ride along rather than being rebuilt at the call site, so the one
  // place that owns the mixer is still the one place that reaches into it.
  return {
    world,
    dispose,
    raceCues: {
      opponentWave: () => void audio.play(RACE_OPPONENT_WAVE),
      leadChange: () => void audio.play(RACE_LEAD_CHANGE),
      sortieInbound: () => void audio.play(SORTIE_INBOUND),
    },
    startRaceTone: () => void audio.play(RACE_START),
  };
}

main().catch((err: unknown) => {
  console.error('[td] failed to start', err);
});
