import { findRelease } from './core/bot';
import type { Game } from './game';
import type { AudioManager } from './services/audio';
import type { PersistenceService } from './services/persistence';

/**
 * API de diagnóstico e testes automatizados. Instalada SOMENTE com ?debug=1 na URL.
 * Permite congelar o relógio e avançar ticks de forma determinística; as entradas continuam
 * passando pelo pipeline real (teclado/ponteiro → InputManager → simulação).
 */
export function installDebugApi(game: Game, persistence: PersistenceService, audio: AudioManager): void {
  const api = {
    snapshot() {
      const r = game.run;
      return {
        phase: game.phase,
        runId: game.runId,
        runCount: game.runCount,
        mode: game.mode,
        seed: r?.seed ?? null,
        tick: r?.tick ?? 0,
        depth: r?.depth ?? 0,
        score: r?.score ?? 0,
        combo: r?.combo ?? 1,
        player: r?.player.kind ?? null,
        ended: r?.ended ?? null,
        stats: r ? { ...r.stats } : null,
        frozen: game.isFrozen,
        storage: persistence.status,
        profile: persistence.profile,
        lastResult: game.lastResult,
        listeners: game.listenerCount,
        audio: audio.state,
      };
    },
    freeze(on = true) {
      game.setFrozen(on);
    },
    advance(ticks: number) {
      game.advanceTicks(Math.max(0, Math.floor(ticks)));
    },
    /** Plano do bot para a partida atual (ou null). Não altera o estado. */
    botPlan(strategy: 'first' | 'best' = 'first') {
      return game.run ? findRelease(game.run, { strategy, stride: 1 }) : null;
    },
    perf() {
      return game.perfStats();
    },
    resetPerf() {
      game.resetPerf();
    },
  };
  (window as unknown as { __stellar: typeof api }).__stellar = api;
}

