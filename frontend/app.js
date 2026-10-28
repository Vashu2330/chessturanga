// frontend/app.js

// --- 1. Studio State ---
let board = null;
let allGames = [];
let filteredGames = [];
let selectedTimeControl = "all"; // "all", "rapid", "blitz", or "bullet"
let currentGame = null;
let currentPly = 0;
let boardOrientation = "white";
let isBoardDraggable = false;
let stockfish = null;
let isEngineReady = false;
let currentEvalResolver = null;
let isFullAnalysisRunning = false;
let evalChart = null;
let liveEvalTimer = null;

// Voice Coach State
let isVoiceEnabled = false;

// Interactive Modes: "blunder", "daily", or "sparring" (Play From Here vs Stockfish!)
let isPuzzleMode = false;
let puzzleModeType = null;
let puzzleTargetUci = null;
let dailyPuzzleData = null;
let dailyStepIndex = 0;

// Live Chess.js instance for "Play From Here vs. Engine" Alternate Timeline
let sparringChess = null;
let sparringHistory = [];

// --- 2. Initialize Wooden Study ---
document.addEventListener("DOMContentLoaded", async () => {
    initChessboard(false, "start");
    initEvalChart();
    await initStockfishEngine();

    document.getElementById("load-games-btn").addEventListener("click", fetchUserGames);
    document.getElementById("games-limit-select").addEventListener("change", fetchUserGames);
    document.getElementById("daily-puzzle-btn").addEventListener("click", startDailyPuzzleMode);
    document.getElementById("puzzle-hint-btn").addEventListener("click", showDailyPuzzleHint);
    document.getElementById("voice-toggle-btn").addEventListener("click", toggleVoiceCoach);
    document.getElementById("opening-leaks-btn").addEventListener("click", openOpeningLeaksModal);
    document.getElementById("close-leaks-modal").addEventListener("click", () => {
        document.getElementById("leaks-modal").classList.add("hidden");
        document.getElementById("leaks-modal").classList.remove("flex");
    });
    document.getElementById("share-card-btn").addEventListener("click", downloadMatchSummaryPoster);
    document.getElementById("game-select").addEventListener("change", onGameSelected);
    document.getElementById("start-btn").addEventListener("click", () => updateBoardAtPly(0));
    document.getElementById("prev-btn").addEventListener("click", () => stepMove(-1));
    document.getElementById("next-btn").addEventListener("click", () => stepMove(1));
    document.getElementById("end-btn").addEventListener("click", () => currentGame && updateBoardAtPly(currentGame.total_plies));
    document.getElementById("flip-btn").addEventListener("click", flipBoardOrientation);
    document.getElementById("analyze-game-btn").addEventListener("click", analyzeFullGame);
    document.getElementById("retry-blunder-btn").addEventListener("click", startBlunderRetryPuzzle);
    document.getElementById("play-from-here-btn").addEventListener("click", startPlayFromHereMode);
    document.getElementById("exit-sparring-btn").addEventListener("click", () => updateBoardAtPly(currentPly));

    // Wire up Time-Control Category Filter Buttons (All / Rapid / Blitz / Bullet)
    document.querySelectorAll(".tc-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            setTimeControlFilter(btn.getAttribute("data-tc"));
        });
    });

    document.addEventListener("keydown", (e) => {
        if (!currentGame || isPuzzleMode) return;
        if (e.key === "ArrowRight") {
            e.preventDefault();
            stepMove(1);
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            stepMove(-1);
        }
    });

    fetchUserGames();
});

function initChessboard(draggable = false, fen = "start") {
    if (board && isBoardDraggable === draggable) {
        board.orientation(boardOrientation);
        board.position(fen, false);
        return;
    }
    isBoardDraggable = draggable;
    board = Chessboard("board", {
        position: fen,
        orientation: boardOrientation,
        draggable: draggable,
        moveSpeed: 140,
        snapbackSpeed: 100,
        snapSpeed: 80,
        pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
        onDrop: handleInteractivePieceDrop,
        onSnapEnd: () => {
            if (isPuzzleMode && puzzleModeType === "sparring" && sparringChess) {
                board.position(sparringChess.fen(), false);
            }
        }
    });
}

function flipBoardOrientation() {
    boardOrientation = boardOrientation === "white" ? "black" : "white";
    board.orientation(boardOrientation);
    updatePlayerBarLabels();
    if (currentGame && !isPuzzleMode) {
        requestAnimationFrame(() => renderBoardAnnotations(currentGame.positions[currentPly]));
    }
}

// --- 3. GRANDMASTER VOICE COACH ---
function toggleVoiceCoach() {
    isVoiceEnabled = !isVoiceEnabled;
    const btn = document.getElementById("voice-toggle-btn");
    if (isVoiceEnabled) {
        btn.innerHTML = `<span>🔊 Voice: ON</span>`;
        btn.className = "brass-btn font-bold text-xs px-3 py-2 rounded-md flex items-center gap-1.5";
        speakText("Voice commentary enabled.");
    } else {
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        btn.innerHTML = `<span>🔇 Voice: OFF</span>`;
        btn.className = "wood-btn font-semibold text-xs px-3 py-2 rounded-md flex items-center gap-1.5";
    }
}

function sanToSpokenWords(san) {
    if (!san || san === "Start") return "Starting position";
    if (san === "O-O") return "Castles kingside";
    if (san === "O-O-O") return "Castles queenside";
    return san
        .replace(/^N/, "Knight ")
        .replace(/^B/, "Bishop ")
        .replace(/^R/, "Rook ")
        .replace(/^Q/, "Queen ")
        .replace(/^K/, "King ")
        .replace("x", " takes ")
        .replace("+", ", check")
        .replace("#", ", checkmate!");
}

