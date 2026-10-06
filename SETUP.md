# Hoe dit is ingericht

Opgezet 6 okt 2026 als kopie van `aesth-pinterest-feed` (zie SETUP.md daar voor de achtergrond).

| Onderdeel | Instelling |
|---|---|
| Repo | `meakamst-stack/clayline-pinterest-feed`, public (nodig voor gratis GitHub Pages) |
| Secret | `FW_STOREFRONT_TOKEN` — Fourthwall → Settings → For Developers → Storefront API → Create token (shop **Poster**); GitHub → Settings → Secrets and variables → Actions |
| Variable | `SITE_BASE` = `https://poster-upj-shop.fourthwall.com` zolang clayandline.com niet gekoppeld is; daarna weghalen (standaard `https://clayandline.com`) |
| Workflow | `.github/workflows/build-feed.yml`: elke nacht 04:17 UTC, bij push van `build-feed.mjs` / `docs/pins/**` / de workflow, handmatig via Actions (optie **force**) |
| GitHub Pages | Settings → Pages → *Deploy from a branch* → `main`, map `/docs` |
| Feed-URL | `https://meakamst-stack.github.io/clayline-pinterest-feed/pinterest-feed.csv` |
| Pinterest | bedrijfsaccount "Clay & Line" (nog aan te maken) → Catalogi → Gegevensbronnen → nieuwe bron met de Feed-URL, land VS, USD, dagelijks 08:00 Amsterdam. Vooraf: domein claimen (TXT) en verkopersgoedkeuring (site moet live zijn). Fourthwalls eigen Pinterest-sync **uit** laten. |
| Node | 22 (Action); lokaal elke Node ≥ 18 |

## Lokale map op de PC

`Projects/site/clayline-pinterest-feed` is een kopie, geen git-clone. Claude pusht wijzigingen met git
en kopieert ze daarna naar de PC. `docs/pins/` wordt op de PC gemaakt door `POSTER/designs/_make/pins.py`
en door Claude naar de repo gepusht.

## Volgorde om live te gaan

1. Producten in Fourthwall op PUBLIC (nu allemaal Hidden → de feed is leeg en het script stopt met exit 1; dat is verwacht).
2. Storefront-token aanmaken en als secret zetten; Pages aanzetten.
3. Actions → Run workflow → controleren dat `docs/pinterest-feed.csv` 48 regels heeft en de prijs van de sets klopt.
4. Pinterest-bedrijfsaccount, domein claimen, verkopersgoedkeuring, gegevensbron toevoegen.
5. Dag erna: Catalogi → Diagnostiek (48 geslaagd, 0 mislukt; ±96 pins).
