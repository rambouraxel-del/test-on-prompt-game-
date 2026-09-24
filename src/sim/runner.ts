import { TIME } from '../config/balance';
import type { Game } from './world';

/** Boucle à pas fixe indépendante de la fréquence d'affichage. */
export class Runner {
  acc = 0;
  speed = 1;
  paused = false;
  constructor(public game: Game) {}

  /** Avance selon le temps réel écoulé (secondes). Renvoie le nombre de pas exécutés. */
  advance(realDt: number): number {
    if (this.paused || this.speed <= 0) return 0;
    // Plafond : jamais plus de 0,25 s réel rattrapé d'un coup (onglet lent, pause du navigateur…).
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= TIME.FIXED_DT - 1e-9 && steps < TIME.MAX_STEPS_PER_FRAME) {
      this.game.step();
      this.acc -= TIME.FIXED_DT;
      steps++;
    }
    if (steps >= TIME.MAX_STEPS_PER_FRAME) this.acc = 0;
    return steps;
  }

  get alpha(): number {
    return Math.max(0, Math.min(1, this.acc / TIME.FIXED_DT));
  }

  reset() {
    this.acc = 0;
  }
}