function speakText(text) {
    if (!isVoiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
}

// --- 4. "PLAY FROM HERE VS. STOCKFISH" (WHAT-IF SANDBOX TIMELINE) ---
function startPlayFromHereMode() {
    if (!currentGame) return;
    const basePly = currentPly > 0 ? currentPly - 1 : 0;
    const startFen = currentGame.positions[basePly].fen;
    const replacedMove = currentPly > 0 ? currentGame.positions[currentPly] : null;
    
    sparringChess = new Chess(startFen);
    sparringHistory = [];
    isPuzzleMode = true;
    puzzleModeType = "sparring";
    
    const turnColor = sparringChess.turn() === "w" ? "white" : "black";
    boardOrientation = turnColor;
    initChessboard(true, startFen);
    resetSvgDefs();
    
    document.getElementById("exit-sparring-btn").classList.remove("hidden");
    document.getElementById("puzzle-hint-btn").classList.add("hidden");
    document.getElementById("match-status-label").textContent = `⚔️ Alternate Timeline (vs. Stockfish)`;
    
    const replacedText = replacedMove 
        ? `In the match, <strong>${replacedMove.turn.toUpperCase()}</strong> played <span class="text-[#f87171] font-mono">${replacedMove.san}</span>. Let's play it differently!` 
        : `Starting from the initial board position.`;
        
    document.getElementById("ai-coach-box").innerHTML = `
        <div class="text-[#e6c875] font-bold uppercase text-xs mb-1">⚔️ What-If Sandbox Active (Play vs. Stockfish)</div>
        <p class="text-[#f3ead8]">${replacedText}</p>
        <p class="text-[#b5a48b] mt-1.5">
            <strong>Drag any ${turnColor.toUpperCase()} piece</strong> on the board to play a different move! Stockfish will reply automatically.
        </p>
    `;
    speakText(`Alternate timeline active. Play a different move for ${turnColor}, and Stockfish will reply.`);
}

async function makeStockfishSparringReply() {
    if (!isPuzzleMode || puzzleModeType !== "sparring" || !sparringChess || sparringChess.game_over()) {
        return;
    }
    document.getElementById("match-status-label").textContent = "🤔 Stockfish is thinking...";
    const currentFen = sparringChess.fen();
    
    const evalData = await evaluateFen(currentFen, 9, sparringChess.in_checkmate());
    if (!isPuzzleMode || puzzleModeType !== "sparring") return;
    
    const bestUci = evalData.bestMove;
    if (bestUci && bestUci.length >= 4 && bestUci !== "Checkmate" && bestUci !== "Draw") {
        const fromSq = bestUci.substring(0, 2);
        const toSq = bestUci.substring(2, 4);
        const promo = bestUci.length > 4 ? bestUci[4] : "q";
        
        const engineMove = sparringChess.move({ from: fromSq, to: toSq, promotion: promo });
        if (engineMove) {
            sparringHistory.push(engineMove.san);
            board.position(sparringChess.fen(), true);
            
            const afterEval = await evaluateFen(sparringChess.fen(), 8, sparringChess.in_checkmate());
            afterEval.winPercentWhite = cpToWinPercent(afterEval.whiteCp);
            applyEvaluationToUI({ eval: afterEval, winPercentWhite: afterEval.winPercentWhite, is_checkmate: sparringChess.game_over() });
            
            document.querySelectorAll("#board .square-55d63").forEach(sq => sq.classList.remove("highlight-last-move"));
            document.querySelector(`#board .square-${fromSq}`)?.classList.add("highlight-last-move");
            document.querySelector(`#board .square-${toSq}`)?.classList.add("highlight-last-move");
            
            const gameOverText = sparringChess.in_checkmate()
                ? "🏆 CHECKMATE on the board!"
                : (sparringChess.in_draw() ? "½-½ Draw reached!" : `Your turn! (Best hint: <span class="text-[#4ade80] font-mono">${afterEval.bestMove}</span>)`);
                
            document.getElementById("match-status-label").textContent = `Engine played: ${engineMove.san}`;
            document.getElementById("ai-coach-box").innerHTML = `
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[#e6c875] font-bold uppercase text-xs">⚔️ Alternate Line (${sparringHistory.length} plies)</span>
                    <span class="font-mono text-xs text-[#4ade80]">Eval: ${afterEval.displayScore}</span>
                </div>
                <p class="text-[#f3ead8] font-mono text-xs bg-[#140d09] p-2 rounded border border-[#2e2017]">
                    ${sparringHistory.join(" → ")}
                </p>
                <p class="text-[#b5a48b] mt-2">${gameOverText}</p>
            `;
        }
    }
}

// --- 5. MULTI-GAME OPENING REPERTOIRE & FORMAT BREAKDOWN MODAL ---
async function openOpeningLeaksModal() {
    const username = document.getElementById("username-input").value.trim();
    const limit = document.getElementById("games-limit-select").value || 30;
    if (!username) return;
    
    const modal = document.getElementById("leaks-modal");
    const content = document.getElementById("leaks-content");
    const subtitle = document.getElementById("leaks-subtitle");
    
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    subtitle.textContent = `Inspecting last ${limit} games for ${username}...`;
    content.innerHTML = `<div class="text-center py-8 text-[#b5a48b] font-mono text-sm">⏳ Compiling opening & time-control ledger...</div>`;
    
    try {
        const res = await fetch(`/api/stats/${encodeURIComponent(username)}?limit=${limit}`);
        if (!res.ok) throw new Error("Failed to load opening statistics.");
        const data = await res.json();
        
        subtitle.textContent = `Compiled from ${data.games_analyzed} recent standard games for ${data.username}`;
        const w = data.color_stats.white;
        const b = data.color_stats.black;
        const wWinPct = w.total ? Math.round((w.wins / w.total) * 100) : 0;
        const bWinPct = b.total ? Math.round((b.wins / b.total) * 100) : 0;
        const bestOp = data.best_opening;
        const leakOp = data.biggest_leak;

        // Calculate Rapid / Blitz / Bullet Win Rates from loaded allGames
        const formatStats = {
            rapid: { wins: 0, total: 0, rating: "-" },
            blitz: { wins: 0, total: 0, rating: "-" },
            bullet: { wins: 0, total: 0, rating: "-" }
        };
        const searchedUser = username.toLowerCase();
        allGames.forEach(g => {
            const tc = (g.time_control || "").toLowerCase();
            if (formatStats[tc]) {
                const isWhite = g.white.username.toLowerCase() === searchedUser;
                const playerObj = isWhite ? g.white : g.black;
                formatStats[tc].total++;
                if (formatStats[tc].rating === "-") formatStats[tc].rating = playerObj.rating;
                if (playerObj.result === "win") formatStats[tc].wins++;
            }
        });
        const fmtPct = (obj) => obj.total ? `${Math.round((obj.wins / obj.total) * 100)}% (${obj.wins}/${obj.total})` : "No games";
        
        let rowsHtml = data.openings.map(op => `
            <tr class="border-b border-[#2e2017]">
                <td class="py-2 font-medium text-[#f3ead8]">${op.name}</td>
                <td class="py-2 text-center font-mono text-[#b5a48b]">${op.total}</td>
                <td class="py-2 text-center font-mono text-[#e6c875]">${op.wins}W / ${op.losses}L</td>
                <td class="py-2 text-right font-mono font-bold ${op.win_rate >= 50 ? 'text-[#4ade80]' : 'text-[#f87171]'}">${op.win_rate}%</td>
            </tr>
        `).join("");
        
        content.innerHTML = `
            <!-- Rapid / Blitz / Bullet Format Cards -->
            <div class="grid grid-cols-3 gap-3">
                <div class="wood-inset rounded-lg p-3 border border-[#3d2b1f] text-center">
                    <div class="text-[11px] font-bold uppercase text-[#c9a24d]">⏱️ Rapid</div>
                    <div class="text-lg font-black font-mono text-[#f3ead8] mt-0.5">ELO: ${formatStats.rapid.rating}</div>
                    <div class="text-[11px] font-mono text-[#4ade80] mt-0.5">Win: ${fmtPct(formatStats.rapid)}</div>
                </div>
                <div class="wood-inset rounded-lg p-3 border border-[#3d2b1f] text-center">
                    <div class="text-[11px] font-bold uppercase text-[#c9a24d]">⚡ Blitz</div>
                    <div class="text-lg font-black font-mono text-[#f3ead8] mt-0.5">ELO: ${formatStats.blitz.rating}</div>
                    <div class="text-[11px] font-mono text-[#4ade80] mt-0.5">Win: ${fmtPct(formatStats.blitz)}</div>
                </div>
                <div class="wood-inset rounded-lg p-3 border border-[#3d2b1f] text-center">
                    <div class="text-[11px] font-bold uppercase text-[#c9a24d]">🚀 Bullet</div>
                    <div class="text-lg font-black font-mono text-[#f3ead8] mt-0.5">ELO: ${formatStats.bullet.rating}</div>
                    <div class="text-[11px] font-mono text-[#4ade80] mt-0.5">Win: ${fmtPct(formatStats.bullet)}</div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="wood-inset rounded-lg p-3">
                    <div class="text-xs text-[#b5a48b] font-bold uppercase">⬜ White Pieces (${w.total} Games)</div>
                    <div class="text-xl font-black font-mono text-[#f3ead8] mt-1">${wWinPct}% Win Rate</div>
                    <div class="text-xs text-[#8c7a65] font-mono mt-0.5">${w.wins}W • ${w.draws}D • ${w.losses}L</div>
                </div>
                <div class="wood-inset rounded-lg p-3">
                    <div class="text-xs text-[#b5a48b] font-bold uppercase">⬛ Black Pieces (${b.total} Games)</div>
                    <div class="text-xl font-black font-mono text-[#f3ead8] mt-1">${bWinPct}% Win Rate</div>
                    <div class="text-xs text-[#8c7a65] font-mono mt-0.5">${b.wins}W • ${b.draws}D • ${b.losses}L</div>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="wood-inset border border-[#3e5c38] rounded-lg p-3">
                    <div class="text-[11px] font-bold uppercase text-[#4ade80]">🏆 Strongest Opening</div>
                    <div class="text-sm font-bold text-[#f3ead8] mt-1">${bestOp ? bestOp.name : '-'}</div>
                    <div class="text-xs text-[#4ade80] font-mono mt-0.5">${bestOp ? `${bestOp.win_rate}% Win Rate (${bestOp.wins}/${bestOp.total})` : ''}</div>
                </div>
                <div class="wood-inset border border-[#6e2c2c] rounded-lg p-3">
                    <div class="text-[11px] font-bold uppercase text-[#f87171]">⚠️ Main Opening Leak</div>
                    <div class="text-sm font-bold text-[#f3ead8] mt-1">${leakOp ? leakOp.name : '-'}</div>
                    <div class="text-xs text-[#f87171] font-mono mt-0.5">${leakOp ? `${leakOp.loss_rate}% Loss Rate (${leakOp.losses}/${leakOp.total})` : ''}</div>
                </div>
            </div>
            <div class="wood-inset rounded-lg p-4 max-h-48 overflow-y-auto">
                <table class="w-full text-xs">
                    <thead>
                        <tr class="text-[#8c7a65] uppercase border-b border-[#2e2017]">
                            <th class="text-left pb-2">Opening System</th>
                            <th class="text-center pb-2">Games</th>
                            <th class="text-center pb-2">Score</th>
                            <th class="text-right pb-2">Win %</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="text-[#f87171] text-xs">${err.message}</div>`;
    }
}

// --- 6. EXPORT MAHOGANY & BRASS MATCH CERTIFICATE ---
function downloadMatchSummaryPoster() {
    if (!currentGame) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 630);
    bgGrad.addColorStop(0, "#160f0a");
    bgGrad.addColorStop(0.5, "#241811");
    bgGrad.addColorStop(1, "#120c08");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 630);
    
    ctx.strokeStyle = "#c9a24d";
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, 1152, 582);
    ctx.strokeStyle = "#4a3527";
    ctx.lineWidth = 2;
    ctx.strokeRect(34, 34, 1132, 562);
    
    ctx.fillStyle = "#e6c875";
    ctx.font = "700 38px Cinzel, serif";
    ctx.fillText("♔ CHESSTURANGA", 65, 92);
    ctx.fillStyle = "#b5a48b";
    ctx.font = "600 18px JetBrains Mono, monospace";
    ctx.fillText("OFFICIAL GRANDMASTER GAME REVIEW LEDGER", 480, 88);
    
    const openingName = document.getElementById("opening-name-label").textContent;
    const tcLabel = (currentGame.time_control || "chess").toUpperCase();
    ctx.fillStyle = "#f3ead8";
    ctx.font = "500 22px Plus Jakarta Sans, sans-serif";
    ctx.fillText(`[${tcLabel}] ${openingName} • Result: ${currentGame.metadata.result}`, 65, 132);
    
    const wAcc = document.getElementById("white-accuracy").textContent;
    const bAcc = document.getElementById("black-accuracy").textContent;
    const wElo = document.getElementById("white-perf-elo").textContent;
    const bElo = document.getElementById("black-perf-elo").textContent;
    
    ctx.fillStyle = "#140d09";
    ctx.fillRect(65, 170, 510, 210);
    ctx.strokeStyle = "#3f2d21";
    ctx.strokeRect(65, 170, 510, 210);
    ctx.fillStyle = "#f3ead8";
    ctx.font = "700 26px Plus Jakarta Sans, sans-serif";
    ctx.fillText(`⬜ ${currentGame.white.username} (${currentGame.white.rating})`, 95, 222);
    ctx.fillStyle = "#e6c875";
    ctx.font = "800 64px JetBrains Mono, monospace";
    ctx.fillText(wAcc, 95, 302);
    ctx.fillStyle = "#b5a48b";
    ctx.font = "500 20px JetBrains Mono, monospace";
    ctx.fillText(`Accuracy • ${wElo}`, 95, 348);
    
    ctx.fillStyle = "#140d09";
    ctx.fillRect(625, 170, 510, 210);
    ctx.strokeRect(625, 170, 510, 210);
    ctx.fillStyle = "#f3ead8";
    ctx.font = "700 26px Plus Jakarta Sans, sans-serif";
    ctx.fillText(`⬛ ${currentGame.black.username} (${currentGame.black.rating})`, 655, 222);
    ctx.fillStyle = "#e6c875";
    ctx.font = "800 64px JetBrains Mono, monospace";
    ctx.fillText(bAcc, 655, 302);
    ctx.fillStyle = "#b5a48b";
    ctx.font = "500 20px JetBrains Mono, monospace";
    ctx.fillText(`Accuracy • ${bElo}`, 655, 348);
    
    ctx.fillStyle = "#140d09";
    ctx.fillRect(65, 412, 1070, 110);
    ctx.strokeRect(65, 412, 1070, 110);
    
    const wBril = document.getElementById("w-brilliant").textContent;
    const bBril = document.getElementById("b-brilliant").textContent;
    const wBest = document.getElementById("w-best").textContent;
    const bBest = document.getElementById("b-best").textContent;
    const wBlun = document.getElementById("w-blunder").textContent;
    const bBlun = document.getElementById("b-blunder").textContent;
    
    ctx.fillStyle = "#2dd4bf";
    ctx.font = "700 24px JetBrains Mono, monospace";
    ctx.fillText(`!! Brilliant: ${wBril} - ${bBril}`, 95, 475);
    ctx.fillStyle = "#4ade80";
    ctx.fillText(`★ Best Moves: ${wBest} - ${bBest}`, 455, 475);
    ctx.fillStyle = "#f87171";
    ctx.fillText(`?? Blunders: ${wBlun} - ${bBlun}`, 835, 475);
    
    ctx.fillStyle = "#8c7a65";
    ctx.font = "600 17px Plus Jakarta Sans, sans-serif";
    ctx.fillText("Analyzed with CHESSTURANGA — Open-Source Stockfish Study", 65, 568);
    
    const link = document.createElement("a");
    link.download = `Chessturanga_${currentGame.white.username}_vs_${currentGame.black.username}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
}

// --- 7. SVG Arrow & Floating Badge Renderer ---
function squareToCoords(square) {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    const col = boardOrientation === "white" ? file : 7 - file;
    const row = boardOrientation === "white" ? 7 - rank : rank;
    return {
        x: col * 100 + 50,
        y: row * 100 + 50,
        cornerX: col * 100 + 82,
        cornerY: row * 100 + 22
    };
}

function resetSvgDefs() {
    const svg = document.getElementById("arrow-overlay");
    if (!svg) return null;
    svg.innerHTML = `
        <defs>
            <marker id="arrow-green" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
                <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#22c55e" />
            </marker>
            <marker id="arrow-red" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
                <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#ef4444" />
            </marker>
            <marker id="arrow-cyan" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
                <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#14b8a6" />
            </marker>
        </defs>
    `;
    return svg;
}

function renderBoardAnnotations(posData) {
    const svg = resetSvgDefs();
    if (!svg || !posData || isPuzzleMode) return;
    if (posData.uci && posData.uci.length >= 4) {
        const fromSq = posData.uci.substring(0, 2);
        const toSq = posData.uci.substring(2, 4);
        if (posData.grade && posData.grade.key === "brilliant") {
            drawSvgArrow(svg, fromSq, toSq, "#14b8a6", "arrow-cyan", 0.95);
        } else if (posData.grade && posData.grade.loss > 5.5) {
            drawSvgArrow(svg, fromSq, toSq, "#ef4444", "arrow-red", 0.78);
            if (posData.recommendedBestUci && posData.recommendedBestUci.length >= 4) {
                const bFrom = posData.recommendedBestUci.substring(0, 2);
                const bTo = posData.recommendedBestUci.substring(2, 4);
                drawSvgArrow(svg, bFrom, bTo, "#22c55e", "arrow-green", 0.92);
            }
        } else if (posData.eval && posData.eval.bestMove && posData.eval.bestMove.length >= 4) {
            const nextFrom = posData.eval.bestMove.substring(0, 2);
            const nextTo = posData.eval.bestMove.substring(2, 4);
            drawSvgArrow(svg, nextFrom, nextTo, "#22c55e", "arrow-green", 0.65);
        }
        if (posData.grade) {
            drawSquareBadge(svg, toSq, posData.grade);
        }
    }
}

function drawSvgArrow(svg, fromSq, toSq, color, markerId, opacity = 0.85) {
    const start = squareToCoords(fromSq);
    const end = squareToCoords(toSq);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const shorten = 28;
    const targetX = end.x - (dx / len) * shorten;
    const targetY = end.y - (dy / len) * shorten;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", targetX);
    line.setAttribute("y2", targetY);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "18");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", opacity);
    line.setAttribute("marker-end", `url(#${markerId})`);
    svg.appendChild(line);
}

