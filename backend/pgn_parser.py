# backend/pgn_parser.py
import io
import chess
import chess.pgn
from typing import Dict, Any, List


PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0
}


class PGNParser:
    """
    Parses raw PGN strings into board snapshots (FENs), detects tactical
    sacrifice candidates for Brilliant (!!) move grading, and parses Daily Puzzles.
    """

    @staticmethod
    def _detect_sacrifice_candidate(board_before: chess.Board, move: chess.Move) -> bool:
        """
        Determines if a move is a tactical sacrifice candidate:
        1. A piece (Knight/Bishop/Rook/Queen) moves to a square attacked by a lower-value enemy piece,
           or captures something of lower value while landing on a defended square.
        2. Or the mover intentionally leaves one of their own valuable pieces hanging/undefended
           to launch a counter-attack.
        """
        mover_color = board_before.turn
        enemy_color = not mover_color

        moving_piece = board_before.piece_at(move.from_square)
        if not moving_piece:
            return False

        moving_val = PIECE_VALUES.get(moving_piece.piece_type, 0)
        captured_piece = board_before.piece_at(move.to_square)
        captured_val = PIECE_VALUES.get(captured_piece.piece_type, 0) if captured_piece else 0

        # Make the move on a copy of the board to inspect the resulting tactical tension
        board_after = board_before.copy()
        board_after.push(move)

        # Case A: Moved a valuable piece (N, B, R, Q) onto a square attacked by enemy
        if moving_val >= 3 and board_after.is_attacked_by(enemy_color, move.to_square):
            # If we didn't capture something of equal/higher value, we are offering a sacrifice!
            if captured_val < moving_val:
                return True

        # Case B: Left another one of our Knights/Bishops/Rooks/Queens undefended & attacked
        for sq in chess.SQUARES:
            piece = board_after.piece_at(sq)
            if piece and piece.color == mover_color and PIECE_VALUES.get(piece.piece_type, 0) >= 3:
                if board_after.is_attacked_by(enemy_color, sq) and not board_after.is_attacked_by(mover_color, sq):
                    return True

        return False

    @staticmethod
    def parse_game(pgn_text: str) -> Dict[str, Any]:
        pgn_io = io.StringIO(pgn_text)
        game = chess.pgn.read_game(pgn_io)

        if game is None:
            raise ValueError("Invalid or empty PGN data provided.")

        headers = dict(game.headers)
        board = game.board()

        moves_data: List[Dict[str, Any]] = [
            {
                "ply": 0,
                "move_number": 0,
                "turn": "none",
                "san": "Start",
                "uci": None,
                "fen": board.fen(),
                "is_sacrifice_candidate": False
            }
        ]

        ply_count = 0
        for move in game.mainline_moves():
            ply_count += 1
            mover_color = "white" if board.turn == chess.WHITE else "black"
            san_move = board.san(move)
            uci_move = move.uci()

            # Check if this move offers a tactical piece sacrifice BEFORE pushing
            is_sac = PGNParser._detect_sacrifice_candidate(board, move)

            board.push(move)

            moves_data.append({
                "ply": ply_count,
                "move_number": (ply_count + 1) // 2,
                "turn": mover_color,
                "san": san_move,
                "uci": uci_move,
                "fen": board.fen(),
                "is_check": board.is_check(),
                "is_checkmate": board.is_checkmate(),
                "is_capture": "x" in san_move,
                "is_sacrifice_candidate": is_sac
            })

        return {
            "metadata": {
                "event": headers.get("Event", "Live Chess"),
                "date": headers.get("Date", "Unknown"),
                "white": headers.get("White", "Unknown"),
                "black": headers.get("Black", "Unknown"),
                "result": headers.get("Result", "*"),
                "eco": headers.get("ECO", "Unknown"),
                "eco_url": headers.get("ECOUrl", ""),
            },
            "total_plies": ply_count,
            "positions": moves_data
        }

    @staticmethod
    def parse_daily_puzzle(fen: str, pgn_text: str) -> Dict[str, Any]:
        """
        Extracts the exact solution moves (SAN and UCI) from Chess.com's Daily Puzzle PGN.
        """
        pgn_io = io.StringIO(pgn_text)
        game = chess.pgn.read_game(pgn_io)
        board = chess.Board(fen) if fen else (game.board() if game else chess.Board())

        side_to_move = "white" if board.turn == chess.WHITE else "black"
        solution_steps = []

        if game:
            for move in game.mainline_moves():
                san = board.san(move)
                uci = move.uci()
                board.push(move)
                solution_steps.append({
                    "uci": uci,
                    "san": san,
                    "fen_after": board.fen()
                })

        return {
            "initial_fen": fen,
            "player_color": side_to_move,
            "solution": solution_steps
        }