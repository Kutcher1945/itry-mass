// ============================================================
//  Risk Engine — self-regulating layer for iTry Message Sender
//  Stores all data in chrome.storage.local (no server needed)
// ============================================================

const RISK_KEY        = 'RISK_SESSION';
const DAILY_KEY       = 'RISK_DAILY';
const WARMUP_KEY      = 'RISK_WARMUP';

const RISK_THRESHOLDS = {
    LOW:    20,
    MEDIUM: 45,
    HIGH:   65
};

// Daily limits (per calendar day)
const DAILY_LIMITS = {
    HARD: 150,   // absolute max — stop sending
    WARN: 100    // show warning but continue
};

// Warmup schedule — day N of account life → max messages that day
const WARMUP_SCHEDULE = [
    { day: 1,  max: 10  },
    { day: 2,  max: 20  },
    { day: 3,  max: 35  },
    { day: 5,  max: 50  },
    { day: 7,  max: 75  },
    { day: 10, max: 100 },
    { day: 14, max: 150 }
    // after day 14 — full DAILY_LIMITS.HARD applies
];

// ---- In-memory session state (reset on each bulk send) ----
let riskSession = {
    totalSent:    0,
    newContacts:  0,
    sessionStart: Date.now(),
    lastScore:    0
};

// ============================================================
//  PUBLIC API
// ============================================================

/**
 * Call before every send attempt.
 * Returns { score, level, delay, shouldStop, reason }
 */
async function riskCheck(phoneNumber) {
    // 1. Daily limit check
    const daily = await getDailyStats();
    const warmupLimit = await getWarmupLimit();
    const effectiveLimit = Math.min(warmupLimit, DAILY_LIMITS.HARD);

    if (daily.sentToday >= effectiveLimit) {
        return {
            score: 100, level: 'HIGH', delay: null, shouldStop: true,
            reason: `daily_limit`,
            detail: `Дневной лимит: ${daily.sentToday}/${effectiveLimit} сообщений`
        };
    }

    // 2. Risk score check
    const isNew = await isNewContact(phoneNumber);
    if (isNew) riskSession.newContacts++;
    riskSession.totalSent++;

    await incrementDailyCount();

    const score = calculateScore();
    riskSession.lastScore = score;
    await persistSession();

    const level      = getLevel(score);
    const delay      = getDynamicDelay(score);
    const shouldStop = score >= RISK_THRESHOLDS.HIGH;

    console.log(`[RiskEngine] score=${score} level=${level} daily=${daily.sentToday + 1}/${effectiveLimit} newRatio=${newContactRatio().toFixed(2)}`);

    return {
        score, level, delay, shouldStop,
        reason: shouldStop ? 'risk_score' : 'ok',
        detail: ''
    };
}

/** Reset in-memory session (call at start of each bulk send) */
function resetRiskSession() {
    riskSession = {
        totalSent:    0,
        newContacts:  0,
        sessionStart: Date.now(),
        lastScore:    0
    };
    console.log('[RiskEngine] Session reset');
}

/** Full stats snapshot for analytics UI */
async function getRiskStats() {
    const daily      = await getDailyStats();
    const warmupDay  = await getWarmupDay();
    const warmupLim  = await getWarmupLimit();
    const effectiveLim = Math.min(warmupLim, DAILY_LIMITS.HARD);

    return {
        // Session
        score:           riskSession.lastScore,
        level:           getLevel(riskSession.lastScore),
        totalSent:       riskSession.totalSent,
        newContacts:     riskSession.newContacts,
        repeatContacts:  Math.max(0, riskSession.totalSent - riskSession.newContacts),
        newContactRatio: newContactRatio(),
        sessionMinutes:  Math.floor((Date.now() - riskSession.sessionStart) / 60000),
        msgPerHour:      msgPerHour(),
        // Daily
        sentToday:       daily.sentToday,
        dailyLimit:      effectiveLim,
        dailyWarnLimit:  DAILY_LIMITS.WARN,
        dailyRemaining:  Math.max(0, effectiveLim - daily.sentToday),
        // Warmup
        warmupDay:       warmupDay,
        isWarmup:        warmupDay <= 14,
        warmupLimit:     warmupLim
    };
}

/** Initialize warmup on first install (call once) */
async function initWarmup() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get(WARMUP_KEY, resolve);
        });
        if (!result[WARMUP_KEY]) {
            await new Promise(resolve => {
                chrome.storage.local.set({
                    [WARMUP_KEY]: JSON.stringify({ installDate: Date.now() })
                }, resolve);
            });
            console.log('[RiskEngine] Warmup initialized');
        }
    } catch (e) { /* non-critical */ }
}

// ============================================================
//  DAILY STATS
// ============================================================