function drawSquareBadge(svg, square, grade) {
    const coords = squareToCoords(square);
    const colorMap = {
        "Brilliant": "#0d9488",
        "Great": "#2563eb",
        "Best": "#16a34a",
        "Excellent": "#65a30d",
        "Inaccuracy": "#d97706",
        "Mistake": "#ea580c",
        "Blunder": "#dc2626"
    };
    const bg = colorMap[grade.label] || "#c9a24d";
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", coords.cornerX);
    circle.setAttribute("cy", coords.cornerY);
    circle.setAttribute("r", grade.label === "Brilliant" ? "23" : "20");
    circle.setAttribute("fill", bg);
    circle.setAttribute("stroke", "#140d09");
    circle.setAttribute("stroke-width", "4");
    svg.appendChild(circle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", coords.cornerX);
    text.setAttribute("y", coords.cornerY + 6);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("font-size", "18");
    text.setAttribute("font-weight", "900");
    text.setAttribute("font-family", "JetBrains Mono, monospace");
    text.textContent = grade.symbol;
    svg.appendChild(text);
}

// --- 8. Smooth Advantage Timeline Chart ---
function initEvalChart() {
    const ctx = document.getElementById("eval-chart").getContext("2d");
    evalChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: ["Start"],
            datasets: [{
                label: "White Win %",
                data: [50],
                borderColor: "#c9a24d",
                borderWidth: 2,
                fill: true,
                backgroundColor: "rgba(201, 162, 77, 0.2)",
                pointRadius: 0,
                pointHoverRadius: 5,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            onClick: (event, elements) => {
                if (elements.length > 0 && currentGame && !isPuzzleMode) {
                    updateBoardAtPly(elements[0].index);
                }
            },
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: "rgba(201, 162, 77, 0.08)" },
                    ticks: { display: false }
                }
            }
        }
    });
}

