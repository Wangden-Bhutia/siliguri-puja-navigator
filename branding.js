/* Siliguri Puja Guide - the ONE place for user-visible branding.
   index.html carries the same words as a no-JavaScript fallback; tests/unit.js checks that index.html,
   manifest.webmanifest and offline.html match this object, so edit here first.

   !!! APPROVAL REQUIRED BEFORE MERGING / PUBLISHING !!!
   The descriptor ("Official ..."), the joint-initiative caption and the two police logos suggest an
   institutional relationship. They must have WRITTEN approval from the responsible authority before this is
   published. Until then keep officialBrandingApproved = false: the app then shows descriptorDefault, hides the
   identity strip and the footer stays "Demo version". If approval is
   not given, set institutionalBranding.enabled = false (hides the whole identity strip) and change `descriptor`.
   Never write "endorsed by" / "approved by" and never claim government ownership. */
(function (root) {
  'use strict';
  var BRANDING = {
    appName: 'Siliguri Puja Guide',
    shortName: 'Puja Guide',
    tagline: 'Find pandals. Plan your route. Travel safely.',
    descriptor: 'Official Durga Puja Traffic & Visitor Information',   // shown ONLY when officialBrandingApproved = true
    descriptorDefault: 'Durga Puja Visitor Information \u00B7 Siliguri', // neutral wording used until approval
    festivalDates: '16 \u2013 21 October 2026',
    festivalName: 'Durga Puja 2026',
    officialBrandingApproved: false,                                   // true only after written approval
    footerDemo: 'Siliguri Puja Guide \u00B7 Durga Puja 2026 \u00B7 Demo version',
    footerApproved: 'Siliguri Puja Guide \u00B7 Official app for Durga Puja',
    institutionalBranding: {
      enabled: true,                       // kill switch: set false to remove the strip entirely
      caption: 'A joint initiative by',    // needs written approval
      names: ['West Bengal Police', 'Siliguri Metropolitan Police'],
      logos: [
        { src: 'assets/logos/west-bengal-police.png', alt: 'West Bengal Police logo' },
        { src: 'assets/logos/siliguri-metropolitan-police.png', alt: 'Siliguri Metropolitan Police logo' }
      ],
      // Maintained by tools/build-sw.js: true only when BOTH files above exist in the repo at build time.
      // While false the app never requests the logo files (no 404s, no empty gap).
      logosPresent: true /*AUTO*/
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = BRANDING; else root.PUJA_BRANDING = BRANDING;
})(typeof window !== 'undefined' ? window : this);
