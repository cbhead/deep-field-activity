import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // docs/design holds the vendored Claude Design spec and the generated runtime
  // it needs to render. It is documentation — never built, never imported — and
  // linting a third-party bundle produces nothing but noise.
  { ignores: ['dist/**', 'node_modules/**', 'docs/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // ---------------------------------------------------------------------------
  // THE ARCHITECTURAL BOUNDARY.
  //
  // src/sim and src/content are a PURE simulation: no renderer, no DOM, no
  // wall-clock time, no unseeded randomness. This is what makes the game
  // testable headlessly, reproducible from a seed, and fair across two machines
  // in Race mode. It is cheap to hold now and expensive to retrofit later.
  // ---------------------------------------------------------------------------
  {
    files: ['src/sim/**/*.ts', 'src/content/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['pixi.js', '@pixi/*'], message: 'The simulation must not import a renderer.' },
          { group: ['**/render/**', '**/ui/**', '**/app/**', '**/net/**'],
            message: 'The simulation must not depend on presentation, input, or networking.' },
        ],
      }],

      // Keeps the sim runnable in Node for the headless balance harness.
      'no-restricted-globals': ['error',
        { name: 'window', message: 'Not available headlessly. Keep the sim pure.' },
        { name: 'document', message: 'Not available headlessly. Keep the sim pure.' },
        { name: 'performance', message: 'The sim advances by fixed DT, never wall-clock time.' },
        { name: 'requestAnimationFrame', message: 'The loop drives the sim, not the other way round.' },
        { name: 'process', message: 'The sim must behave identically in Node and the browser.' },
      ],

      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random',
          message: 'Use the seeded rng (src/sim/util/rng.ts). Math.random breaks Race-mode fairness.' },
        { object: 'Date', property: 'now',
          message: 'The sim advances by fixed DT. Use world.time.' },
      ],
    },
  },

  // The renderer is the one place unseeded randomness is REQUIRED: VFX jitter
  // must never draw from the sim's RNG stream, or a dropped frame on one
  // machine would diverge the other player's waves.
  //
  // src/audio is presentation on exactly the same terms and gets the same rule:
  // it reads world state and drains the same events, and its per-shot pitch and
  // gain jitter must never touch the seeded stream either.
  {
    files: ['src/render/**/*.ts', 'src/ui/**/*.ts', 'src/audio/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/sim/systems/**'],
            message: 'Presentation reads world state and types, not simulation systems.' },
        ],
      }],
    },
  },
);
