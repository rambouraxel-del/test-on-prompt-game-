import './styles.css';
import { App } from './ui/app';

const app = new App();
// Accès de débogage et d'automatisation des tests (lecture seule conseillée).
(window as unknown as { __app: App }).__app = app;
