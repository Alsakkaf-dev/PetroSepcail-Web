/* ============================================================
   PetroSpecial — بتروسبيشل · main.js
   Single shared script: i18n engine, header, motion, widgets, forms
   ============================================================ */
"use strict";

const PS = {
  qs: (sel, root = document) => root.querySelector(sel),
  qsa: (sel, root = document) => Array.from(root.querySelectorAll(sel)),
  store: {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* private mode */ } }
  },
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  /* Filled by the backend config block once the message system is provisioned */
  CONTACT: null
};