async function getDailyStats() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get(DAILY_KEY, resolve);
        });
        const raw = result[DAILY_KEY] ? JSON.parse(result[DAILY_KEY]) : {};
        const today = todayKey();

        // Reset if it's a new day
        if (raw.date !== today) {
            return { sentToday: 0, date: today };
        }
        return { sentToday: raw.count || 0, date: today };
    } catch (e) {
        return { sentToday: 0, date: todayKey() };
    }
}

async function incrementDailyCount() {
    try {
        const stats = await getDailyStats();
        await new Promise(resolve => {
            chrome.storage.local.set({
                [DAILY_KEY]: JSON.stringify({
                    date:  stats.date,
                    count: stats.sentToday + 1
                })
            }, resolve);
        });
    } catch (e) { /* non-critical */ }
}

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ============================================================
//  WARMUP
// ============================================================

async function getWarmupDay() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get(WARMUP_KEY, resolve);
        });
        if (!result[WARMUP_KEY]) return 999; // no warmup data = treat as mature account
        const { installDate } = JSON.parse(result[WARMUP_KEY]);
        const daysSince = Math.floor((Date.now() - installDate) / 86400000) + 1;
        return daysSince;
    } catch (e) {
        return 999;
    }
}

async function getWarmupLimit() {
    const day = await getWarmupDay();
    if (day > 14) return DAILY_LIMITS.HARD; // graduated — full limit

    // Find the applicable schedule entry
    let limit = WARMUP_SCHEDULE[0].max;
    for (const entry of WARMUP_SCHEDULE) {
        if (day >= entry.day) limit = entry.max;
    }
    return limit;
}

// ============================================================
//  SCORE CALCULATION
// ============================================================

function calculateScore() {
    let score = 0;

    // Signal 1: new contact ratio (0–40 pts)
    // Only kicks in after 5+ messages to avoid false positives at session start
    if (riskSession.totalSent >= 5) {
        const ratio = newContactRatio();
        if (ratio > 0.9)      score += 40;
        else if (ratio > 0.8) score += 25;
        else if (ratio > 0.6) score += 10;
    }

    // Signal 2: send rate — only after 5+ minutes elapsed (0–30 pts)
    const minutesElapsed = (Date.now() - riskSession.sessionStart) / 60000;
    if (minutesElapsed >= 5) {
        const rate = msgPerHour();
        if (rate > 60)      score += 30;
        else if (rate > 40) score += 20;
        else if (rate > 25) score += 10;
    }

    // Signal 3: absolute session volume (0–20 pts)
    if (riskSession.totalSent > 100)     score += 20;
    else if (riskSession.totalSent > 60) score += 10;
    else if (riskSession.totalSent > 35) score += 5;

    return Math.min(Math.round(score), 100);
}

function newContactRatio() {
    if (riskSession.totalSent === 0) return 0;
    return riskSession.newContacts / riskSession.totalSent;
}

function msgPerHour() {
    const hoursElapsed = (Date.now() - riskSession.sessionStart) / 3600000;
    return riskSession.totalSent / Math.max(hoursElapsed, 10 / 60);
}

function getLevel(score) {
    if (score >= RISK_THRESHOLDS.HIGH)   return 'HIGH';
    if (score >= RISK_THRESHOLDS.MEDIUM) return 'MEDIUM';
    return 'LOW';
}

function getDynamicDelay(score) {
    if (score >= RISK_THRESHOLDS.HIGH)   return null;
    if (score >= RISK_THRESHOLDS.MEDIUM) {
        return Math.floor(Math.random() * (18000 - 8000 + 1)) + 8000;
    }
    return Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
}

// ============================================================
//  HELPERS
// ============================================================

async function isNewContact(phoneNumber) {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get('KEY_MESSAGE_HISTORY', resolve);
        });
        const historyStr = result['KEY_MESSAGE_HISTORY'];
        const history = historyStr ? JSON.parse(historyStr) : {};
        return !history[phoneNumber];
    } catch (e) {
        return true;
    }
}

async function persistSession() {
    try {
        await new Promise(resolve => {
            chrome.storage.local.set({ [RISK_KEY]: JSON.stringify(riskSession) }, resolve);
        });
    } catch (e) { /* non-critical */ }
}

// ============================================================
//  HISTORY HELPERS (used by analytics tab)
// ============================================================

async function getFullHistory() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get('KEY_MESSAGE_HISTORY', resolve);
        });
        const historyStr = result['KEY_MESSAGE_HISTORY'];
        return historyStr ? JSON.parse(historyStr) : {};
    } catch (e) {
        return {};
    }
}

// ============================================================
//  INIT + GLOBAL EXPORT
// ============================================================

initWarmup();

window.riskEngine = {
    check:          riskCheck,
    reset:          resetRiskSession,
    getStats:       getRiskStats,
    getFullHistory: getFullHistory,
    THRESHOLDS:     RISK_THRESHOLDS,
    DAILY_LIMITS:   DAILY_LIMITS
};
