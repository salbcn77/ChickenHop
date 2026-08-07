import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA4I-xmAnaR06oqKP5qViy_73z4W2-dCfA",
  authDomain: "chicken-hop-22d52.firebaseapp.com",
  projectId: "chicken-hop-22d52",
  storageBucket: "chicken-hop-22d52.firebasestorage.app",
  messagingSenderId: "12272625138",
  appId: "1:12272625138:web:2bfb2c235e05744f41f76b",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const scoresCol = collection(db, "scores");

const VALID_MODES = ["story", "random"];
const VALID_TIME_MODES = ["normal", "time"];
const VALID_TIME_LIMITS = [0, 30, 60, 120, 180];

async function submitScore({ name, score, mode, timeMode, timeLimit }) {
  const cleanTimeLimit = timeMode === "time" ? timeLimit : 0;
  if (!VALID_MODES.includes(mode)) throw new Error("invalid mode");
  if (!VALID_TIME_MODES.includes(timeMode)) throw new Error("invalid timeMode");
  if (!VALID_TIME_LIMITS.includes(cleanTimeLimit)) throw new Error("invalid timeLimit");

  await addDoc(scoresCol, {
    name: String(name || "Anónimo").slice(0, 20),
    score: Math.max(0, Math.floor(score)),
    mode,
    timeMode,
    timeLimit: cleanTimeLimit,
    createdAt: serverTimestamp(),
  });
}

// Historia/Difícil each get their own board (endless runs only); every
// Contrarreloj run — whichever path mode or time limit — lands in one
// shared "timeattack" board, since that's the grouping that makes sense
// to compare against friends.
function categoryOf(mode, timeMode) {
  return timeMode === "time" ? "timeattack" : mode;
}

// Filtering by category client-side (instead of a Firestore `where` on a
// stored field) avoids needing a composite index, and works for scores
// written before this field existed — cheap enough at this game's scale.
async function fetchTop(category, n = 10) {
  const q = query(scoresCol, orderBy("score", "desc"), limit(200));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data())
    .filter((s) => categoryOf(s.mode, s.timeMode) === category)
    .slice(0, n);
}

async function qualifiesForTop(category, score, n = 10) {
  const top = await fetchTop(category, n);
  if (top.length < n) return true;
  return score > top[top.length - 1].score;
}

window.ChickenLeaderboard = { submitScore, fetchTop, qualifiesForTop, categoryOf };
