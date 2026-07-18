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


/* ============ Global EN dictionary (shared strings) ============
   Arabic lives inline in the HTML (the site's primary language).
   Page-specific strings are merged in from #page-i18n JSON blocks. */
PS.dict = {
  "brand.name": "PetroSpecial",
  "brand.tagline": "Saudi-made lubricants engineered to world-class standards",

  "nav.home": "Home",
  "nav.products": "Products",
  "nav.about": "About Us",
  "nav.quality": "Quality",
  "nav.distribution": "Distribution",
  "nav.contact": "Contact Us",
  "nav.aria": "Main navigation",
  "nav.menu": "Menu",

  "common.readMore": "Read the full story",
  "common.viewAll": "View all products",
  "common.browse": "Browse products",
  "common.callUs": "Call us",
  "common.contactUs": "Contact us",
  "common.details": "View details",
  "common.backHome": "Back to home",
  "common.skip": "Skip to main content",

  "trust.iso": "ISO 9001 Certified",
  "trust.api": "API SL / SN",
  "trust.saso": "SASO Standards",
  "trust.aramco": "Saudi Aramco Specs",
  "trust.saudi": "SAUDI MADE",
  "trust.virgin": "100% Virgin Base Oils",

  "cta.title": "Ready to power your engines?",
  "cta.text": "Talk to our sales team about supply for tire shops, service centers and corporate fleets across the Western Region.",
  "cta.call": "Call sales",
  "cta.form": "Send an enquiry",

  "form.name": "Full name",
  "form.email": "Email address",
  "form.phone": "Phone number",
  "form.message": "Your message",
  "form.send": "Send message",
  "form.sending": "Sending…",
  "form.success": "Thank you! Your message has been received — our team will get back to you shortly.",
  "form.error": "Something went wrong and the message was not sent. Please try again, or call us directly.",
  "form.required": "This field is required",
  "form.badEmail": "Please enter a valid email address",

  "footer.about": "A Saudi manufacturer of motor oils and lubricants in Jeddah — 100% virgin Group II & III base oils, globally certified additives, engineered for desert conditions.",
  "footer.pages": "Pages",
  "footer.products": "Product families",
  "footer.contact": "Contact",
  "footer.privacy": "Privacy Policy",
  "footer.rights": "All rights reserved.",
  "footer.cr": "Commercial Registration",
  "footer.sales": "Sales",
  "footer.support": "Customer Service",
  "footer.address": "Old Makkah Road, Km 8, Jeddah 22347, Saudi Arabia",

  "family.special": "Special",
  "family.petro": "Petrotoryon",
  "family.raval": "Raval",

  "lang.switchTo": "عربي",
  "lang.label": "Switch language"
};


/* ============ i18n engine — full AR ⇄ EN switch ============ */
(() => {
  const html = document.documentElement;
  const arText = new Map();      // element -> original Arabic text
  const arAttr = new Map();      // element -> { attr: original Arabic value }
  let arTitle = "";
  let arMetaDesc = "";

  const metaDesc = () => PS.qs('meta[name="description"]');

  function mergePageDict() {
    const block = PS.qs("#page-i18n");
    if (!block) return;
    try { Object.assign(PS.dict, JSON.parse(block.textContent)); }
    catch (err) { console.error("page-i18n parse failed", err); }
  }

  function cacheArabic() {
    PS.qsa("[data-i18n]").forEach(el => arText.set(el, el.textContent));
    PS.qsa("[data-i18n-attr]").forEach(el => {
      const saved = {};
      el.dataset.i18nAttr.split(";").forEach(pair => {
        const attr = pair.split(":")[0].trim();
        if (attr) saved[attr] = el.getAttribute(attr) || "";
      });
      arAttr.set(el, saved);
    });
    arTitle = document.title;
    arMetaDesc = metaDesc() ? metaDesc().content : "";
  }

  function apply(lang) {
    const en = lang === "en";
    html.setAttribute("lang", en ? "en" : "ar");
    html.setAttribute("dir", en ? "ltr" : "rtl");

    PS.qsa("[data-i18n]").forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = en ? (PS.dict[key] ?? arText.get(el)) : arText.get(el);
    });

    PS.qsa("[data-i18n-attr]").forEach(el => {
      el.dataset.i18nAttr.split(";").forEach(pair => {
        const [attr, key] = pair.split(":").map(s => s && s.trim());
        if (!attr || !key) return;
        const val = en ? (PS.dict[key] ?? arAttr.get(el)[attr]) : arAttr.get(el)[attr];
        el.setAttribute(attr, val);
      });
    });

    document.title = en ? (PS.dict["meta.title"] ?? arTitle) : arTitle;
    if (metaDesc()) metaDesc().content = en ? (PS.dict["meta.desc"] ?? arMetaDesc) : arMetaDesc;

    PS.qsa(".lang-toggle .lang-toggle__label").forEach(s => { s.textContent = en ? "عربي" : "EN"; });
    PS.store.set("ps-lang", en ? "en" : "ar");
    PS.lang = en ? "en" : "ar";
    document.dispatchEvent(new CustomEvent("ps:lang", { detail: { lang: PS.lang } }));
  }

  PS.applyLang = apply;

  document.addEventListener("DOMContentLoaded", () => {
    mergePageDict();
    cacheArabic();
    if (PS.store.get("ps-lang") === "en") apply("en"); else PS.lang = "ar";
    PS.qsa(".lang-toggle").forEach(btn =>
      btn.addEventListener("click", () => apply(PS.lang === "en" ? "ar" : "en"))
    );
  });
})();
