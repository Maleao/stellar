import { normalizeSeed } from './core/rng';
import { installDebugApi } from './debug';
import { Game } from './game';
import { InputManager } from './input/input';
import { Renderer } from './render/renderer';
import { AudioManager } from './services/audio';
import { PersistenceService } from './services/persistence';
import { UI } from './ui/ui';

function boot(): void {
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game ausente');

  const ui = new UI();
  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    ui.showFatal('Seu navegador não suporta Canvas 2D, necessário para o jogo.');
    console.error(err);
    return;
  }
  const persistence = PersistenceService.forBrowser();
  const audio = new AudioManager();
  const input = new InputManager(canvas);
  const game = new Game({ persistence, audio, ui, renderer, input, initialSeed: normalizeSeed(params.get('seed') ?? '') });

  window.addEventListener('error', (e) => {
    if (e.error) game.fail(e.error);
  });
  window.addEventListener('unhandledrejection', (e) => console.error('[Estilingue Estelar] promessa rejeitada', e.reason));

  game.init();
  if (params.get('debug') === '1') installDebugApi(game, persistence, audio);
}

boot();
