const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// Nomi Perks
const BONUS_LIST = ["INIZIALI", "MINUTAGGIO", "FURTO", "SKIP"];
const MALUS_LIST = ["CANTALE", "CATEGORIA", "ZITTO", "4/5"];

// Nomi Squadre
let teamNames = {
  A: "Squadra Rossa",
  B: "Squadra Blu",
};

// Stato del Gioco
let buzzerQueue = [];
let scores = { A: 0, B: 0 };
let songsList = [];
let playedSongIds = [];
let currentSong = null;
let selectedCategories = [];
let turnIndex = 0;
let turnPattern = [];
let leadingTeam = "A";
let customStartTimes = {};

let perksState = {
  A: {
    bonus: [false, false, false, false],
    malus: [false, false, false, false],
  },
  B: {
    bonus: [false, false, false, false],
    malus: [false, false, false, false],
  },
};

io.on("connection", (socket) => {
  console.log(`🔌 Connesso: ${socket.id}`);

  socket.emit("initGameState", {
    buzzerQueue,
    scores,
    teamNames,
    progressCount: playedSongIds.length,
    totalSongs: songsList.length,
    currentSong,
    selectedCategories,
    perksState,
    customStartTimes,
  });

  socket.on("updateTeamNames", (names) => {
    if (names.A && names.A.trim()) teamNames.A = names.A.trim();
    if (names.B && names.B.trim()) teamNames.B = names.B.trim();
    io.emit("teamNamesUpdated", teamNames);
  });

  socket.on("registerPlayer", (data) => {
    if (!data) return;
    socket.data.playerName = data.name || "Giocatore";
    socket.data.teamKey = data.teamKey || "A";
    socket.data.team =
      teamNames[socket.data.teamKey] ||
      (socket.data.teamKey === "A" ? teamNames.A : teamNames.B);
  });

  socket.on("pressBuzzer", (data) => {
    if (data && data.name) socket.data.playerName = data.name;
    if (data && data.teamKey) {
      socket.data.teamKey = data.teamKey;
      socket.data.team = teamNames[data.teamKey];
    }

    const teamKey = socket.data.teamKey || (data && data.teamKey) || "A";
    const team = teamNames[teamKey] || "Senza Squadra";
    const name = socket.data.playerName || (data && data.name) || "Giocatore";

    const alreadyBuzzed = buzzerQueue.some(
      (item) => item.socketId === socket.id,
    );

    if (!alreadyBuzzed) {
      const now = new Date();
      const timeStr =
        now.toLocaleTimeString("it-IT", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) +
        "." +
        String(now.getMilliseconds()).padStart(3, "0");

      buzzerQueue.push({
        socketId: socket.id,
        name: name,
        team: team,
        teamKey: teamKey,
        time: timeStr,
      });
      io.emit("buzzerQueueUpdated", buzzerQueue);
    }
  });

  socket.on("loadTop30Songs", (songs) => {
    songsList = songs;
    playedSongIds = [];
    currentSong = null;
    buzzerQueue = [];
    io.emit("top30Reset", { totalSongs: songsList.length });
    io.emit("buzzerQueueUpdated", buzzerQueue);
  });

  socket.on("playNextRandomSong", () => {
    const remainingSongs = songsList.filter(
      (song) => !playedSongIds.includes(song.id),
    );

    if (remainingSongs.length === 0) {
      io.emit("top30Finished");
      return;
    }

    const randomIndex = Math.floor(Math.random() * remainingSongs.length);
    currentSong = remainingSongs[randomIndex];
    playedSongIds.push(currentSong.id);

    buzzerQueue = [];
    io.emit("buzzerQueueUpdated", buzzerQueue);

    io.emit("newSongExtracted", {
      song: currentSong,
      progressCount: playedSongIds.length,
      totalSongs: songsList.length,
    });
  });

  socket.on("resetBuzzerQueue", () => {
    buzzerQueue = [];
    io.emit("buzzerQueueUpdated", buzzerQueue);
  });

  socket.on("updateScore", ({ team, amount }) => {
    if (scores[team] !== undefined) {
      scores[team] = Math.max(0, scores[team] + amount);
      io.emit("scoreUpdated", scores);
    }
  });

  socket.on("startPhase2", () => {
    leadingTeam = scores.B > scores.A ? "B" : "A";
    const otherTeam = leadingTeam === "A" ? "B" : "A";

    turnPattern = [
      leadingTeam,
      otherTeam,
      otherTeam,
      leadingTeam,
      leadingTeam,
      otherTeam,
      otherTeam,
      leadingTeam,
      leadingTeam,
      otherTeam,
    ];

    turnIndex = 0;

    io.emit("phase2Started", {
      turnPattern,
      currentTurnTeam: turnPattern[turnIndex],
      turnIndex,
      perksState,
    });
  });

  socket.on("selectCategory", (categoryId) => {
    if (!selectedCategories.includes(categoryId)) {
      selectedCategories.push(categoryId);

      io.emit("categorySelectedForHost", {
        categoryId,
        selectedCategories,
        currentTurnTeam: turnPattern[turnIndex],
      });
    }
  });

  socket.on("finishCategoryRound", () => {
    turnIndex++;
    const nextTeam = turnPattern[turnIndex] || null;

    if (selectedCategories.length >= 10 || !nextTeam) {
      let winnerText = "";
      let winnerKey = null;

      if (scores.A > scores.B) {
        winnerText = `🏆 ${teamNames.A} vince la partita con ${scores.A} punti!`;
        winnerKey = "A";
      } else if (scores.B > scores.A) {
        winnerText = `🏆 ${teamNames.B} vince la partita con ${scores.B} punti!`;
        winnerKey = "B";
      } else {
        winnerText = `🤝 Parità perfetta! Entrambe le squadre hanno totalizzato ${scores.A} punti!`;
        winnerKey = "DRAW";
      }

      io.emit("gameFinishedWinnerProclaimed", {
        winnerText,
        winnerKey,
        scores,
        teamNames,
      });
    } else {
      io.emit("returnToCategoryGrid", {
        turnIndex,
        currentTurnTeam: nextTeam,
        selectedCategories,
      });
    }
  });

  socket.on("usePerk", ({ team, type, index }) => {
    if (perksState[team] && perksState[team][type] !== undefined) {
      perksState[team][type][index] = !perksState[team][type][index];
      io.emit("perkUpdated", perksState);
    }
  });

  socket.on("updateCategoryStartTime", ({ categoryId, newStartTime }) => {
    customStartTimes[categoryId] = parseInt(newStartTime, 10) || 0;
    io.emit("categoryStartTimeUpdated", {
      categoryId,
      newStartTime: customStartTimes[categoryId],
    });
  });

  socket.on("triggerTimerStart", (data) => {
    const seconds = data && data.duration ? parseInt(data.duration, 10) : 5;
    io.emit("startTimerOnClients", { duration: seconds });
  });

  socket.on("triggerTimerStop", () => {
    io.emit("stopTimerOnClients");
  });

  socket.on("resetFullGame", () => {
    scores = { A: 0, B: 0 };
    playedSongIds = [];
    currentSong = null;
    selectedCategories = [];
    turnIndex = 0;
    turnPattern = [];
    buzzerQueue = [];
    customStartTimes = {};
    teamNames = { A: "Squadra Rossa", B: "Squadra Blu" };

    perksState = {
      A: {
        bonus: [false, false, false, false],
        malus: [false, false, false, false],
      },
      B: {
        bonus: [false, false, false, false],
        malus: [false, false, false, false],
      },
    };

    io.emit("gameResetCompleted", {
      scores,
      perksState,
      teamNames,
    });
  });

  socket.on("disconnect", () => {
    console.log(`❌ Disconnesso: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 ALEBANDA in ascolto su porta ${PORT}`);
});
