# Clay & Line — Pinterest productfeed

Houdt één bestand actueel: `docs/pinterest-feed.csv`, de productfeed die Pinterest elke
ochtend (08:00 Amsterdam) ophaalt voor de catalogus van clayandline.com. Afgeleid van
`aesth-pinterest-feed`; de uitleg daar (beveiliging, Pinterest-diagnostiek) geldt ook hier.

## Hoe het werkt

1. GitHub Action draait elke nacht (04:17 UTC) `build-feed.mjs`.
2. Het script haalt alle **publieke** producten op uit de Fourthwall Storefront API (shop `poster-upj`).
3. Het schrijft **één regel per poster en één per set** naar `docs/pinterest-feed.csv`
   (maten samengevoegd; prijs = vanaf-prijs van de kleinste maat, 8×10).
4. GitHub Pages serveert `docs/` → `https://meakamst-stack.github.io/clayline-pinterest-feed/pinterest-feed.csv`.
5. Pinterest haalt die URL dagelijks op.

## Afbeeldingen (eigen kamermockups)

- `docs/pins/<serie>/<slug>-<setting>-v1.jpg` + `docs/pins/manifest.json` komen uit
  `POSTER/designs/_make/pins.py` (dat leest de mockups uit `POSTER/designs/<serie>/mockups/`,
  gemaakt met `mockup.py` + `setkaart.py`).
- Per poster: hoofdfoto `bath-vanity`, tweede foto `bath-dark` of `bath-cool` (per serie gekozen in `pins.py`).
  Per set: hoofdfoto `bath-oak-3` (drie lijsten boven het bad), tweede foto `set-overview`.
- Twee afbeeldingen per regel → 48 regels ≈ 96 pins. Alleen de hoofdfoto: `ADDITIONAL_IMAGES=0`.
- **Geen mockup voor een product? Dan komt het niet in de feed** (log: "NIET in de feed").
- Nieuwe mockups krijgen een nieuwe versie in de bestandsnaam (`VERSIE='v2'` in `pins.py`), anders toont Pinterest de oude foto.
- Fourthwall-foto's gaan nooit mee (noodknop `FW_FALLBACK=1`).

## Kolommen

`id` (= slug), `title`, `description` (platte tekst van de Fourthwall-beschrijving), `link` (met UTM
`pinterest / catalog / pinterest-catalog / <slug>`), `image_link`, `price`, `availability`, `condition`,
`brand` (Clay & Line), `google_product_category` (Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork),
`product_type` (Home Decor > Wall Art > Bathroom), `item_group_id` (= slug), `additional_image_link`,
`custom_label_0` (serie, bv. `terracotta-arches-01`), `custom_label_1` (`poster` of `set`).

## Beveiliging

Het script weigert te schrijven (exit 2, bestaande feed blijft staan) als het aantal regels meer dan
30 % daalt, als er ineens geen eigen mockups meer in zitten, of als de API minder producten geeft dan ze
aankondigt. Bewuste daling: Actions → *Build Pinterest feed* → *Run workflow* → vinkje **force**.

## Zelf draaien

```bash
FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs
SITE_BASE=https://poster-upj-shop.fourthwall.com FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs   # zolang het domein nog niet gekoppeld is
FORCE=1 FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs
```

## Als er iets misgaat

Zie de tabel in de README van `aesth-pinterest-feed` — zelfde script, zelfde meldingen.
Extra hier: "heeft geen prijs in de API — overgeslagen" bij een set betekent dat de Storefront API de
bundelprijs anders teruggeeft dan verwacht; dan `build-feed.mjs` → `productRow` aanpassen.
