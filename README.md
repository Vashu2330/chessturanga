# CHESSTURANGA ♟️

Grandmaster-style chess study tool. Enter a Chess.com username, load recent games, and get Stockfish analysis with move ratings.

**Live demo:** YOUR-RENDER-LINK-HERE

## Features
- Load recent games from Chess.com by username
- Filter by Rapid, Blitz or Bullet
- Stockfish analysis (Brilliant, Great, Best, Mistake, Blunder)
- Opening repertoire and leak detector
- Daily study puzzle
- Play on from any position against the engine

## Run it locally
    pip install -r requirements.txt
    uvicorn backend.main:app --reload
Then open http://127.0.0.1:8000

## Tech
Python, FastAPI, JavaScript, Stockfish, Chess.com API

## Screenshots

<img width="1200" height="630" alt="Chessturanga_BrokeCactus_vs_Vashupandey101" src="https://github.com/user-attachments/assets/7699823e-6798-489d-989e-43cf0b15082e" />
<img width="1917" height="872" alt="Screenshot 2026-10-28 170133" src="https://github.com/user-attachments/assets/11ac15d7-10ad-4cbc-b710-3d3cb9a6abee" />