function updateEvalChartData() {
    if (!evalChart || !currentGame) return;
    evalChart.data.labels = currentGame.positions.map(p => p.ply === 0 ? "Start" : `${p.move_number}. ${p.san}`);
    evalChart.data.datasets[0].data = currentGame.positions.map(p => p.winPercentWhite ?? 50);
    evalChart.update("none");
}

// --- 9. Stockfish Web Worker ---
async function initStockfishEngine() {
    try {
        const stockfishUrl = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
        const response = await fetch(stockfishUrl);
        const scriptText = await response.text();
        const blob = new Blob([scriptText], { type: "application/javascript" });
        stockfish = new Worker(URL.createObjectURL(blob));
        let latestDepthInfo = { scoreCp: 0, mate: null, bestMove: "-" };
        stockfish.onmessage = (event) => {
            const line = String(event.data || "");
            if (line === "uciok" || line === "readyok") isEngineReady = true;
            if (line.startsWith("info depth")) {
                const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
                const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
                if (scoreMatch) {
                    const type = scoreMatch[1];
                    const val = parseInt(scoreMatch[2], 10);
                    if (type === "cp") {
                        latestDepthInfo.scoreCp = val;
                        latestDepthInfo.mate = null;
                    } else if (type === "mate") {
                        latestDepthInfo.mate = val;
                        latestDepthInfo.scoreCp = val > 0 ? 10000 : -10000;
                    }
                }
                if (pvMatch) latestDepthInfo.bestMove = pvMatch[1];
            }
            if (line.startsWith("bestmove")) {
                const bmParts = line.split(" ");
                if (bmParts[1] && bmParts[1] !== "(none)") {
                    latestDepthInfo.bestMove = bmParts[1];
                } else {
                    latestDepthInfo.bestMove = "-";
                }
                if (currentEvalResolver) {
                    const resolve = currentEvalResolver;
                    currentEvalResolver = null;
                    const snapshot = { ...latestDepthInfo };
                    latestDepthInfo = { scoreCp: 0, mate: null, bestMove: "-" };
                    resolve(snapshot);
                }
            }
        };
        stockfish.postMessage("uci");
        stockfish.postMessage("isready");
    } catch (err) {
        console.error("Failed to initialize Stockfish worker:", err);
    }
}

function evaluateFen(fen, depth = 9, isCheckmate = false) {
    return new Promise((resolve) => {
        const fenParts = fen.split(" ");
        const sideToMove = fenParts[1];
        if (isCheckmate) {
            const whiteWon = sideToMove === "b";
            resolve({
                whiteCp: whiteWon ? 10000 : -10000,
                whiteMate: 0,
                displayScore: whiteWon ? "1-0" : "0-1",
                bestMove: "Checkmate"
            });
            return;
        }
        if (typeof Chess !== "undefined") {
            const tempChess = new Chess(fen);
            if (tempChess.game_over()) {
                if (tempChess.in_checkmate()) {
                    const whiteWon = sideToMove === "b";
                    resolve({
                        whiteCp: whiteWon ? 10000 : -10000,
                        whiteMate: 0,
                        displayScore: whiteWon ? "1-0" : "0-1",
                        bestMove: "Checkmate"
                    });
                    return;
                }
                resolve({ whiteCp: 0, whiteMate: null, displayScore: "1/2", bestMove: "Draw" });
                return;
            }
        }
        if (!stockfish || !isEngineReady) {
            resolve({ whiteCp: 0, whiteMate: null, displayScore: "+0.0", bestMove: "-" });
            return;
        }
        const timeoutId = setTimeout(() => {
            if (currentEvalResolver) {
                currentEvalResolver = null;
                stockfish.postMessage("stop");
                resolve({ whiteCp: 0, whiteMate: null, displayScore: "0.0", bestMove: "-" });
            }
        }, 2000);
        currentEvalResolver = (rawResult) => {
            clearTimeout(timeoutId);
            const multiplier = sideToMove === "w" ? 1 : -1;
            const whiteCp = rawResult.scoreCp * multiplier;
            const whiteMate = rawResult.mate !== null ? rawResult.mate * multiplier : null;
            let displayScore = "+0.0";
            if (whiteMate !== null) {
                displayScore = whiteMate === 0
                    ? (sideToMove === "w" ? "0-1" : "1-0")
                    : `${whiteMate > 0 ? "+M" : "-M"}${Math.abs(whiteMate)}`;
            } else {
                const pawns = (whiteCp / 100).toFixed(1);
                displayScore = `${whiteCp >= 0 ? "+" : ""}${pawns}`;
            }
            resolve({
                whiteCp: whiteMate === 0 ? (sideToMove === "w" ? -10000 : 10000) : whiteCp,
                whiteMate,
                displayScore,
                bestMove: rawResult.bestMove
            });
        };
        stockfish.postMessage(`position fen ${fen}`);
        stockfish.postMessage(`go depth ${depth}`);
    });
}

