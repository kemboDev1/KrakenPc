# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Buyers in Uzbekistan choosing a ready gaming or work PC, or the parts to build one. They compare specs, check compatibility, and place an order that an operator confirms by phone. A second audience is the KrakenPC operator, who manages orders and stock. Leadership reviews the live store in a demo; the store must hold up under that visit.

## Product Purpose

KrakenPC is a server-rendered online store for ready PCs and components, with a compatibility-checked builder and phone-confirmed checkout. Success is a visitor who can switch language, move between pages, and order without hitting a dead end, and a demo that feels fast and finished on a phone and on a desktop.

## Positioning

The store does not only list parts. A builder checks socket, memory type, cooler fit, and power-supply headroom before the selected parts go into the cart, and every ready PC is presented as a tested build with 12 months of service cover and delivery across Uzbekistan.

## Operating Context

Shoppers use the site in Uzbek, Russian, or English, in light or dark appearance. Orders are confirmed by phone. The operator works in an admin view and can be notified in Telegram. Prices are in so‘m.

## Capabilities and Constraints

Confirmed storefront: home, catalog with search and filters, product pages, compare (up to 4), favorites, cart, checkout, order success, PC builder, admin login and order/stock tools. Languages: uz, ru, en. Appearance: light and dark.

Language changes and ordinary navigation must stay on a real page. A stale session must return the visitor to the page they were on, never to a “page expired” or a false 404. Motion must stay smooth on modest phones. Icons are drawn; product pictures are images. No sticker or emoji stand-ins. Favicon and the KrakenPC mark ship with the store.

Do not invent customers, benchmarks, warranties, or delivery promises beyond the copy already in the catalog and interface strings.

## Brand Commitments

The name is KrakenPC. The line under the mark is “Performance, built right.” Voice stays direct in Uzbek, Russian, and English. The user required a new mark and favicon, drawn icons and images, and a system strong enough for a leadership demo.

## Evidence on Hand

Catalog, prices, and specs live in `data/catalog.json`. Interface copy lives in `src/i18n.js`. Product pictures are generated artwork at `/art/:id.svg` unless a photo exists under `public/images`. There are no customer testimonials, press quotes, or case studies; do not fabricate them.

## Product Principles

- The next page always exists: language, filters, and navigation resolve to a real screen.
- Specs and compatibility are the product, shown before slogans.
- The same store must feel finished on a phone and on a desktop, and it must load quickly.
- Every control says what it does, in the visitor’s language.
- The mark is a drawn identity, not a sticker.
