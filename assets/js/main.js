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