function cpToWinPercent(cp) {
    const clamped = Math.max(-1500, Math.min(1500, cp));
    return 100 / (1 + Math.exp(-0.00368208 * clamped));
}

// --- 10. Move Classification ---
function classifyMove(winPercentBefore, winPercentAfter, moverColor, pos) {
    const loss = moverColor === "white"
        ? Math.max(0, winPercentBefore - winPercentAfter)
        : Math.max(0, winPercentAfter - winPercentBefore);
    const moverWinAfter = moverColor === "white" ? winPercentAfter : 100 - winPercentAfter;
    const bestUci = pos.recommendedBestUci;
    if (pos.is_sacrifice_candidate && loss <= 2.5 && moverWinAfter >= 42) {
        return {
            label: "Brilliant",
            key: "brilliant",
            symbol: "!!",
            badgeClass: "bg-[#0d9488]/30 text-[#5eead4] border border-[#2dd4bf] font-black",
            loss
        };
    }
    if (pos.uci === bestUci && (pos.is_capture || pos.is_check) && loss <= 1.2) {
        return {
            label: "Great",
            key: "great",
            symbol: "!",
            badgeClass: "bg-[#2563eb]/30 text-[#93c5fd] border border-[#60a5fa] font-bold",
            loss
        };
    }
    if (loss <= 2.0) return { label: "Best", key: "best", symbol: "★", badgeClass: "bg-[#16a34a]/25 text-[#86efac] border border-[#22c55e]", loss };
    if (loss <= 5.5) return { label: "Excellent", key: "excellent", symbol: "✓", badgeClass: "bg-[#65a30d]/25 text-[#bef264]", loss };
    if (loss <= 11.0) return { label: "Inaccuracy", key: "inaccuracy", symbol: "?!", badgeClass: "bg-[#d97706]/25 text-[#fde047]", loss };
    if (loss <= 20.0) return { label: "Mistake", key: "mistake", symbol: "?", badgeClass: "bg-[#ea580c]/25 text-[#fdba74]", loss };
    return { label: "Blunder", key: "blunder", symbol: "??", badgeClass: "bg-[#dc2626]/35 text-[#fca5a5] border border-[#ef4444] font-bold", loss };
}

