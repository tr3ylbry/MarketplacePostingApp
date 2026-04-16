# Marketplace Posting Assistant

An app that will allow the user to automate a flow posting to Ebay, Craigslist, Facebook Marketplace, OfferUp, &amp; Reverb if applicable (for music related gear).
V1 is a local-first TypeScript app for drafting one listing, formatting it for each marketplace, and tracking where it has been posted.

## Recommended Stack

- `React + Vite + TypeScript` for a fast local UI with minimal ceremony.
- `localStorage` for V1 persistence so we can stay fully local and avoid premature backend work.
- `Vitest` for fast unit tests around domain logic.
- `Electron` later, only if you want a native desktop shell. The React app can be reused inside Electron when that time comes.

## Why Start As A Local Web App

- Simplest path to a working interface.
- Easier debugging and testing than Electron on day one.
- Lets us validate the workflow before taking on desktop packaging.

## Electron vs Local Web App

- Local web app: fastest to build, simplest maintenance, ideal for a personal workflow tool.
- Electron: better if you later want native menus, notifications, filesystem integration, or packaged distribution.

The current structure keeps domain logic framework-agnostic so we can wrap it with Electron later without rewriting the adapters.

## Architecture

### App Layers

- `src/domain`: listing types, validation, and status helpers.
- `src/platforms`: platform adapter contract and formatter implementations.
- `src/storage`: local persistence for listings.
- `src/features/listings`: listing creation form and basic dashboard UI.

### Core Flow

1. Create one canonical listing.
2. Store it locally.
3. Generate platform-specific views through adapters.
4. Track posted URLs and renewal status separately from the source listing.

## Initial Project Structure

```text
src/
  app/
    App.tsx
  domain/
    listing.ts
  features/
    listings/
      components/
        ListingForm.tsx
        ListingDashboard.tsx
        PlatformPreview.tsx
      hooks/
        useListings.ts
  platforms/
    ebay.ts
    index.ts
    types.ts
  storage/
    listingsStorage.ts
  test/
    setup.ts
  main.tsx
  styles.css
```

## V1 Scope

- Create and save a listing locally.
- Preview an eBay-formatted version.
- Track active listings in a simple dashboard.

## Next Suggested Steps

1. Add more platform adapters.
2. Add posting records with URLs and renewal reminders in the UI.
3. Introduce image upload persistence beyond local file names.
4. Optionally wrap the app in Electron once the workflow feels right.
