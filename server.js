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

// Nomi dei Perks per il logging
const BONUS_LIST = ["INIZIALI", "MINUTAGGIO", "FURTO", "SKIP"];
const MALUS_LIST = ["CANTALE", "CATEGORIA", "ZITTO", "4/5"];

// Nomi Squadre Personalizzabili
let teamNames = {
  A: "Squadra Rossa",
  B: "Squadra Blu",
};

// Stato del Gioco in Memoria
let buzzerQueue = [];
let scores = { A: 0, B: 0 };
let songsList = [];
let playedSongIds = [];
let currentSong = null;
let selectedCategories = [];
let turnIndex = 0;
let turnPattern = [];
let leadingTeam = "A";

// Mappa per salvare le modifiche del Minutaggio dinamico sulle categorie
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
  console.log(`🔌 Dispositivo connesso: ${socket.id}`);

  // Invia lo stato iniziale al client appena connesso
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

  // PERSONALIZZAZIONE NOMI SQUADRE
  socket.on("updateTeamNames", (names) => {
    if (names.A && names.A.trim()) teamNames.A = names.A.trim();
    if (names.B && names.B.trim()) teamNames.B = names.B.trim();
    io.emit("teamNamesUpdated", teamNames);
    console.log(`🏷️ Nomi Squadre aggiornati: ${teamNames.A} vs ${teamNames.B}`);
  });

  // 1. REGISTRAZIONE GIOCATORE
  socket.on("registerPlayer", (data) => {
    socket.data.playerName = data.name || "Giocatore";
    socket.data.teamKey = data.teamKey; // 'A' o 'B'
    socket.data.team =
      teamNames[data.teamKey] ||
      (data.teamKey === "A" ? teamNames.A : teamNames.B);
    console.log(
      `👤 Registrato: ${socket.data.playerName} (${socket.data.team})`,
    );
  });

  // 2. PRESSIONE BUZZER (Fase 1)
  socket.on("pressBuzzer", () => {
    const teamKey = socket.data.teamKey || "A";
    const team = teamNames[teamKey] || "Senza Squadra";
    const name = socket.data.playerName || "Giocatore";

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

      const buzzerEntry = {
        socketId: socket.id,
        name: name,
        team: team,
        teamKey: teamKey,
        time: timeStr,
      };

      buzzerQueue.push(buzzerEntry);
      io.emit("buzzerQueueUpdated", buzzerQueue);
      console.log(
        `🔔 BUZZER! #${buzzerQueue.length} - ${name} (${team}) a ${timeStr}`,
      );
    }
  });

  // 3. FASE 1: CARICAMENTO TOP 30
  socket.on("loadTop30Songs", (songs) => {
    songsList = songs;
    playedSongIds = [];
    currentSong = null;
    buzzerQueue = [];
    io.emit("top30Reset", { totalSongs: songsList.length });
    io.emit("buzzerQueueUpdated", buzzerQueue);
    console.log(`🎵 Caricate ${songsList.length} canzoni per la Top 30`);
  });

  // 4. FASE 1: ESTRAZIONE CANZONE
  socket.on("playNextRandomSong", () => {
    const remainingSongs = songsList.filter(
      (song) => !playedSongIds.includes(song.id),
    );

    if (remainingSongs.length === 0) {
      io.emit("top30Finished");
      console.log("🏆 Top 30 Completata!");
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

    console.log(
      `▶️ Estratta traccia #${playedSongIds.length}/${songsList.length}: ${currentSong.title}`,
    );
  });

  // 5. RESET CODA BUZZER
  socket.on("resetBuzzerQueue", () => {
    buzzerQueue = [];
    io.emit("buzzerQueueUpdated", buzzerQueue);
    console.log("🧹 Coda Buzzer azzerata dal Presentatore");
  });

  // 6. AGGIORNAMENTO PUNTEGGI
  socket.on("updateScore", ({ team, amount }) => {
    if (scores[team] !== undefined) {
      scores[team] = Math.max(0, scores[team] + amount);
      io.emit("scoreUpdated", scores);
      console.log(
        `🏆 Punteggi aggiornati: ${teamNames.A} ${scores.A} | ${teamNames.B} ${scores.B}`,
      );
    }
  });

  // 7. FASE 2: AVVIO SELEZIONE CATEGORIE
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
    console.log(
      `🚀 Iniziata Fase 2. Squadra in vantaggio: ${teamNames[leadingTeam]}`,
    );
  });

  // 8. FASE 2: SELEZIONE CATEGORIA
  socket.on("selectCategory", (categoryId) => {
    if (!selectedCategories.includes(categoryId)) {
      selectedCategories.push(categoryId);

      io.emit("categorySelectedForHost", {
        categoryId,
        selectedCategories,
        currentTurnTeam: turnPattern[turnIndex],
      });
      console.log(`📁 Selezionata categoria #${categoryId}`);
    }
  });

  // 9. FASE 2: FINE ROUND CATEGORIA
  socket.on("finishCategoryRound", () => {
    turnIndex++;
    const nextTeam = turnPattern[turnIndex] || null;

    io.emit("returnToCategoryGrid", {
      turnIndex,
      currentTurnTeam: nextTeam,
      selectedCategories,
    });
  });

  // 10. FASE 2: USO / RIATTIVAZIONE BONUS E MALUS (Toggle ON/OFF)
  socket.on("usePerk", ({ team, type, index }) => {
    if (perksState[team] && perksState[team][type] !== undefined) {
      perksState[team][type][index] = !perksState[team][type][index];

      io.emit("perkUpdated", perksState);

      const perkName = type === "bonus" ? BONUS_LIST[index] : MALUS_LIST[index];
      const statusStr = perksState[team][type][index]
        ? "UTILIZZATO"
        : "RIATTIVATO";
      console.log(
        `🔄 Squadra ${teamNames[team]} - ${type.toUpperCase()} '${perkName}': ${statusStr}`,
      );
    }
  });

  // 11. BONUS MINUTAGGIO: AGGIORNAMENTO SECONDI DI AVVIO CATEGORIA
  socket.on("updateCategoryStartTime", ({ categoryId, newStartTime }) => {
    customStartTimes[categoryId] = parseInt(newStartTime, 10) || 0;
    io.emit("categoryStartTimeUpdated", {
      categoryId,
      newStartTime: customStartTimes[categoryId],
    });
    console.log(
      `⏱️ Categoria #${categoryId} aggiornata con nuovo Minutaggio di avvio: ${customStartTimes[categoryId]}s`,
    );
  });

  // 12. SINCRONIZZAZIONE TIMER PERSONALIZZATO HOST
  socket.on("triggerTimerStart", (data) => {
    const seconds = data && data.duration ? parseInt(data.duration, 10) : 5;
    io.emit("startTimerOnClients", { duration: seconds });
  });

  socket.on("triggerTimerStop", () => {
    io.emit("stopTimerOnClients");
  });

  // 13. RESET COMPLETO DI TUTTA LA PARTITA
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

    console.log("🧹 PARTITA COMPLETAMENTE AZZERATA DALL'HOST!");
  });

  socket.on("disconnect", () => {
    console.log(`❌ Dispositivo disconnesso: ${socket.id}`);
  });
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const localIp = getLocalIp();
  console.log(`\n==================================================`);
  console.log(`🚀 SERVER ALEBANDA AVVIATO CON SUCCESSO!`);
  console.log(`📺 PC / Schermo Host:   http://localhost:${PORT}`);
  console.log(`📱 Smartphone (Wi-Fi):  http://${localIp}:${PORT}`);
  console.log(`==================================================\n`);
});
