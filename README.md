# Yu-Gi-Oh! GENESYS Decklist Checker

A small browser-based tool for checking whether a plaintext EDOPro decklist is legal in the Yu-Gi-Oh! GENESYS format.

It parses a pasted decklist, totals the deck's GENESYS points, flags common format violations, and shows a point-by-point breakdown of the cards that matter.

## What the app checks

- Total GENESYS points against the current default cap of `100`
- More than `3` copies of the same card
- Illegal card types for the format: Link and Pendulum cards
- A per-card points breakdown for any point-costed cards in the list

## How point data is loaded

The checker tries sources in this order:

1. The official GENESYS page at `https://www.yugioh-card.com/en/genesys/`
2. Cached browser data from a previous successful fetch
3. The local snapshot in `points-table.txt`

This makes the tool usable even when the official page or proxy fetch is temporarily unavailable.

## Project structure

- `index.html` - the app UI
- `app.js` - deck parsing, point lookup, legality checks, and rendering
- `styles.css` - page styling
- `points-table.txt` - local fallback snapshot of the GENESYS point list
- `update_genesys_points.py` - helper script to refresh the local point snapshot from the official site

## Run locally

Because the app fetches `points-table.txt`, serve the folder over HTTP instead of opening `index.html` directly with `file://`.

```sh
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Using the checker

1. Open your deck in EDOPro.
2. Remove Link and Pendulum cards if you want a valid GENESYS candidate list.
3. Use `YDKE` -> `Export Plaintext`.
4. Paste the decklist into the app.
5. Click `Analyze Deck`.

## Refresh the local point snapshot

Install the Python dependencies:

```sh
pip install requests beautifulsoup4
```

Run the updater:

```sh
python3 update_genesys_points.py
```

The script refreshes:

- `points-table.txt`
- `genesys_cards.csv`

## Notes and limitations

- The point cap is currently hardcoded to `100` in `app.js`.
- Cards not found in the GENESYS point list are treated as `0` points.
- Card type checks rely on the YGOPRODeck API being reachable.
- Official list fetching is done client-side through an external proxy before falling back to cache or the bundled snapshot.
