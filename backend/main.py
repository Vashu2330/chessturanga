# backend/main.py
import re
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.chess_client import ChessComClient
from backend.pgn_parser import PGNParser

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="CHESSTURANGA API",
    description="Open-Source Chess Game Analyzer & Engine Backend",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")

chess_client = ChessComClient()


class RawPGNRequest(BaseModel):
    pgn: str


@app.get("/")
def serve_dashboard():
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail=f"Could not find index.html at: {index_file}")
    return FileResponse(str(index_file))


@app.get("/api/games/{username}")
def get_user_games(username: str, limit: int = 10):
    try:
        raw_games = chess_client.get_recent_games(username, limit=limit)
        enriched_games = []

        for g in raw_games:
            parsed_data = PGNParser.parse_game(g["pgn"])
            enriched_games.append({
                "url": g["url"],
                "time_control": g["time_control"],
                "end_time": g["end_time"],
                "white": g["white"],
                "black": g["black"],
                "metadata": parsed_data["metadata"],
                "total_plies": parsed_data["total_plies"],
                "positions": parsed_data["positions"]
            })

        return {
            "username": username,
            "count": len(enriched_games),
            "games": enriched_games
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.get("/api/stats/{username}")
def get_opening_leak_stats(username: str, limit: int = 30):
    """
    Scans the player's last `limit` games to calculate White/Black win rates,
    most profitable openings, and biggest opening leaks.
    """
    try:
        raw_games = chess_client.get_recent_games(username, limit=limit)
        target_user = username.lower().strip()

        color_stats = {
            "white": {"wins": 0, "draws": 0, "losses": 0, "total": 0},
            "black": {"wins": 0, "draws": 0, "losses": 0, "total": 0}
        }
        openings_map = {}

        draw_codes = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}

        for g in raw_games:
            is_white = g["white"]["username"].lower() == target_user
            player_color = "white" if is_white else "black"
            player_result = g[player_color]["result"]

            # Extract Opening Name quickly from PGN ECOUrl header
            pgn_text = g.get("pgn", "")
            eco_url_match = re.search(r'\[ECOUrl "([^"]+)"\]', pgn_text)
            if eco_url_match:
                raw_slug = eco_url_match.group(1).split("/")[-1]
                # Keep the first 3 words of the opening name so variations group cleanly
                words = raw_slug.replace("-", " ").split()
                opening_name = " ".join(words[:3]) if words else "Unknown Opening"
            else:
                opening_name = "Standard Opening"

            color_stats[player_color]["total"] += 1
            if opening_name not in openings_map:
                openings_map[opening_name] = {"name": opening_name, "wins": 0, "draws": 0, "losses": 0, "total": 0}

            openings_map[opening_name]["total"] += 1

            if player_result == "win":
                color_stats[player_color]["wins"] += 1
                openings_map[opening_name]["wins"] += 1
            elif player_result in draw_codes:
                color_stats[player_color]["draws"] += 1
                openings_map[opening_name]["draws"] += 1
            else:
                color_stats[player_color]["losses"] += 1
                openings_map[opening_name]["losses"] += 1

        # Compute percentages for each opening
        opening_list = []
        for op in openings_map.values():
            op["win_rate"] = round((op["wins"] / op["total"]) * 100, 1) if op["total"] > 0 else 0.0
            op["loss_rate"] = round((op["losses"] / op["total"]) * 100, 1) if op["total"] > 0 else 0.0
            opening_list.append(op)

        # Sort by most played
        opening_list.sort(key=lambda x: x["total"], reverse=True)

        # Find Best Opening and Biggest Opening Leak
        best_opening = max(opening_list, key=lambda x: (x["win_rate"], x["total"]), default=None)
        leak_opening = max(opening_list, key=lambda x: (x["loss_rate"], x["total"]), default=None)

        return {
            "username": username,
            "games_analyzed": len(raw_games),
            "color_stats": color_stats,
            "openings": opening_list[:8],
            "best_opening": best_opening,
            "biggest_leak": leak_opening
        }

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats error: {str(e)}")


@app.get("/api/daily-puzzle")
def get_daily_puzzle():
    try:
        raw_puzzle = chess_client.get_daily_puzzle()
        parsed_solution = PGNParser.parse_daily_puzzle(raw_puzzle["fen"], raw_puzzle["pgn"])
        return {
            "title": raw_puzzle["title"],
            "url": raw_puzzle["url"],
            "initial_fen": parsed_solution["initial_fen"],
            "player_color": parsed_solution["player_color"],
            "solution": parsed_solution["solution"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load Daily Puzzle: {str(e)}")


@app.post("/api/parse-pgn")
def parse_custom_pgn(request: RawPGNRequest):
    try:
        return PGNParser.parse_game(request.pgn)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))