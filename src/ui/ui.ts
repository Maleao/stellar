import { CONFIG, type GameMode } from '../core/config';
import { sectorOf } from '../core/difficulty';
import type { Phase } from '../core/phase';
import {
  ACHIEVEMENTS,
  isInfiniteUnlocked,
  isTrailUnlocked,
  type AchievementDef,
  type Profile,
  type RunSummary,
  type Settings,
  TRAILS,
  type TrailId,
} from '../core/progression';
import type { DeathCause } from '../core/types';
import { TRAIL_COLORS } from '../render/palette';
import type { StorageStatus } from '../services/persistence';

export type UiAction =
  | 'play'
  | 'play-infinite'
  | 'pause'
  | 'resume'
  | 'restart'
  | 'menu'
  | 'play-again'
  | 'same-seed'
  | 'settings'
  | 'achievements'
  | 'help'
  | 'close-modal'
  | 'replay-tutorial'
  | 'reset-progress';

export type ModalId = 'settings' | 'achievements' | 'help';

const CAUSE_TEXT: Record<DeathCause, string> = {
  core: 'Você atingiu o núcleo.',
  collapse: 'A estrela colapsou com você em órbita.',
  void: 'Você se perdeu no vazio.',
  debris: 'Um detrito interrompeu o voo.',
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} ausente`);
  return el as T;
};

const fmt = (n: number): string => Math.floor(n).toLocaleString('pt-BR');
const fmtTime = (ticks: number): string => {
  const s = Math.floor(ticks * CONFIG.TICK);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class UI {
  onAction: (a: UiAction) => void = () => undefined;
  onSettings: (patch: Partial<Settings>) => void = () => undefined;
  onTrail: (t: TrailId) => void = () => undefined;

  private readonly hud = $('hud');
  private readonly screens: Record<'menu' | 'pause' | 'results', HTMLElement> = {
    menu: $('screen-menu'),
    pause: $('screen-pause'),
    results: $('screen-results'),
  };
  private readonly modals: Record<ModalId, HTMLElement> = {
    settings: $('modal-settings'),
    achievements: $('modal-achievements'),
    help: $('modal-help'),
  };
  private openModalId: ModalId | null = null;
  private modalReturnFocus: HTMLElement | null = null;
  private hintTimer = 0;
  private lastScore = -1;
  private lastCombo = -1;
  private lastStar = '';
  private resetArmed = false;
  private readonly scoreEl = $('hud-score');
  private readonly comboEl = $('hud-combo');
  private readonly starEl = $('hud-star');
  private readonly sectorEl = $('hud-sector');
  private readonly hintEl = $('hint');
  private readonly announcer = $('announcer');

  constructor() {
    // Delegação: um único listener para todos os botões com data-action (sem duplicação).
    $('ui').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
      this.onAction(btn.dataset.action as UiAction);
    });
    $('settings-form').addEventListener('submit', (e) => e.preventDefault());
    const vol = $<HTMLInputElement>('set-volume');
    vol.addEventListener('input', () => {
      $('vol-out').textContent = `${vol.value}%`;
      this.onSettings({ masterVolume: Number(vol.value) / 100 });
    });
    $<HTMLInputElement>('set-music').addEventListener('change', (e) => this.onSettings({ music: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('set-sfx').addEventListener('change', (e) => this.onSettings({ sfx: (e.target as HTMLInputElement).checked }));
    $<HTMLSelectElement>('set-motion').addEventListener('change', (e) => this.onSettings({ motion: (e.target as HTMLSelectElement).value as Settings['motion'] }));
    $<HTMLSelectElement>('set-guide').addEventListener('change', (e) => this.onSettings({ guide: (e.target as HTMLSelectElement).value as Settings['guide'] }));
    $('trail-list').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-trail]');
      if (b && b.getAttribute('aria-disabled') !== 'true') this.onTrail(b.dataset.trail as TrailId);
    });
    // Mantém o foco dentro do modal aberto (Tab circular).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.openModalId) return;
      const focusables = [...this.modals[this.openModalId].querySelectorAll<HTMLElement>('button, input, select')].filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  get modalOpen(): ModalId | null {
    return this.openModalId;
  }

  showPhase(phase: Phase): void {
    this.screens.menu.hidden = phase !== 'MENU';
    this.screens.pause.hidden = phase !== 'PAUSED';
    this.screens.results.hidden = phase !== 'RESULTS';
    this.hud.hidden = !(phase === 'PLAYING' || phase === 'PAUSED' || phase === 'ENDING');
    if (phase !== 'PLAYING') this.hideHint();
    const focusTarget: Partial<Record<Phase, string>> = { MENU: '#screen-menu .btn-primary', PAUSED: '#screen-pause .btn-primary', RESULTS: '#screen-results .btn-primary' };
    const sel = focusTarget[phase];
    if (phase === 'PLAYING' || phase === 'ENDING') {
      // Evita que Espaço acione um botão focado durante o jogo.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } else if (sel && !this.openModalId) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }));
    }
  }

  renderMenu(p: Profile, storage: StorageStatus): void {
    const best = p.best.travessia;
    $('menu-best').textContent = best > 0 ? `Recorde: ${fmt(best)}${p.best.infinito > 0 ? ` · Infinito: ${fmt(p.best.infinito)}` : ''}` : '';
    const inf = $('btn-infinite');
    const unlocked = isInfiniteUnlocked(p);
    inf.setAttribute('aria-disabled', String(!unlocked));
    inf.textContent = unlocked ? 'Modo Infinito' : 'Modo Infinito 🔒';
    $('infinite-note').hidden = unlocked;
    const notice = $('storage-notice');
    notice.hidden = storage === 'ok';
    notice.textContent =
      storage === 'unavailable'
        ? 'O armazenamento do navegador está indisponível: o progresso desta sessão não será salvo.'
        : storage === 'future-version'
          ? 'Este progresso foi salvo por uma versão mais nova do jogo e não será alterado.'
          : '';
  }

  updateHud(score: number, combo: number, depth: number, mode: GameMode): void {
    if (score !== this.lastScore) {
      this.scoreEl.textContent = fmt(score);
      this.lastScore = score;
    }
    if (combo !== this.lastCombo) {
      this.comboEl.textContent = `×${combo}`;
      this.comboEl.classList.toggle('hot', combo >= 3 && combo < CONFIG.COMBO_MAX);
      this.comboEl.classList.toggle('blaze', combo >= CONFIG.COMBO_MAX);
      if (combo > this.lastCombo && this.lastCombo !== -1) {
        this.comboEl.classList.remove('pop');
        void this.comboEl.offsetWidth; // reinicia a animação
        this.comboEl.classList.add('pop');
      }
      this.lastCombo = combo;
    }
    const star = mode === 'travessia' ? `Estrela ${depth}/${CONFIG.FINAL_INDEX}` : `Estrela ${depth} · Infinito`;
    if (star !== this.lastStar) {
      this.starEl.textContent = star;
      this.sectorEl.textContent = `Setor ${sectorOf(depth)}`;
      this.lastStar = star;
    }
  }

  resetHud(): void {
    this.lastScore = this.lastCombo = -1;
    this.lastStar = '';
  }

  showHint(text: string, seconds = 0): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    window.clearTimeout(this.hintTimer);
    if (seconds > 0) this.hintTimer = window.setTimeout(() => this.hideHint(), seconds * 1000);
  }

  hideHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hintEl.classList.remove('show');
  }

  announce(text: string): void {
    this.announcer.textContent = '';
    requestAnimationFrame(() => (this.announcer.textContent = text));
  }

  renderResults(run: RunSummary, newRecord: boolean, newAch: AchievementDef[]): void {
    $('res-title').textContent = run.victory ? 'Travessia completa!' : 'Fim da jornada';
    $('res-cause').textContent = run.victory ? 'Você alcançou o Farol.' : run.cause ? CAUSE_TEXT[run.cause] : '';
    $('res-score').textContent = fmt(run.score);
    $('res-record').hidden = !newRecord;
    $('res-seed').textContent = String(run.seed);
    const stats: [string, string][] = [
      ['Estrela alcançada', run.mode === 'travessia' ? `${run.depth}/${CONFIG.FINAL_INDEX}` : String(run.depth)],
      ['Perfeitos', String(run.stats.perfects)],
      ['Multiplicador máximo', `×${run.stats.maxCombo}`],
      ['Fragmentos', String(run.stats.motes)],
      ['Saltos duplos', String(run.stats.skips)],
      ['Tempo', fmtTime(run.ticks)],
    ];
    const dl = $('res-stats');
    dl.replaceChildren(
      ...stats.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    const ach = $('res-ach');
    ach.hidden = newAch.length === 0;
    ach.replaceChildren();
    for (const a of newAch) {
      const p = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `Conquista: ${a.name}`;
      p.append(strong, document.createTextNode(` — ${a.description}`));
      if (a.unlocksTrail) p.append(document.createTextNode(` Rastro liberado!`));
      ach.append(p);
    }
    const parts = [run.victory ? 'Vitória!' : `Fim: ${run.cause ? CAUSE_TEXT[run.cause] : ''}`, `${fmt(run.score)} pontos.`];
    if (newRecord) parts.push('Novo recorde!');
    for (const a of newAch) parts.push(`Conquista: ${a.name}.`);
    this.announce(parts.join(' '));
  }

  openModal(id: ModalId, p: Profile): void {
    if (this.openModalId) this.closeModal();
    this.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (id === 'settings') this.fillSettings(p);
    if (id === 'achievements') this.fillAchievements(p);
    this.modals[id].hidden = false;
    this.openModalId = id;
    this.modals[id].querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
  }

  closeModal(): void {
    if (!this.openModalId) return;
    this.modals[this.openModalId].hidden = true;
    this.openModalId = null;
    this.disarmReset();
    const back = this.modalReturnFocus;
    this.modalReturnFocus = null;
    if (back && document.contains(back) && !back.closest('[hidden]')) back.focus({ preventScroll: true });
  }

  fillSettings(p: Profile): void {
    const s = p.settings;
    const vol = Math.round(s.masterVolume * 100);
    $<HTMLInputElement>('set-volume').value = String(vol);
    $('vol-out').textContent = `${vol}%`;
    $<HTMLInputElement>('set-music').checked = s.music;
    $<HTMLInputElement>('set-sfx').checked = s.sfx;
    $<HTMLSelectElement>('set-motion').value = s.motion;
    $<HTMLSelectElement>('set-guide').value = s.guide;
  }

  /** Primeiro clique arma, segundo confirma. Retorna true quando confirmado. */
  armOrConfirmReset(): boolean {
    const btn = $('btn-reset');
    if (this.resetArmed) {
      this.disarmReset();
      return true;
    }
    this.resetArmed = true;
    btn.classList.add('armed');
    btn.textContent = 'Clique de novo para confirmar';
    return false;
  }

  private disarmReset(): void {
    this.resetArmed = false;
    const btn = $('btn-reset');
    btn.classList.remove('armed');
    btn.textContent = 'Apagar progresso';
  }

  fillAchievements(p: Profile): void {
    const list = $('ach-list');
    list.replaceChildren(
      ...ACHIEVEMENTS.map((a) => {
        const done = p.achievements.includes(a.id);
        const li = document.createElement('li');
        li.className = done ? 'done' : '';
        const icon = document.createElement('span');
        icon.className = 'ach-icon';
        icon.textContent = done ? '★' : '·';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'ach-text';
        const b = document.createElement('b');
        b.textContent = a.name + (done ? '' : ' (bloqueada)');
        const small = document.createElement('small');
        const trail = a.unlocksTrail ? ` Libera o rastro ${TRAILS.find((t) => t.id === a.unlocksTrail)?.name}.` : '';
        small.textContent = a.description + trail;
        text.append(b, small);
        li.append(icon, text);
        return li;
      }),
    );
    const trails = $('trail-list');
    trails.replaceChildren(
      ...TRAILS.map((t) => {
        const unlocked = isTrailUnlocked(p, t.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-small trail-btn';
        btn.dataset.trail = t.id;
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(p.trail === t.id));
        btn.setAttribute('aria-disabled', String(!unlocked));
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = `linear-gradient(135deg, ${TRAIL_COLORS[t.id].head}, ${TRAIL_COLORS[t.id].tail})`;
        btn.append(sw, document.createTextNode(unlocked ? t.name : `${t.name} 🔒`));
        return btn;
      }),
    );
    $('totals').textContent = `Partidas: ${fmt(p.totals.runs)} · Estrelas: ${fmt(p.totals.stars)} · Perfeitos: ${fmt(p.totals.perfects)} · Fragmentos: ${fmt(p.totals.motes)} · Vitórias: ${fmt(p.totals.victories)}`;
  }

  showFatal(message: string): void {
    const el = $('fatal');
    el.textContent = message;
    el.hidden = false;
  }
}
