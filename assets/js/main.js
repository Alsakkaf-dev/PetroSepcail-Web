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


/* ============ Header: glass on scroll + mobile drawer ============ */
(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const header = PS.qs(".header");
    const burger = PS.qs(".burger");
    const nav = PS.qs(".nav");
    if (!header) return;

    const onScroll = () => header.classList.toggle("header--scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    if (burger && nav) {
      const setOpen = open => {
        burger.setAttribute("aria-expanded", String(open));
        nav.classList.toggle("is-open", open);
        document.body.style.overflow = open ? "hidden" : "";
      };
      burger.addEventListener("click", () =>
        setOpen(burger.getAttribute("aria-expanded") !== "true"));
      nav.addEventListener("click", e => { if (e.target.closest("a")) setOpen(false); });
      document.addEventListener("keydown", e => { if (e.key === "Escape") setOpen(false); });
      window.matchMedia("(min-width: 61em)").addEventListener("change", () => setOpen(false));
    }
  });
})();


/* ============ Reveal-on-scroll, stagger & counters ============ */
(() => {
  document.addEventListener("DOMContentLoaded", () => {
    /* Auto-stagger children of [data-stagger] containers */
    PS.qsa("[data-stagger]").forEach(group => {
      const step = parseFloat(group.dataset.stagger) || 0.1;
      PS.qsa(".reveal", group).forEach((el, i) =>
        el.style.setProperty("--delay", (i * step).toFixed(2) + "s"));
    });

    const animateCount = el => {
      const target = parseFloat(el.dataset.count);
      if (PS.reducedMotion) { el.textContent = String(target); return; }
      const dur = 1600;
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min((now - t0) / dur, 1);
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (!("IntersectionObserver" in window) || PS.reducedMotion) {
      PS.qsa(".reveal").forEach(el => el.classList.add("is-inview"));
      PS.qsa("[data-count]").forEach(animateCount);
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-inview");
        PS.qsa("[data-count]", entry.target).forEach(animateCount);
        if (entry.target.dataset.count !== undefined) animateCount(entry.target);
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });

    PS.qsa(".reveal").forEach(el => io.observe(el));
  });
})();


/* ============ Catalog tabs, accordions & product gallery ============ */
(() => {
  document.addEventListener("DOMContentLoaded", () => {
    /* Brand tabs */
    const tabs = PS.qsa(".brand-tab");
    tabs.forEach(tab => tab.addEventListener("click", () => {
      tabs.forEach(t => {
        t.setAttribute("aria-selected", String(t === tab));
        const panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = t !== tab;
      });
    }));

    /* Category accordions */
    PS.qsa(".cat__head").forEach(head => head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", String(!open));
      const body = document.getElementById(head.getAttribute("aria-controls"));
      if (body) body.hidden = open;
    }));

    /* Product gallery thumbnails */
    const main = PS.qs(".pd-gallery__main img");
    PS.qsa(".pd-gallery__thumbs button").forEach(btn => btn.addEventListener("click", () => {
      if (!main) return;
      const thumb = PS.qs("img", btn);
      main.src = btn.dataset.full || (thumb ? thumb.src : main.src);
      PS.qsa(".pd-gallery__thumbs button").forEach(b =>
        b.setAttribute("aria-current", String(b === btn)));
    }));
  });
})();


/* ============ Contact form: validation + submission ============ */
(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const form = PS.qs("#contact-form");
    if (!form) return;

    const status = PS.qs(".form-status", form.parentElement);
    const submitBtn = PS.qs("button[type=submit]", form);
    const loadedAt = Date.now();

    const setStatus = ok => {
      if (!status) return;
      status.classList.remove("is-success", "is-error");
      status.classList.add(ok ? "is-success" : "is-error");
      PS.qs(".form-status__msg", status).textContent =
        PS.lang === "en"
          ? PS.dict[ok ? "form.success" : "form.error"]
          : (ok
            ? "شكراً لك! تم استلام رسالتك — سيتواصل معك فريقنا في أقرب وقت."
            : "حدث خطأ ولم يتم إرسال الرسالة. حاول مرة أخرى أو اتصل بنا مباشرة.");
      status.scrollIntoView({ behavior: PS.reducedMotion ? "auto" : "smooth", block: "nearest" });
    };

    const validate = () => {
      let ok = true;
      PS.qsa(".field [required]", form).forEach(input => {
        const field = input.closest(".field");
        const msg = PS.qs(".error-msg", field);
        let bad = !input.value.trim();
        if (!bad && input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
          bad = true;
          if (msg) msg.textContent = PS.lang === "en" ? PS.dict["form.badEmail"] : "يرجى إدخال بريد إلكتروني صحيح";
        } else if (msg) {
          msg.textContent = PS.lang === "en" ? PS.dict["form.required"] : "هذا الحقل مطلوب";
        }
        field.classList.toggle("is-invalid", bad);
        if (bad) ok = false;
      });
      return ok;
    };

    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!validate()) return;
      /* Anti-spam: honeypot filled or submitted inhumanly fast */
      if (form.website && form.website.value) return;
      if (Date.now() - loadedAt < 3000) { setStatus(false); return; }

      const payload = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        message: form.message.value.trim(),
        locale: PS.lang || "ar"
      };

      if (!PS.CONTACT) {
        /* Backend not provisioned yet — never a dead form: hand off to mail app */
        const body = encodeURIComponent(`${payload.name}\n${payload.phone}\n\n${payload.message}`);
        window.location.href = `mailto:zoer4019@gmail.com?subject=${encodeURIComponent("رسالة من موقع بتروسبيشل")}&body=${body}`;
        return;
      }

      const idle = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = PS.lang === "en" ? PS.dict["form.sending"] : "جارٍ الإرسال…";
      try {
        const res = await fetch(`${PS.CONTACT.url}/rest/v1/contact_messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: PS.CONTACT.key,
            Authorization: `Bearer ${PS.CONTACT.key}`,
            Prefer: "return=minimal"
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus(true);
        form.reset();
      } catch (err) {
        console.error("contact submit failed", err);
        setStatus(false);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = idle;
      }
    });
  });
})();
