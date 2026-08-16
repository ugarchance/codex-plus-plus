const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Set up temporary USER_DATA_DIR for test isolation before loading modules
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-test-routing-"));
process.env.USER_DATA_DIR = testDataDir;

const routing = require("../hub/routing.cjs");

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;

function formatVal(v) {
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

function assertEqual(label, actual, expected) {
  totalTests++;
  const match = actual === expected;
  if (match) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
    console.log(`         Beklenen : ${formatVal(expected)}`);
    console.log(`         Gercek   : ${formatVal(actual)}`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
    console.log(`         Beklenen : ${formatVal(expected)}`);
    console.log(`         Gercek   : ${formatVal(actual)}`);
  }
}

function assertClose(label, actual, expected, tol = 1e-9) {
  totalTests++;
  const diff = Math.abs(actual - expected);
  const match = diff <= tol;
  if (match) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
    console.log(`         Beklenen : ${expected.toFixed(8)}`);
    console.log(`         Gercek   : ${actual.toFixed(8)} (fark: ${diff.toExponential(2)})`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
    console.log(`         Beklenen : ${expected.toFixed(8)}`);
    console.log(`         Gercek   : ${actual.toFixed(8)} (fark: ${diff.toExponential(2)})`);
  }
}

function assertTruthy(label, condition, detail = "") {
  totalTests++;
  if (Boolean(condition)) {
    totalPassed++;
    console.log(`  [PASS] ${label} ${detail}`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label} ${detail}`);
  }
}

console.log("===============================================================");
console.log("             CODEX++ ROUTING ACCEPTANCE TEST SUITE            ");
console.log("===============================================================\n");

// ---------------------------------------------------------------------------
// T1. UYGUNLUK MATRISI (Eligibility Matrix)
// ---------------------------------------------------------------------------
console.log("--- T1: Uygunluk Matrisi Testleri ---");
console.log("Politika Notu: Whitelist politikasi. Taninmayan plan stringleri disari (false) alinir.");

const t1Cases = [
  { account: { id: "acc-free", planType: "free" }, expected: false, note: "free -> disari" },
  { account: { id: "acc-go", planType: "go" }, expected: false, note: "go -> disari" },
  { account: { id: "acc-plus", planType: "plus" }, expected: true, note: "plus -> iceri" },
  { account: { id: "acc-pro", planType: "pro" }, expected: true, note: "pro -> iceri" },
  { account: { id: "acc-team", planType: "team" }, expected: true, note: "team -> iceri" },
  { account: { id: "acc-business", planType: "business" }, expected: true, note: "business -> iceri" },
  { account: { id: "acc-edu", planType: "edu" }, expected: true, note: "edu -> iceri" },
  { account: { id: "acc-prolite", planType: "prolite" }, expected: true, note: "prolite -> iceri" },
  { account: { id: "acc-ent26", planType: "ent26" }, expected: true, note: "ent26 -> iceri" },
  { account: { id: "acc-null", planType: null }, expected: true, note: "planType null -> iceri (dusuk oncelik)" },
  { account: { id: "acc-undef", planType: undefined }, expected: true, note: "planType undefined -> iceri (dusuk oncelik)" },
  { account: { id: "acc-unknown", planType: "some_unrecognized_custom_tier" }, expected: false, note: "taninmayan plan stringi -> disari (whitelist)" },
  { account: { id: "acc-learned-blocked", planType: "pro" }, learned: new Set(["acc-learned-blocked"]), expected: false, note: "ogrenilmis uygunsuz (learned) -> disari" }
];

for (const c of t1Cases) {
  const actual = routing.isEligible(c.account, c.learned);
  assertEqual(`T1: ${c.note}`, actual, c.expected);
}

// ---------------------------------------------------------------------------
// T2. SKORLAMA (Urgency Scoring Formula)
// ---------------------------------------------------------------------------
console.log("\n--- T2: Skorlama Formulu Testleri ---");
const now = 1700000000000;

// Senaryo 1: kalan %50 (kullanilan %50), resete 24 saat, 0 kredi -> 50 / 24 = 2.0833333333333335
const s1Pencere = { usedPercent: 50, resetsAt: now + 24 * 60 * 60 * 1000 };
const s1Expected = 50 / 24;
const s1Actual = routing.urgencyScore(s1Pencere, 0, now);
assertClose("T2 Senaryo 1 (kalan 50%, 24 saat, 0 kredi)", s1Actual, s1Expected);

// Senaryo 2: kalan %50 (kullanilan %50), resete 24 saat, 2 kredi (carpan 1 + 0.15*2 = 1.3) -> (50/24)*1.3 = 2.7083333333333335
const s2Pencere = { usedPercent: 50, resetsAt: now + 24 * 60 * 60 * 1000 };
const s2Expected = (50 / 24) * 1.3;
const s2Actual = routing.urgencyScore(s2Pencere, 2, now);
assertClose("T2 Senaryo 2 (kalan 50%, 24 saat, 2 kredi -> carpan 1.3)", s2Actual, s2Expected);

// Senaryo 3: kalan %70 (kullanilan %30), resete 12 saat, 4 kredi (tavan 3 -> carpan 1 + 0.15*3 = 1.45) -> (70/12)*1.45 = 8.458333333333334
const s3Pencere = { usedPercent: 30, resetsAt: now + 12 * 60 * 60 * 1000 };
const s3Expected = (70 / 12) * 1.45;
const s3Actual = routing.urgencyScore(s3Pencere, 4, now);
assertClose("T2 Senaryo 3 (kalan 70%, 12 saat, 4 kredi -> tavan 3, carpan 1.45)", s3Actual, s3Expected);

// Kenar Durumlari: usedPercent >= 100 -> null; usedPercent == null -> Infinity; reset zamani gecmis -> alt sinir 1 dk
assertEqual("T2 Kenar 1: usedPercent 100% -> null (aday degil)", routing.urgencyScore({ usedPercent: 100 }, 0, now), null);
assertEqual("T2 Kenar 2: usedPercent 110% -> null (aday degil)", routing.urgencyScore({ usedPercent: 110 }, 0, now), null);
assertEqual("T2 Kenar 3: usedPercent null -> Infinity (dusuk oncelik)", routing.urgencyScore({ usedPercent: null }, 0, now), Infinity);

// ---------------------------------------------------------------------------
// T3. HESAP SECIMI (chooseAccount)
// ---------------------------------------------------------------------------
console.log("\n--- T3: chooseAccount Testleri ---");

const pool3 = [
  { id: "acc-100-full", planType: "plus", usedPercent: 100, resetsAt: now + 24 * 3600 * 1000 },
  { id: "acc-free", planType: "free", usedPercent: 10, resetsAt: now + 24 * 3600 * 1000 },
  { id: "acc-plus-40", planType: "plus", usedPercent: 40, resetsAt: now + 24 * 3600 * 1000 }
];

const selected = routing.chooseAccount(pool3, null, null, now);
assertTruthy("T3: 3 hesapli havuzdan plus %40 secildi", selected !== null && (selected.accountId === "acc-plus-40" || selected.account?.id === "acc-plus-40"));
console.log("  [SEBEP JSON]:", JSON.stringify(selected?.reason, null, 2));

// Excluded kumesi testi (acc-plus-40 haric tutuldugunda havuzda baska uygun aday kalmaz)
const excludedSelected = routing.chooseAccount(pool3, new Set(["acc-plus-40"]), null, now);
assertEqual("T3 Excluded kumesi: secili hesap haric tutuldugunda null doner", excludedSelected, null);

// Bos havuz testi
const emptySelected = routing.chooseAccount([], null, null, now);
assertEqual("T3 Bos havuz: null doner", emptySelected, null);

// Beraberlik bozucu (Tie-breaker) testi: short window usage & thread count
const poolTie = [
  { id: "acc-a", planType: "pro", usedPercent: 50, resetsAt: now + 24 * 3600 * 1000, shortUsedPercent: 30, threadCount: 2 },
  { id: "acc-b", planType: "pro", usedPercent: 50, resetsAt: now + 24 * 3600 * 1000, shortUsedPercent: 10, threadCount: 5 }, // daha dusuk kisa pencere
  { id: "acc-c", planType: "pro", usedPercent: 50, resetsAt: now + 24 * 3600 * 1000, shortUsedPercent: 10, threadCount: 1 }  // ayni kisa pencere, daha az thread
];
const tieSelected = routing.chooseAccount(poolTie, null, null, now);
assertEqual("T3 Tie-breaker: esit urgencylerde once kisa pencere, sonra thread sayisi (acc-c)", tieSelected?.accountId, "acc-c");

// ---------------------------------------------------------------------------
// T4. ROUTING.JSON DEPOSU & ATOMIK YAZIM
// ---------------------------------------------------------------------------
console.log("\n--- T4: routing.json Deposu ve Atomik Yazim Testleri ---");

const testFile = routing.routingPath();
const initialData = {
  version: 1,
  threadOwner: { "thread-alpha": "acc-plus-40" },
  learnedIneligible: { "acc-broken": "429_quota" },
  autoRoute: true
};

routing.writeRouting(initialData);
const readBack = routing.readRouting();

assertEqual("T4: routing.json yaz/oku roundtrip version", readBack.version, 1);
assertEqual("T4: routing.json threadOwner eslesmesi", readBack.threadOwner["thread-alpha"], "acc-plus-40");
assertEqual("T4: routing.json learnedIneligible eslesmesi", readBack.learnedIneligible["acc-broken"], "429_quota");
assertEqual("T4: routing.json autoRoute degeri", readBack.autoRoute, true);

// Dosya izin modu kontrolu (0600)
const stats = fs.statSync(testFile);
const modeOctal = (stats.mode & 0o777).toString(8);
assertEqual("T4: routing.json dosya modu 0600 (veya 600 octal)", modeOctal, "600");

// Kod icinde atomik yazim kaniti
const sourceCode = fs.readFileSync(path.join(__dirname, "../hub/routing.cjs"), "utf8");
const hasAtomicTmp = sourceCode.includes(".tmp") && sourceCode.includes("renameSync");
assertTruthy("T4: Kodda tmp+renameSync atomik yazim yapisi mevcut", hasAtomicTmp);

// ---------------------------------------------------------------------------
// T5. IDEMPOTANS (learnThreadOwner)
// ---------------------------------------------------------------------------
console.log("\n--- T5: Idempotans Testleri ---");

routing.learnThreadOwner("thread-beta", "acc-pro-1");
const contentAfterFirst = fs.readFileSync(testFile, "utf8");
const statAfterFirst = fs.statSync(testFile);

// Ikinci kez ayni veriyle cagrilinca dosya degismemeli
routing.learnThreadOwner("thread-beta", "acc-pro-1");
const contentAfterSecond = fs.readFileSync(testFile, "utf8");
const statAfterSecond = fs.statSync(testFile);

assertEqual("T5: Ayni learnThreadOwner cagrisi sonrasi dosya icerigi degismez (diff bos)", contentAfterSecond, contentAfterFirst);
assertEqual("T5: Ikinci cagri dosya mtime'ini degistirmez (gereksiz I/O onlendi)", statAfterSecond.mtimeMs, statAfterFirst.mtimeMs);

// ---------------------------------------------------------------------------
// T6. DOCS/ROUTING-ANCHORS.MD MEVCUDIYET VE HAM ESLESMELER
// ---------------------------------------------------------------------------
console.log("\n--- T6: docs/routing-anchors.md Belgesi ve Capa Dogrulama ---");

const docsPath = path.join(__dirname, "../docs/routing-anchors.md");
const docExists = fs.existsSync(docsPath);
assertTruthy("T6: docs/routing-anchors.md dosyasi mevcut", docExists);

if (docExists) {
  const docContent = fs.readFileSync(docsPath, "utf8");
  assertTruthy("T6: Yuzey I (Engine->View) belgede mevcut", docContent.includes("Yüzey I: Engine → View") || docContent.includes("Yuzey I: Engine -> View"));
  assertTruthy("T6: Yuzey II (Turn Hata / Limit Banner) belgede mevcut", docContent.includes("Yüzey II: Turn Hata") || docContent.includes("Yuzey II: Turn Hata"));
  assertTruthy("T6: Yuzey III (Yeni Sohbet UI) belgede mevcut", docContent.includes("Yüzey III: Yeni Sohbet") || docContent.includes("Yuzey III: Yeni Sohbet"));
  assertTruthy("T6: Ham grep -c ciktilari belgede mevcut", docContent.includes("grep -c"));
}

// ---------------------------------------------------------------------------
// OZET RAPOR
// ---------------------------------------------------------------------------
console.log("\n===============================================================");
console.log(`TEST SONUCU: Toplam: ${totalTests}, Gecen: ${totalPassed}, Basarisiz: ${totalFailed}`);
console.log(`TOPLAM UYUMSUZLUK (Mismatches): ${totalFailed}`);
console.log("===============================================================");

// Cleanup test temp dir
try {
  fs.rmSync(testDataDir, { recursive: true, force: true });
} catch {}

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
