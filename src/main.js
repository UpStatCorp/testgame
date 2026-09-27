import { Game } from './core/Game.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const fill = document.getElementById('loading-fill');
const text = document.getElementById('loading-text');

const game = new Game(canvas);
window.game = game; // handy for debugging from the console

game
  .init((p, t) => {
    fill.style.width = `${Math.round(p * 100)}%`;
    text.textContent = t;
  })
  .then(() => {
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 900);
  })
  .catch((err) => {
    console.error(err);
    text.textContent = `Ошибка загрузки: ${err.message}`;
  });
