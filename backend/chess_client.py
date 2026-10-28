# backend/chess_client.py
import requests
from typing import List, Dict, Any

class ChessComClient:
    """
    Handles communication with the official Chess.com Published-Data API.
    """
    BASE_URL = "https://api.chess.com/pub/player"
    PUZZLE_URL = "https://api.chess.com/pub/puzzle"

    def __init__(self):
        self.headers = {
            "User-Agent": "Chessturanga/1.0 (Open-Source Chess Analyzer; GitHub Project)"
        }

    def get_recent_games(self, username: str, limit: int = 30) -> List[Dict[str, Any]]:
        """
        Walks backward through the player's monthly archives (current month,
        previous month, etc.) until it collects `limit` standard chess games.
        """
        username = username.lower().strip()
        archives_url = f"{self.BASE_URL}/{username}/games/archives"

        response = requests.get(archives_url, headers=self.headers, timeout=10)
        if response.status_code == 404:
            raise ValueError(f"Player '{username}' not found on Chess.com.")
        response.raise_for_status()

        archives = response.json().get("archives", [])
        if not archives:
            return []

        valid_games = []

        # Loop backward through monthly archives (up to the last 6 active months)
        for month_url in reversed(archives[-6:]):
            games_response = requests.get(month_url, headers=self.headers, timeout=10)
            if games_response.status_code != 200:
                continue

            raw_games = games_response.json().get("games", [])

            for game in reversed(raw_games):
                if game.get("rules") == "chess" and "pgn" in game:
                    valid_games.append({
                        "url": game.get("url"),
                        "time_control": game.get("time_class"),
                        "end_time": game.get("end_time"),
                        "white": {
                            "username": game["white"]["username"],
                            "rating": game["white"]["rating"],
                            "result": game["white"]["result"]
                        },
                        "black": {
                            "username": game["black"]["username"],
                            "rating": game["black"]["rating"],
                            "result": game["black"]["result"]
                        },
                        "pgn": game["pgn"]
                    })
                if len(valid_games) >= limit:
                    return valid_games

        return valid_games

    def get_daily_puzzle(self) -> Dict[str, Any]:
        """
        Fetches today's official Daily Puzzle from Chess.com API.
        """
        response = requests.get(self.PUZZLE_URL, headers=self.headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return {
            "title": data.get("title", "Daily Tactical Puzzle"),
            "url": data.get("url", ""),
            "publish_time": data.get("publish_time", 0),
            "fen": data.get("fen", ""),
            "pgn": data.get("pgn", "")
        }