// --- 11. Fast, Non-Blocking Full Match Analysis ---
async function analyzeFullGame() {
    if (!currentGame || isFullAnalysisRunning) return;
    isFullAnalysisRunning = true;
    isPuzzleMode = false;
    if (liveEvalTimer) clearTimeout(liveEvalTimer);
    if (currentEvalResolver) {
        currentEvalResolver = null;
        stockfish.postMessage("stop");
    }
    const btn = document.getElementById("analyze-game-btn");
    const progressWrap = document.getElementById("analysis-progress-wrap");
    const progressBar = document.getElementById("analysis-progress-bar");
    const percentText = document.getElementById("analysis-percent-text");
    const statusText = document.getElementById("analysis-status-text");
    btn.disabled = true;
    btn.classList.add("opacity-50");
    progressWrap.classList.remove("hidden");
    const positions = currentGame.positions;
    const total = positions.length;
    
    for (let i = 0; i < total; i++) {
        statusText.textContent = `Reviewing Ply ${i} of ${total - 1}...`;
        const pct = Math.round(((i + 1) / total) * 100);
        progressBar.style.width = `${pct}%`;
        percentText.textContent = `${pct}%`;
        if (!positions[i].eval) {
            const evalData = await evaluateFen(positions[i].fen, 9, positions[i].is_checkmate);
            positions[i].eval = evalData;
            positions[i].winPercentWhite = cpToWinPercent(evalData.whiteCp);
        }
    }
    
    const counts = {
        white: { brilliant: 0, great: 0, best: 0, excellent: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
        black: { brilliant: 0, great: 0, best: 0, excellent: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
    };
    let whiteAccSum = 0, whiteMoves = 0;
    let blackAccSum = 0, blackMoves = 0;
    let biggestTurningPoint = null;
    let firstBrilliantMove = null;
    
    for (let i = 1; i < total; i++) {
        const prev = positions[i - 1];
        const curr = positions[i];
        curr.recommendedBestUci = prev.eval.bestMove;
        const grade = classifyMove(prev.winPercentWhite, curr.winPercentWhite, curr.turn, curr);
        curr.grade = grade;
        counts[curr.turn][grade.key]++;
        
        if (grade.key === "brilliant" && !firstBrilliantMove) {
            firstBrilliantMove = curr;
        }
        const moveAcc = Math.max(0, 100 - grade.loss * 2.2);
        if (curr.turn === "white") {
            whiteAccSum += moveAcc;
            whiteMoves++;
        } else {
            blackAccSum += moveAcc;
            blackMoves++;
        }
        if (!biggestTurningPoint || grade.loss > biggestTurningPoint.grade.loss) {
            biggestTurningPoint = curr;
        }
    }
    
    const wAcc = whiteMoves ? (whiteAccSum / whiteMoves) : 100;
    const bAcc = blackMoves ? (blackAccSum / blackMoves) : 100;
    document.getElementById("white-accuracy").textContent = `${wAcc.toFixed(1)}%`;
    document.getElementById("black-accuracy").textContent = `${bAcc.toFixed(1)}%`;
    
    const wEstElo = Math.round(Math.max(200, currentGame.white.rating + (wAcc - 70) * 14));
    const bEstElo = Math.round(Math.max(200, currentGame.black.rating + (bAcc - 70) * 14));
    document.getElementById("white-perf-elo").textContent = `Est. ELO: ~${wEstElo}`;
    document.getElementById("black-perf-elo").textContent = `Est. ELO: ~${bEstElo}`;
    
    ["brilliant", "great", "best", "excellent", "inaccuracy", "mistake", "blunder"].forEach(k => {
        document.getElementById(`w-${k}`).textContent = counts.white[k];
        document.getElementById(`b-${k}`).textContent = counts.black[k];
    });
    
    const tpCard = document.getElementById("turning-point-card");
    let htmlSpotlight = "";
    if (firstBrilliantMove) {
        htmlSpotlight += `
            <div class="mb-3 pb-3 border-b border-[#3d2b1f]">
                <div class="font-bold text-[#2dd4bf] uppercase mb-1 flex items-center justify-between">
                    <span>💎 !! Brilliant Sacrifice</span>
                    <span class="font-mono text-[10px] px-2 py-0.5 rounded bg-[#0d9488]/20">Move ${firstBrilliantMove.move_number}</span>
                </div>
                <p class="text-[#f3ead8]">
                    <strong>${firstBrilliantMove.turn.toUpperCase()}</strong> played the sacrifice <span class="font-mono font-bold text-[#2dd4bf]">${firstBrilliantMove.san}</span>!
                </p>
                <button onclick="updateBoardAtPly(${firstBrilliantMove.ply})" class="mt-2 w-full brass-btn py-1.5 rounded text-xs font-bold">
                    Inspect Brilliant Move (${firstBrilliantMove.san})
                </button>
            </div>
        `;
    }
    if (biggestTurningPoint && biggestTurningPoint.grade.loss > 10) {
        htmlSpotlight += `
            <div class="font-bold text-[#f87171] uppercase mb-1 flex items-center justify-between">
                <span>⚠️ Critical Turning Point</span>
                <span class="font-mono text-[10px] text-[#fca5a5]">-${biggestTurningPoint.grade.loss.toFixed(1)}% Win Loss</span>
            </div>
            <p class="text-[#e6dac3]">
                Move <strong>${biggestTurningPoint.move_number} (${biggestTurningPoint.turn.toUpperCase()})</strong>.<br/>
                Playing <span class="font-mono font-bold text-[#f87171]">${biggestTurningPoint.san}</span> surrendered the advantage.
                Best continuation was <span class="font-mono font-bold text-[#4ade80]">${biggestTurningPoint.recommendedBestUci}</span>.
            </p>
            <button onclick="updateBoardAtPly(${biggestTurningPoint.ply})" class="mt-2 w-full wood-btn border-[#c9a24d] py-1.5 rounded text-xs font-bold">
                Jump to Move ${biggestTurningPoint.move_number} (${biggestTurningPoint.san})
            </button>
        `;
    }
    if (htmlSpotlight) {
        tpCard.classList.remove("hidden");
        tpCard.innerHTML = htmlSpotlight;
    }
    
    statusText.textContent = "✓ Complete Scorebook Annotated";
    btn.disabled = false;
    btn.classList.remove("opacity-50");
    isFullAnalysisRunning = false;
    
    updateEvalChartData();
    renderMoveList();
    updateBoardAtPly(firstBrilliantMove ? firstBrilliantMove.ply : (biggestTurningPoint ? biggestTurningPoint.ply : 0));
}

// --- 12. DAILY PUZZLE & BLUNDER RETRY ---
async function startDailyPuzzleMode() {
    const puzzleBtn = document.getElementById("daily-puzzle-btn");
    try {
        puzzleBtn.textContent = "⏳ Loading...";
        const response = await fetch("/api/daily-puzzle");
        if (!response.ok) throw new Error("Could not load today's study puzzle.");
        dailyPuzzleData = await response.json();
        dailyStepIndex = 0;
        isPuzzleMode = true;
        puzzleModeType = "daily";
        boardOrientation = dailyPuzzleData.player_color;
        initChessboard(true, dailyPuzzleData.initial_fen);
        resetSvgDefs();
        
        document.getElementById("exit-sparring-btn").classList.add("hidden");
        document.getElementById("puzzle-hint-btn").classList.remove("hidden");
        document.getElementById("retry-blunder-btn").classList.add("hidden");
        document.getElementById("top-player-label").textContent = "Daily Tactical Study";
        document.getElementById("bottom-player-label").textContent = `To Move: ${dailyPuzzleData.player_color.toUpperCase()}`;
        document.getElementById("match-status-label").textContent = dailyPuzzleData.title;
        document.getElementById("ai-coach-box").innerHTML = `
            <div class="text-[#e6c875] font-bold uppercase text-xs mb-1">🧩 "${dailyPuzzleData.title}"</div>
            <p class="text-[#f3ead8]">
                <strong>${dailyPuzzleData.player_color.toUpperCase()} to move.</strong><br/>
                Drag the pieces on the wooden board to execute the winning tactical combination.
            </p>
        `;
    } catch (err) {
        alert(err.message);
    } finally {
        puzzleBtn.innerHTML = `<span>🧩 Daily Study Puzzle</span>`;
    }
}

function showDailyPuzzleHint() {
    if (!isPuzzleMode || puzzleModeType !== "daily" || !dailyPuzzleData) return;
    const step = dailyPuzzleData.solution[dailyStepIndex];
    if (!step) return;
    const hintFromSq = step.uci.substring(0, 2);
    const svg = resetSvgDefs();
    const coords = squareToCoords(hintFromSq);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", coords.x);
    circle.setAttribute("cy", coords.y);
    circle.setAttribute("r", "42");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "#e6c875");
    circle.setAttribute("stroke-width", "8");
    circle.setAttribute("stroke-dasharray", "14 8");
    svg.appendChild(circle);
}

function startBlunderRetryPuzzle() {
    if (!currentGame || currentPly === 0) return;
    const blunderPos = currentGame.positions[currentPly];
    const prevPos = currentGame.positions[currentPly - 1];
    if (!blunderPos.recommendedBestUci || blunderPos.recommendedBestUci === "-") return;
    
    isPuzzleMode = true;
    puzzleModeType = "blunder";
    puzzleTargetUci = blunderPos.recommendedBestUci;
    initChessboard(true, prevPos.fen);
    resetSvgDefs();
    
    document.getElementById("ai-coach-box").innerHTML = `
        <div class="text-[#e6c875] font-bold uppercase text-xs mb-1">🎯 Position Replay Active</div>
        <p class="text-[#f3ead8]">
            Instead of <strong class="text-[#f87171] font-mono">${blunderPos.san}</strong>, drag the pieces on the board to find Stockfish's best move!
        </p>
    `;
}

function handleInteractivePieceDrop(source, target) {
    if (!isPuzzleMode) return "snapback";
    const attemptedUci = `${source}${target}`;
    
    // Mode A: Live Sparring vs Stockfish ("Play From Here")
    if (puzzleModeType === "sparring" && sparringChess) {
        const attemptedMove = sparringChess.move({ from: source, to: target, promotion: "q" });
        if (!attemptedMove) return "snapback";
        
        sparringHistory.push(attemptedMove.san);
        board.position(sparringChess.fen(), false);
        
        if (sparringChess.game_over()) {
            document.getElementById("match-status-label").textContent = "🏆 Game Over!";
            return;
        }
        setTimeout(makeStockfishSparringReply, 350);
        return;
    }
    
    // Mode B: Daily Puzzle Multi-Step
    if (puzzleModeType === "daily" && dailyPuzzleData) {
        const expectedStep = dailyPuzzleData.solution[dailyStepIndex];
        if (!expectedStep) return "snapback";
        if (expectedStep.uci.startsWith(attemptedUci)) {
            resetSvgDefs();
            dailyStepIndex++;
            if (dailyStepIndex >= dailyPuzzleData.solution.length) {
                isPuzzleMode = false;
                document.getElementById("puzzle-hint-btn").classList.add("hidden");
                setTimeout(() => {
                    initChessboard(false, expectedStep.fen_after);
                    document.getElementById("match-status-label").textContent = "✓ Solved!";
                    document.getElementById("ai-coach-box").innerHTML = `
                        <div class="text-[#4ade80] font-bold text-sm mb-1">🏆 Combination Solved! (${expectedStep.san})</div>
                        <p class="text-[#e6dac3]">Well calculated. Select any match on the left to return to your game ledger.</p>
                    `;
                }, 180);
                return;
            }
            const opponentReply = dailyPuzzleData.solution[dailyStepIndex];
            document.getElementById("ai-coach-box").innerHTML = `
                <div class="text-[#4ade80] font-bold text-xs mb-1">✓ Correct (${expectedStep.san})!</div>
                <p class="text-[#e6dac3]">Opponent replies <strong class="font-mono text-[#e6c875]">${opponentReply.san}</strong>. Continue...</p>
            `;
            setTimeout(() => {
                dailyStepIndex++;
                initChessboard(true, opponentReply.fen_after);
            }, 400);
            return;
        } else {
            document.getElementById("ai-coach-box").innerHTML = `
                <div class="text-[#f87171] font-bold text-xs mb-1">✕ Incorrect (${attemptedUci})</div>
                <p class="text-[#b5a48b]">Look for a more forcing check, capture, or tactical threat.</p>
            `;
            return "snapback";
        }
    }
    
    // Mode C: Single-Move Blunder Retry
    if (puzzleModeType === "blunder") {
        if (puzzleTargetUci && puzzleTargetUci.startsWith(attemptedUci)) {
            isPuzzleMode = false;
            setTimeout(() => {
                initChessboard(false, currentGame.positions[currentPly].fen);
                updateBoardAtPly(currentPly);
                document.getElementById("ai-coach-box").innerHTML = `
                    <div class="text-[#4ade80] font-bold text-sm mb-1">✓ Found It! (${puzzleTargetUci})</div>
                    <p class="text-[#e6dac3]">That was the exact top Stockfish continuation.</p>
                `;
            }, 300);
            return;
        } else {
            return "snapback";
        }
    }
    return "snapback";
}

// --- 13. Fetch, Categorize (Rapid / Blitz / Bullet) & Load Games ---
async function fetchUserGames() {
    const usernameInput = document.getElementById("username-input").value.trim();
    const limitSelect = document.getElementById("games-limit-select");
    const limit = limitSelect ? limitSelect.value : 30;
    const loadBtn = document.getElementById("load-games-btn");
    
    if (!usernameInput) return;
    try {
        loadBtn.textContent = "Loading...";
        loadBtn.disabled = true;
        const response = await fetch(`/api/games/${encodeURIComponent(usernameInput)}?limit=${limit}`);
        if (!response.ok) throw new Error("Player not found on Chess.com.");
        
        const data = await response.json();
        allGames = data.games;

        // Update Category Counts (All / Rapid / Blitz / Bullet)
        const counts = { all: allGames.length, rapid: 0, blitz: 0, bullet: 0 };
        allGames.forEach(g => {
            const tc = (g.time_control || "").toLowerCase();
            if (counts[tc] !== undefined) counts[tc]++;
        });

        const setCountText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setCountText("count-all", counts.all);
        setCountText("count-rapid", counts.rapid);
        setCountText("count-blitz", counts.blitz);
        setCountText("count-bullet", counts.bullet);

        // Apply active Time Control filter and populate dropdown
        setTimeControlFilter(selectedTimeControl);
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        loadBtn.textContent = "Load Archives";
        loadBtn.disabled = false;
    }
}

function setTimeControlFilter(tcCategory) {
    selectedTimeControl = tcCategory;

    // Highlight active category tab button
    document.querySelectorAll(".tc-filter-btn").forEach(btn => {
        const isSelected = btn.getAttribute("data-tc") === tcCategory;
        btn.className = isSelected
            ? "tc-filter-btn brass-btn rounded py-1 text-[10px] font-bold uppercase tracking-wider flex flex-col items-center leading-tight"
            : "tc-filter-btn wood-btn rounded py-1 text-[10px] font-semibold uppercase tracking-wider flex flex-col items-center leading-tight";
    });

    // Filter games by selected category
    filteredGames = tcCategory === "all"
        ? allGames
        : allGames.filter(g => (g.time_control || "").toLowerCase() === tcCategory);

    const selectEl = document.getElementById("game-select");
    selectEl.innerHTML = "";

    const badgeEl = document.getElementById("games-count-badge");
    if (badgeEl) {
        const label = tcCategory === "all" ? "Total" : tcCategory.toUpperCase();
        badgeEl.textContent = `${filteredGames.length} ${label}`;
    }

    if (filteredGames.length === 0) {
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = `No ${tcCategory.toUpperCase()} games in loaded archive`;
        selectEl.appendChild(emptyOpt);
        return;
    }

    const tcIconMap = { rapid: "⏱️", blitz: "⚡", bullet: "🚀" };
    filteredGames.forEach((game, index) => {
        const w = game.white;
        const b = game.black;
        const tcRaw = (game.time_control || "chess").toLowerCase();
        const icon = tcIconMap[tcRaw] || "♟️";
        const tc = tcRaw.toUpperCase();
        const res = game.metadata.result;
        const option = document.createElement("option");
        option.value = index;
        option.textContent = `${icon} [${tc}] ${w.username} (${w.rating}) vs ${b.username} (${b.rating}) ${res}`;
        selectEl.appendChild(option);
    });

    selectEl.value = 0;
    loadGameIntoBoard(0);
}

function onGameSelected(event) {
    const gameIndex = parseInt(event.target.value, 10);
    if (!isNaN(gameIndex)) loadGameIntoBoard(gameIndex);
}

function updatePlayerBarLabels() {
    if (!currentGame) return;
    const whiteText = `${currentGame.white.username} (${currentGame.white.rating})`;
    const blackText = `${currentGame.black.username} (${currentGame.black.rating})`;
    if (boardOrientation === "white") {
        document.getElementById("bottom-player-label").textContent = whiteText;
        document.getElementById("top-player-label").textContent = blackText;
    } else {
        document.getElementById("bottom-player-label").textContent = blackText;
        document.getElementById("top-player-label").textContent = whiteText;
    }
}

function loadGameIntoBoard(index) {
    currentGame = filteredGames[index];
    if (!currentGame) return;
    currentPly = 0;
    isPuzzleMode = false;
    document.getElementById("exit-sparring-btn")?.classList.add("hidden");
    document.getElementById("puzzle-hint-btn")?.classList.add("hidden");
    
    const searchedUser = document.getElementById("username-input").value.trim().toLowerCase();
    boardOrientation = currentGame.black.username.toLowerCase() === searchedUser ? "black" : "white";
    initChessboard(false, "start");
    updatePlayerBarLabels();
    
    document.getElementById("white-card-name").textContent = `⬜ ${currentGame.white.username}`;
    document.getElementById("black-card-name").textContent = `⬛ ${currentGame.black.username}`;
    document.getElementById("white-accuracy").textContent = "--%";
    document.getElementById("black-accuracy").textContent = "--%";
    document.getElementById("white-perf-elo").textContent = `Rating: ${currentGame.white.rating}`;
    document.getElementById("black-perf-elo").textContent = `Rating: ${currentGame.black.rating}`;
    
    ["brilliant", "great", "best", "excellent", "inaccuracy", "mistake", "blunder"].forEach(k => {
        document.getElementById(`w-${k}`).textContent = "0";
        document.getElementById(`b-${k}`).textContent = "0";
    });
    
    document.getElementById("turning-point-card").classList.add("hidden");
    document.getElementById("analysis-progress-wrap").classList.add("hidden");
    
    const openingName = currentGame.metadata.eco_url
        ? currentGame.metadata.eco_url.split("/").pop().replace(/-/g, " ")
        : currentGame.metadata.eco;
        
    const tcRaw = (currentGame.time_control || "chess").toLowerCase();
    const tcBadgeMap = {
        rapid: "⏱️ RAPID",
        blitz: "⚡ BLITZ",
        bullet: "🚀 BULLET"
    };
    const tcBadgeText = tcBadgeMap[tcRaw] || tcRaw.toUpperCase();

    document.getElementById("opening-name-label").textContent = `${currentGame.metadata.eco} • ${openingName}`;
    document.getElementById("game-meta").innerHTML = `
        <div class="flex justify-between items-center">
            <span>Date: ${currentGame.metadata.date}</span>
            <span class="px-2 py-0.5 rounded bg-[#140d09] border border-[#3d2b1f] text-[#e6c875] font-mono text-[10px]">${tcBadgeText}</span>
            <span class="text-[#e6c875] font-bold">${currentGame.metadata.result}</span>
        </div>
    `;
    
    renderMoveList();
    updateEvalChartData();
    updateBoardAtPly(0);
}

function renderMoveList() {
    const container = document.getElementById("moves-container");
    container.innerHTML = "";
    const positions = currentGame.positions;
    const fragment = document.createDocumentFragment();
    
    for (let i = 1; i < positions.length; i += 2) {
        const whitePos = positions[i];
        const blackPos = positions[i + 1];
        const row = document.createElement("div");
        row.className = "grid grid-cols-7 items-center py-1 px-2 rounded hover:bg-[#251a13]";
        const numSpan = document.createElement("span");
        numSpan.className = "col-span-1 text-[#8c7a65] text-[11px]";
        numSpan.textContent = `${whitePos.move_number}.`;
        row.appendChild(numSpan);
        row.appendChild(createMoveButton(whitePos));
        if (blackPos) row.appendChild(createMoveButton(blackPos));
        fragment.appendChild(row);
    }
    container.appendChild(fragment);
}

function createMoveButton(pos) {
    const btn = document.createElement("button");
    btn.id = `ply-btn-${pos.ply}`;
    btn.className = "col-span-3 flex items-center justify-between px-2 py-1 rounded transition text-[#f3ead8] hover:bg-[#33241b]";
    btn.onclick = () => updateBoardAtPly(pos.ply);
    const sanSpan = document.createElement("span");
    sanSpan.textContent = pos.san;
    btn.appendChild(sanSpan);
    if (pos.grade) {
        const badge = document.createElement("span");
        badge.className = `text-[10px] px-1.5 py-0.2 rounded ml-1 ${pos.grade.badgeClass}`;
        badge.textContent = pos.grade.symbol;
        btn.appendChild(badge);
    }
    return btn;
}

function stepMove(delta) {
    if (!currentGame) return;
    const targetPly = currentPly + delta;
    if (targetPly >= 0 && targetPly <= currentGame.total_plies) {
        updateBoardAtPly(targetPly);
    }
}

// --- 14. Ultra-Smooth Debounced Board Updater ---
function updateBoardAtPly(ply) {
    if (isPuzzleMode) {
        isPuzzleMode = false;
        document.getElementById("exit-sparring-btn")?.classList.add("hidden");
        document.getElementById("puzzle-hint-btn")?.classList.add("hidden");
        initChessboard(false, currentGame.positions[ply].fen);
    }
    currentPly = ply;
    const posData = currentGame.positions[ply];
    
    // 1. Instant visual piece movement
    board.position(posData.fen, true);
    document.getElementById("ply-label").textContent = `Ply ${ply} / ${currentGame.total_plies}`;
    
    // 2. Highlight squares smoothly
    document.querySelectorAll("#board .square-55d63").forEach(sq => {
        sq.classList.remove("highlight-last-move", "highlight-brilliant-sq");
    });
    if (posData.uci && posData.uci.length >= 4) {
        const f = posData.uci.substring(0, 2);
        const t = posData.uci.substring(2, 4);
        const highlightClass = (posData.grade && posData.grade.key === "brilliant") ? "highlight-brilliant-sq" : "highlight-last-move";
        document.querySelector(`#board .square-${f}`)?.classList.add(highlightClass);
        document.querySelector(`#board .square-${t}`)?.classList.add(highlightClass);
    }
    
    // 3. Status label
    const statusEl = document.getElementById("match-status-label");
    if (ply === 0) {
        statusEl.textContent = "Starting Position";
    } else if (posData.grade && posData.grade.key === "brilliant") {
        statusEl.textContent = `💎 !! Brilliant (${posData.san})`;
    } else if (posData.is_checkmate) {
        statusEl.textContent = `Checkmate (${posData.san})`;
    } else {
        statusEl.textContent = `Move ${posData.move_number}: ${posData.san}`;
    }
    
    // 4. Scorebook active button highlight
    document.querySelectorAll("[id^='ply-btn-']").forEach(btn => {
        btn.classList.remove("bg-[#c9a24d]", "text-[#140e0a]", "font-bold");
    });
    if (ply > 0) {
        const activeBtn = document.getElementById(`ply-btn-${ply}`);
        if (activeBtn) {
            activeBtn.classList.add("bg-[#c9a24d]", "text-[#140e0a]", "font-bold");
            activeBtn.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }
    
    // 5. Render cached evaluation & arrows immediately if available
    if (posData.eval) {
        applyEvaluationToUI(posData);
    } else if (!isFullAnalysisRunning) {
        // Debounce live engine evaluation so fast arrow-key tapping never lags!
        if (liveEvalTimer) clearTimeout(liveEvalTimer);
        liveEvalTimer = setTimeout(async () => {
            document.getElementById("engine-best-move").textContent = "Calculating...";
            posData.eval = await evaluateFen(posData.fen, 9, posData.is_checkmate);
            posData.winPercentWhite = cpToWinPercent(posData.eval.whiteCp);
            if (currentPly === ply) applyEvaluationToUI(posData);
        }, 120);
    }
    requestAnimationFrame(() => renderBoardAnnotations(posData));
    updateCoachNotes(posData);
}

function applyEvaluationToUI(posData) {
    document.getElementById("eval-score").textContent = posData.eval.displayScore;
    document.getElementById("eval-bar-text").textContent = posData.eval.displayScore;
    document.getElementById("engine-best-move").textContent = posData.is_checkmate
        ? "Checkmate"
        : `Best: ${posData.eval.bestMove}`;
    const whitePct = posData.winPercentWhite ?? 50;
    document.getElementById("eval-bar-white").style.height = `${whitePct}%`;
    document.getElementById("eval-bar-black").style.height = `${100 - whitePct}%`;
}

function updateCoachNotes(posData) {
    const coachBox = document.getElementById("ai-coach-box");
    const retryBtn = document.getElementById("retry-blunder-btn");
    if (posData.grade) {
        const isBadMove = posData.grade.loss > 5.5;
        retryBtn.classList.toggle("hidden", !isBadMove);
        let commentary = `Accurate positional move maintaining balance.`;
        let spokenCommentary = `${sanToSpokenWords(posData.san)}. ${posData.grade.label}.`;
        
        if (posData.grade.key === "brilliant") {
            commentary = `💎 <strong>BRILLIANT SACRIFICE!</strong> Offered material while finding a top Stockfish tactical continuation.`;
            spokenCommentary = `Brilliant sacrifice! ${sanToSpokenWords(posData.san)}.`;
        } else if (posData.grade.key === "great") {
            commentary = `⚡ <strong>GREAT MOVE!</strong> Found the strongest forcing tactical continuation.`;
        } else if (isBadMove) {
            commentary = `Lost <strong>${posData.grade.loss.toFixed(1)}%</strong> win expectancy (<span class="text-[#4ade80] font-mono">Best: ${posData.recommendedBestUci}</span>). Click <strong>⚔️ Play From Here</strong> above to play out the better line against Stockfish!`;
            spokenCommentary = `${posData.grade.label} on move ${posData.move_number}. ${sanToSpokenWords(posData.san)}.`;
        }
        
        coachBox.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-bold text-sm text-[#f3ead8]">${posData.move_number}. ${posData.san} (${posData.turn.toUpperCase()})</span>
                <span class="px-2 py-0.5 rounded text-xs ${posData.grade.badgeClass}">${posData.grade.symbol} ${posData.grade.label}</span>
            </div>
            <p class="mt-2 text-[#e6dac3]">${commentary}</p>
        `;
        if (!isFullAnalysisRunning) speakText(spokenCommentary);
    } else {
        retryBtn.classList.add("hidden");
    }
}