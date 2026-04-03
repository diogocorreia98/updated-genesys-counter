import csv
import time
from pathlib import Path
from typing import Dict, List

import requests
from bs4 import BeautifulSoup
from requests.exceptions import RequestException


BASE_URL = "https://yugioh-card.com"
START_URL = f"{BASE_URL}/en/genesys/"
DEFAULT_OUTPUT = Path("points-table.txt")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def fetch_page(url: str, max_retries: int = 3, backoff: float = 1.0, verify_ssl: bool = True) -> str:
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=15, verify=verify_ssl)
            response.raise_for_status()
            return response.text
        except RequestException:
            if attempt == max_retries:
                raise
            time.sleep(backoff * attempt)
    raise RuntimeError("Unreachable")


def parse_genesys_table(html: str) -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    table = None
    for candidate in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in candidate.find_all("th")]
        if "card name" in headers and "points" in headers:
            table = candidate
            break

    if table is None:
        raise ValueError("No valid GENESYS card table found.")

    cards: List[Dict[str, str]] = []
    for row in table.find_all("tr")[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        card_name = cells[0].get_text(strip=True)
        points = cells[1].get_text(strip=True)
        if not card_name or not points.isdigit():
            continue
        cards.append({"card_name": card_name, "points": points})
    return cards


def write_points_table(cards: List[Dict[str, str]], output_path: Path = DEFAULT_OUTPUT) -> None:
    lines = ["Card Name\tPoints"]
    lines.extend(f"{row['card_name']}\t{row['points']}" for row in cards)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_csv(cards: List[Dict[str, str]], output_csv: Path = Path("genesys_cards.csv")) -> None:
    with output_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["card_name", "points"])
        writer.writeheader()
        writer.writerows(cards)


def main() -> None:
    alt_url = START_URL.replace("https://yugioh-card.com", "https://www.yugioh-card.com")
    html = None

    try:
        html = fetch_page(alt_url)
    except Exception:
        print(f"Warning: could not fetch from {alt_url}; trying {START_URL} with SSL verify disabled.")

    if html is None:
        html = fetch_page(START_URL, verify_ssl=False)

    cards = parse_genesys_table(html)
    write_points_table(cards)
    write_csv(cards)
    print(f"Saved {len(cards)} rows to {DEFAULT_OUTPUT} and genesys_cards.csv")


if __name__ == "__main__":
    main()
