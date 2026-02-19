const MSG_GET_USER_PHONENUMBER = "MSG_GET_USER_PHONENUMBER";
const MSG_GET_PAGE_URL = "MSG_GET_PAGE_URL";
const MSG_SEND_MESSAGE = "MSG_SEND_MESSAGE";
const MSG_VALIDATE_NUMBERS = "MSG_VALIDATE_NUMBERS";

// BULK MESSAGE
const KEY_PHONE_NUMBERS_BULK = "KEY_PHONE_NUMBERS_BULK";
const KEY_CURRENT_MSG_BULK = "KEY_CURRENT_MSG_BULK";
const KEY_BULK_MSG_COUNTRYCODE = "KEY_BULK_MSG_COUNTRYCODE";

// INDIVIDUAL MESSAGE
const KEY_PHONE_NUMBERS_INDIVIDUAL = "KEY_PHONE_NUMBERS_INDIVIDUAL";
const KEY_CURRENT_MSG_INDIVIDUAL = "KEY_CURRENT_MSG_INDIVIDUAL";

const KEY_PHONE_NUMBER = "KEY_PHONE_NUMBER";
const KEY_CURRENT_MSG = "KEY_CURRENT_MSG";

// Message History Tracking
const KEY_MESSAGE_HISTORY = "KEY_MESSAGE_HISTORY";
const SKIP_DAYS = 3; // Skip numbers contacted in past 3 days

// Stop flags for message sending
let stopSendingBulk = false;
let stopSendingIndividual = false;

// Global variables for checker state
let checkerData = {
    allNumbers: [],
    skipped: [],
    toSend: []
};

// Human-like typing simulation functions
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Message History Management Functions
async function addToMessageHistory(phoneNumber, message) {
    try {
        const history = await getMessageHistory();
        const timestamp = Date.now();
        
        // Add new entry
        history[phoneNumber] = {
            lastSent: timestamp,
            message: message.substring(0, 100), // Store first 100 chars for reference
            count: (history[phoneNumber]?.count || 0) + 1
        };
        
        // Clean up old entries (older than SKIP_DAYS)
        const cutoffTime = timestamp - (SKIP_DAYS * 24 * 60 * 60 * 1000);
        Object.keys(history).forEach(number => {
            if (history[number].lastSent < cutoffTime) {
                delete history[number];
            }
        });
        
        // Save updated history
        await new Promise(resolve => {
            chrome.storage.local.set({[KEY_MESSAGE_HISTORY]: JSON.stringify(history)}, resolve);
        });
        
        console.log(`📝 Added ${phoneNumber} to message history`);
    } catch (error) {
        console.error('Error adding to message history:', error);
    }
}

async function getMessageHistory() {
    try {
        const result = await new Promise(resolve => {
            chrome.storage.local.get(KEY_MESSAGE_HISTORY, resolve);
        });
        
        const historyStr = result[KEY_MESSAGE_HISTORY];
        return historyStr ? JSON.parse(historyStr) : {};
    } catch (error) {
        console.error('Error getting message history:', error);
        return {};
    }
}

async function shouldSkipNumber(phoneNumber) {
    try {
        const history = await getMessageHistory();
        const entry = history[phoneNumber];
        
        if (!entry) {
            return false; // No history, don't skip
        }
        
        const daysSince = (Date.now() - entry.lastSent) / (24 * 60 * 60 * 1000);
        const shouldSkip = daysSince < SKIP_DAYS;
        
        if (shouldSkip) {
            console.log(`⏭️  Skipping ${phoneNumber} - contacted ${daysSince.toFixed(1)} days ago`);
        }
        
        return shouldSkip;
    } catch (error) {
        console.error('Error checking if should skip number:', error);
        return false; // If error, don't skip
    }
}

async function getSkippedNumbers(phoneNumbers) {
    const skipped = [];
    const toSend = [];
    
    for (const numberData of phoneNumbers) {
        const phoneNumber = typeof numberData === 'string' ? numberData : numberData.number;
        
        if (await shouldSkipNumber(phoneNumber)) {
            skipped.push(numberData);
        } else {
            toSend.push(numberData);
        }
    }
    
    return { skipped, toSend };
}




// Manual Checker Functions - IN-POPUP INTERFACE
async function checkAndRemoveRecentNumbers() {
    console.log('🔍 checkAndRemoveRecentNumbers called');
    try {
        const rawInput = $("#inputNumbersBulk").val();
        console.log('📝 Raw input:', rawInput);
        
        if (!rawInput.trim()) {
            console.log('⚠️ No input found');
            showSimpleMessage("⚠️ Сначала введите номера телефонов для проверки.", "warning");
            return;
        }
        
        console.log("🔍 Checking numbers for recent contacts...");
        
        // Parse current input
        const inputLines = rawInput.split("\n");
        const allNumbers = [];
        
        inputLines.forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;
            
            const splitValue = trimmedLine.split(",");
            const phoneNumber = splitValue[0] ? splitValue[0].trim().replace('+', '') : '';
            
            if (phoneNumber && phoneNumber.replace(/\D/g, '').length >= 7) {
                allNumbers.push({
                    originalLine: trimmedLine, // Use trimmed line instead of original line
                    number: phoneNumber,
                    valueOne: splitValue[1] ? splitValue[1].trim() : '',
                    valueTwo: splitValue[2] ? splitValue[2].trim() : ''
                });
            }
        });
        
        if (allNumbers.length === 0) {
            showSimpleMessage("❌ Не найдено валидных номеров телефонов.", "error");
            return;
        }
        
        // Check against message history
        const { skipped, toSend } = await getSkippedNumbers(allNumbers);
        
        // Store data globally for later use
        checkerData = { allNumbers, skipped, toSend };
        console.log('💾 Stored checkerData:', checkerData);
        
        // Also store in localStorage as backup
        localStorage.setItem('checkerData', JSON.stringify(checkerData));
        
        if (skipped.length === 0) {
            showSuccessMessage(allNumbers.length);
            return;
        }
        
        if (toSend.length === 0) {
            // All numbers are in skip list - but still show remove button
            showAllNumbersSkippedMessage(allNumbers.length, skipped, true);
            return;
        }
        
        // Show detailed results in popup
        showCheckerResults(allNumbers.length, toSend.length, skipped);
        
    } catch (error) {
        console.error("❌ Error checking recent numbers:", error);
        showSimpleMessage("❌ Произошла ошибка при проверке номеров. Попробуйте снова.", "error");
    }
}

// Typing personality profiles - BALANCED SPEED
const TYPING_PERSONALITIES = {
    FAST: {
        name: "Быстрый печатник",
        shortWords: [25, 45],     // Fast but not too fast
        mediumWords: [35, 60],    // Fast but not too fast
        longWords: [40, 75],      // Fast but not too fast
        pauseChance: 0.08,        // Few pauses (8%)
        pauseTime: [80, 200],     // Short pauses
        thinkingTime: [400, 800]  // Quick thinking
    },
    MEDIUM: {
        name: "Обычный печатник", 
        shortWords: [35, 55],     // Moderate speed
        mediumWords: [45, 75],    // Moderate speed
        longWords: [55, 95],      // Moderate speed
        pauseChance: 0.12,        // Some pauses (12%)
        pauseTime: [150, 350],    // Medium pauses
        thinkingTime: [600, 1200] // Normal thinking
    },
    SLOW: {
        name: "Медленный печатник",
        shortWords: [50, 85],     // Slower but reasonable
        mediumWords: [65, 110],   // Slower but reasonable
        longWords: [80, 140],     // Slower but reasonable
        pauseChance: 0.18,        // More pauses (18%)
        pauseTime: [200, 500],    // Medium pauses
        thinkingTime: [800, 1500] // More thinking
    },
    INCONSISTENT: {
        name: "Непостоянный печатник",
        shortWords: [25, 70],     // Variable speed
        mediumWords: [35, 90],    // Variable speed
        longWords: [45, 120],     // Variable speed
        pauseChance: 0.15,        // Some pauses (15%)
        pauseTime: [120, 400],    // Variable pauses
        thinkingTime: [500, 1100] // Variable thinking
    }
};

// Select random typing personality
function getRandomTypingPersonality() {
    const personalities = Object.keys(TYPING_PERSONALITIES);
    const weights = [25, 40, 20, 15]; // Fast: 25%, Medium: 40%, Slow: 20%, Inconsistent: 15%
    
    const random = Math.random() * 100;
    let cumulative = 0;
    
    for (let i = 0; i < personalities.length; i++) {
        cumulative += weights[i];
        if (random <= cumulative) {
            return personalities[i];
        }
    }
    
    return 'MEDIUM'; // Fallback
}

function getTypingSpeed(word, personality = 'MEDIUM') {
    const profile = TYPING_PERSONALITIES[personality];
    const wordLength = word.length;
    
    let speedRange;
    if (wordLength <= 3) {
        speedRange = profile.shortWords;
    } else if (wordLength <= 7) {
        speedRange = profile.mediumWords;
    } else {
        speedRange = profile.longWords;
    }
    
    return getRandomDelay(speedRange[0], speedRange[1]);
}

function simulateHumanPauses(personality = 'MEDIUM') {
    const profile = TYPING_PERSONALITIES[personality];
    return getRandomDelay(profile.thinkingTime[0], profile.thinkingTime[1]);
}

function calculateMessageTypingTime(message, personality = 'MEDIUM') {
    const profile = TYPING_PERSONALITIES[personality];
    const words = message.split(' ');
    let totalTime = 0;
    
    words.forEach((word, index) => {
        // Add typing time for each character in the word
        for (let i = 0; i < word.length; i++) {
            totalTime += getTypingSpeed(word, personality);
        }
        
        // Add space typing time (balanced)
        if (index < words.length - 1) {
            totalTime += getRandomDelay(20, 40);
        }
        
        // Random pauses between some words based on personality
        if (Math.random() < profile.pauseChance) {
            totalTime += getRandomDelay(profile.pauseTime[0], profile.pauseTime[1]);
        }
    });
    
    return totalTime;
}

// Typing Animation Functions
function showTypingAnimation(phoneNumber, message) {
    $("#typingContainer").show();
    $("#currentNumber").text(phoneNumber);
    $("#typingText").html('<span class="typing-cursor">|</span>');
    $("#typingStatus").text("Думаю...");
    $("#typingStatus").addClass("typing-thinking typing-dots");
}

function hideTypingAnimation() {
    $("#typingContainer").hide();
    $("#typingStatus").removeClass("typing-thinking typing-dots typing-paused");
}

function startThinkingAnimation() {
    $("#typingStatus").text("Думаю").addClass("typing-thinking typing-dots");
}

function startTypingAnimation() {
    $("#typingStatus").text("Печатаю сообщение...").removeClass("typing-thinking typing-dots");
}

function updateCursorPosition() {
    const typingText = document.getElementById('typingText');
    const cursor = document.getElementById('typingCursor');
    
    if (typingText && cursor) {
        // Simply append cursor to the text content - much simpler and always accurate
        if (!typingText.innerHTML.includes('<span class="typing-cursor"')) {
            typingText.innerHTML = typingText.textContent + '<span class="typing-cursor" id="typingCursor">|</span>';
        }
    }
}

async function animateTypingWithPersonality(message, phoneNumber) {
    return new Promise(async (resolve) => {
        // Pick random typing personality for this message
        const personality = getRandomTypingPersonality();
        const profile = TYPING_PERSONALITIES[personality];
        
        console.log(`🎭 Using typing personality: ${profile.name} for ${phoneNumber}`);
        
        showTypingAnimation(phoneNumber, message);
        
        // Show personality in interface
        $("#typingStatus").text(`${profile.name} - Думаю`).addClass("typing-thinking typing-dots");
        
        // Thinking phase with personality-based timing
        const thinkingTime = simulateHumanPauses(personality);
        await new Promise(r => setTimeout(r, thinkingTime));
        
        if (stopSendingBulk || stopSendingIndividual) {
            hideTypingAnimation();
            resolve({ personality, typingTime: 0, thinkingTime });
            return;
        }
        
        // Start typing phase
        $("#typingStatus").text(`${profile.name} - Печатаю сообщение...`).removeClass("typing-thinking typing-dots");
        const typingTextElement = document.getElementById('typingText');
        let currentText = "";
        let actualTypingTime = 0;
        
        const words = message.split(' ');
        
        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
            const word = words[wordIndex];
            
            // Type each character of the word with personality-based speed
            for (let charIndex = 0; charIndex < word.length; charIndex++) {
                if (stopSendingBulk || stopSendingIndividual) {
                    hideTypingAnimation();
                    resolve({ personality, typingTime: actualTypingTime, thinkingTime });
                    return;
                }
                
                currentText += word[charIndex];
                typingTextElement.innerHTML = currentText + '<span class="typing-cursor">|</span>';
                
                // Wait based on personality and word length
                const charDelay = getTypingSpeed(word, personality);
                actualTypingTime += charDelay;
                await new Promise(r => setTimeout(r, charDelay));
            }
            
            // Add space if not the last word
            if (wordIndex < words.length - 1) {
                currentText += ' ';
                typingTextElement.innerHTML = currentText + '<span class="typing-cursor">|</span>';
                
                // Space typing delay (balanced)
                const spaceDelay = getRandomDelay(20, 40);
                actualTypingTime += spaceDelay;
                await new Promise(r => setTimeout(r, spaceDelay));
                
                // Random pause between words based on personality
                if (Math.random() < profile.pauseChance) {
                    $("#typingStatus").text(`${profile.name} - Пауза...`).addClass("typing-paused");
                    const wordPause = getRandomDelay(profile.pauseTime[0], profile.pauseTime[1]);
                    actualTypingTime += wordPause;
                    await new Promise(r => setTimeout(r, wordPause));
                    $("#typingStatus").text(`${profile.name} - Печатаю сообщение...`).removeClass("typing-paused");
                }
            }
        }
        
        // Finished typing
        $("#typingStatus").text(`${profile.name} - Отправляю...`);
        await new Promise(r => setTimeout(r, 400)); // Small delay before hiding (balanced)
        
        hideTypingAnimation();
        resolve({ 
            personality, 
            typingTime: actualTypingTime, 
            thinkingTime,
            personalityName: profile.name 
        });
    });
}

// Legacy function for backward compatibility
async function animateTyping(message, phoneNumber) {
    const result = await animateTypingWithPersonality(message, phoneNumber);
    return result;
}

function getStorageInstance() {
    function setStorage(key, value) {
        return new Promise((resolve, reject) => {
            const obj = {};
            obj[key] = value;
            chrome.storage.local.set(obj, function () {
                resolve()
            })
        })
    }

    function getStorage(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(key, function (result) {
                resolve(result[key])
            })
        })
    }

    function savePhoneNumbersBulk(phoneNumbers) {
        return setStorage(KEY_PHONE_NUMBERS_BULK, JSON.stringify(phoneNumbers))
    }
    async function getPhoneNumbersBulk() {
        const strPhoneNumbers = await getStorage(KEY_PHONE_NUMBERS_BULK);
        if (strPhoneNumbers) {
            return JSON.parse(strPhoneNumbers)
        } else return []
    }

    // BULK MESSAGE
    function saveCurrentMessageBulk(currentMessage) {
        return setStorage(KEY_CURRENT_MSG_BULK, currentMessage)
    }

    function getCurrentMessageBulk() {
        return getStorage(KEY_CURRENT_MSG_BULK)
    }

    // INDIVIDUAL MESSAGE
    function savePhoneNumbersIndividual(phoneNumbers) {
        console.log('phoneNumbers::', phoneNumbers);
        return setStorage(KEY_PHONE_NUMBERS_INDIVIDUAL, JSON.stringify(phoneNumbers))
    }
    async function getPhoneNumbersIndividual() {
        const strPhoneNumbers = await getStorage(KEY_PHONE_NUMBERS_INDIVIDUAL);
        if (strPhoneNumbers) {
            return JSON.parse(strPhoneNumbers)
        } else return []
    }

    function saveCurrentMessageIndividual(currentMessage) {
        return setStorage(KEY_CURRENT_MSG_INDIVIDUAL, currentMessage)
    }

    function getCurrentMessageIndividual() {
        return getStorage(KEY_CURRENT_MSG_INDIVIDUAL)
    }


    function savePhoneNumber(phoneNumber) {
        return setStorage(KEY_PHONE_NUMBER, phoneNumber)
    }
    async function getPhoneNumber() {
        const strPhoneNumber = await getStorage(KEY_PHONE_NUMBER);
        // console.log('getPhoneNumber: strPhoneNumber:', strPhoneNumber, KEY_PHONE_NUMBER);
        return strPhoneNumber
    }

    function saveCurrentMessage(currentMessage) {
        return setStorage(KEY_CURRENT_MSG, currentMessage)
    }

    function getCurrentMessage() {
        return getStorage(KEY_CURRENT_MSG)
    }

    return {
        // BULK MESSAGE
        getCurrentMessageBulk: getCurrentMessageBulk,
        saveCurrentMessageBulk: saveCurrentMessageBulk,
        getPhoneNumbersBulk: getPhoneNumbersBulk,
        savePhoneNumbersBulk: savePhoneNumbersBulk,
        // INDIVIDUAL MESSAGE
        getCurrentMessageIndividual: getCurrentMessageIndividual,
        saveCurrentMessageIndividual: saveCurrentMessageIndividual,
        getPhoneNumbersIndividual: getPhoneNumbersIndividual,
        savePhoneNumbersIndividual: savePhoneNumbersIndividual,

        // GET ACTIVE TAB
        getActiveTab: getActiveTab,

        // SAVE & GET MESSAGE-NUMBER
        saveCurrentMessage: saveCurrentMessage,
        savePhoneNumber: savePhoneNumber,
        getCurrentMessage: getCurrentMessage,
        getPhoneNumber: getPhoneNumber,
    }
}

function getActiveTab() {
    return new Promise(resolve => {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, function (tabs) {
            resolve(tabs[0].id)
        })
    })
}

async function ensureContentScriptLoaded(tabId) {
    try {
        console.log(`🔍 Checking if content script is loaded on tab ${tabId}`);
        // Try to ping the content script
        const response = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, {subject: "PING"}, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
        console.log(`✅ Content script already loaded:`, response);
        return true;
    } catch (error) {
        console.log(`❌ Content script not loaded, injecting it...`, error.message);
        
        // Inject the content script programmatically
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            console.log(`✅ Content script injected successfully`);
            
            // Wait a moment for it to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
        } catch (injectError) {
            console.error(`❌ Failed to inject content script:`, injectError);
            return false;
        }
    }
}

function sendMsgToActiveTab(msg) {
    return new Promise((resolve, reject) => {
        getActiveTab().then(async tabid => {
            console.log(`📤 Sending message to tab ${tabid}:`, msg);
            
            // Ensure content script is loaded first
            const isLoaded = await ensureContentScriptLoaded(tabid);
            if (!isLoaded) {
                reject(new Error('Failed to load content script'));
                return;
            }
            
            chrome.tabs.sendMessage(tabid, msg, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(`❌ Chrome runtime error:`, chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log(`📨 Received response:`, response);
                    resolve(response);
                }
            });
        }).catch(error => {
            console.error(`❌ Error getting active tab:`, error);
            reject(error);
        });
    })
}

function sendMsgToExtension(msg) {
    chrome.runtime.sendMessage(msg)
}

let isPageWebWhatsapp = false;
const storageInstance = getStorageInstance();
let authid = "";
let authPhoneNumber = "";
let msgBulk = "";
let msgIndividual = "";
let delay = 1 * 1 * 1e3;
let phoneNumbersBulk = [];
let phoneNumberSendToBulk = [];
let phoneNumberIndividual = [];
let phoneNumbersBulkMessage = [];
let contacts = [];

let msg = "";
let phoneNumber = "";

// Mistral AI API configuration
const MISTRAL_API_KEY = "QqkMxELY0YVGkCx17Vya04Sq9nGvCahu"; // Replace with your API key
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

async function generateVariedMessage(originalMessage, maxLength = 160) {
    try {
        const response = await fetch(MISTRAL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MISTRAL_API_KEY}`
            },
            body: JSON.stringify({
                model: "open-mistral-nemo",
                messages: [{
                    role: "user",
                    content: `Перефразируй это сообщение на русском языке полностью, используя другие слова, но сохраняя тот же смысл и тон. Сделай его естественным и разговорным. Обязательно закончи сообщение полностью. Не включай количество символов или другую мета-информацию. Просто верни готовое перефразированное сообщение на русском языке: "${originalMessage}"`
                }],
                max_tokens: 500,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        let rephrased = data.choices[0].message.content.trim();
        
        // Remove any character count information or quotes
        rephrased = rephrased.replace(/\(\d+\s*characters?\)/gi, '');
        rephrased = rephrased.replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        rephrased = rephrased.trim();
        
        return rephrased;
    } catch (error) {
        console.error('Mistral API error:', error);
        return originalMessage; // Return original if API fails
    }
}

async function generateMultipleVariations(originalMessage, count = 3, maxLength = 100) {
    const variations = [];
    for (let i = 0; i < count; i++) {
        const variation = await generateVariedMessage(originalMessage, maxLength);
        variations.push(variation);
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return variations;
}

// Progress tracking functions
function showProgress(current, total) {
    $("#progressContainer").show();
    const percentage = Math.round((current / total) * 100);
    $("#sendingProgress").css("width", percentage + "%").attr("aria-valuenow", percentage);
    $("#progressText").text(`Отправка: ${current} из ${total}`);
    
    // Change button text and disable it
    $("#sendMessageBulk").text("Отправка...").prop("disabled", true);
}

function hideProgress() {
    $("#progressContainer").hide();
    $("#sendMessageBulk").text("Отправить").prop("disabled", false);
}

function updateProgress(current, total, currentNumber = "") {
    const percentage = Math.round((current / total) * 100);
    $("#sendingProgress").css("width", percentage + "%").attr("aria-valuenow", percentage);
    $("#progressText").text(`Отправка: ${current} из ${total}${currentNumber ? ` (${currentNumber})` : ""}`);
}

window.addEventListener("DOMContentLoaded", async function () {
    await initApp();

    // These can run in parallel after init
    sendMsgToActiveTab({
        from: "popup.js",
        subject: MSG_GET_PAGE_URL,
        data: ""
    }).then(url => {
        if (url === "https://web.whatsapp.com" || url === "https://web.whatsapp.com/") {
            isPageWebWhatsapp = true;
        }
        updateView();
    }).catch(() => { /* not on WhatsApp tab yet */ });

    sendMsgToActiveTab({
        from: "popup.js",
        subject: MSG_GET_USER_PHONENUMBER,
        data: ""
    }).then(phoneNumber => {
        authPhoneNumber = phoneNumber;
        updateView();
    }).catch(() => { /* ignore */ });
});
async function initApp() {
    await initBulkMessageTab();
    await initIndividualMessageTab();
    updateView();
    addEventListeners();
    initStatsTab();
}

async function initSingleMessageTab() {
    phoneNumber = await storageInstance.getPhoneNumber();
    msg = await storageInstance.getCurrentMessage();
}

async function initBulkMessageTab() {
    phoneNumbersBulk = await storageInstance.getPhoneNumbersBulk();
    msgBulk = await storageInstance.getCurrentMessageBulk();

    // Rebuild phoneNumberSendToBulk from stored lines (same logic as input handler)
    phoneNumberSendToBulk = [];
    for (let i = 0; i < phoneNumbersBulk.length; i++) {
        const line = (phoneNumbersBulk[i] || '').trim();
        if (!line) continue;
        const splitedValue = line.split(",");
        const phoneNumber = splitedValue[0] ? splitedValue[0].trim().replace('+', '') : '';
        if (phoneNumber && phoneNumber.replace(/\D/g, '').length >= 7) {
            phoneNumberSendToBulk.push({
                number:   phoneNumber,
                valueOne: splitedValue[1] ? splitedValue[1].trim() : '',
                valueTwo: splitedValue[2] ? splitedValue[2].trim() : ''
            });
        }
    }
    console.log(`🔄 initBulkMessageTab: restored ${phoneNumberSendToBulk.length} valid numbers`);
}

async function initIndividualMessageTab() {
    phoneNumberIndividual = await storageInstance.getPhoneNumbersIndividual();
    msgIndividual = await storageInstance.getCurrentMessageIndividual();
}

function updateView() {
    updateBulkMessageView();
    updateIndividualMessageView();
}

function updateBulkMessageView() {
    $("#inputMessageBulk").val(msgBulk);
    let strInputNumberBulk = "";
    if (phoneNumbersBulk && phoneNumbersBulk.length > 0) {
        strInputNumberBulk = phoneNumbersBulk.reduce((acc, phonenumber, index) => {
            return acc = acc + "\n" + phonenumber
        })
    }
    $("#inputNumbersBulk").val(strInputNumberBulk);
    // Check the actual data that will be used for sending
    if (!phoneNumberSendToBulk || phoneNumberSendToBulk.length === 0) {
        $("#sendMessageBulk").prop("disabled", true);
        console.log("📵 Send button disabled - no valid phone numbers in phoneNumberSendToBulk");
    } else if (!msgBulk || msgBulk.trim().length === 0) {
        $("#sendMessageBulk").prop("disabled", true);
        console.log("📵 Send button disabled - no message text");
    } else {
        $("#sendMessageBulk").prop("disabled", false);
        console.log(`✅ Send button enabled - ${phoneNumberSendToBulk.length} phone numbers and message ready`);
    }
}

// INDIVIDUAL MESSAGE
function updateIndividualMessageView() {
    $("#inputIndividualMessage").val(msgIndividual);
    let strInputNumberIndividual = "";
    if (phoneNumberIndividual && phoneNumberIndividual.length > 0) {
        strInputNumberIndividual = phoneNumberIndividual.reduce((acc, phonenumber, index) => {
            return acc = acc + "\n" + phonenumber
        })
    }
    $("#individualMessageTabPhoneNumber").val(strInputNumberIndividual);
    
    // Better validation logic
    const hasValidNumbers = phoneNumberIndividual && phoneNumberIndividual.length > 0 && 
                           phoneNumberIndividual.some(num => num && num.trim().replace(/\D/g, '').length >= 7);
    const hasValidMessage = msgIndividual && msgIndividual.trim().length > 0;
    
    if (!hasValidNumbers) {
        $("#sendMessageIndividual").prop("disabled", true);
        console.log("📵 Individual send button disabled - no valid phone numbers");
    } else if (!hasValidMessage) {
        $("#sendMessageIndividual").prop("disabled", true);
        console.log("📵 Individual send button disabled - no message text");
    } else {
        $("#sendMessageIndividual").prop("disabled", false);
        console.log(`✅ Individual send button enabled - ${phoneNumberIndividual.length} phone numbers and message ready`);
    }
}

/* *****************************-------SEND BULK MESSAGE--------******************************** */

async function sendToBulkOneByOne(data, msgBulk, baseDelay, useVariations = false) {
    console.log(`🚀 Starting one-by-one send for ${data.length} messages`);
    console.log(`💡 Tip: Use "🔍 Проверить номера" button to remove recently contacted numbers before sending`);

    stopSendingBulk = false;

    // Reset risk session at the start of each bulk send
    if (window.riskEngine) {
        window.riskEngine.reset();
        window.riskEngine.getStats().then(updateRiskUI);
    }

    showProgress(0, data.length);
    
    // Show stop button and hide send button
    $("#sendMessageBulk").hide();
    $("#stopSending").show();

    // Set up progress listener for real-time updates (disabled to prevent conflicts)
    const progressListener = (message) => {
        if (message.subject === "PROGRESS_UPDATE") {
            console.log(`📊 Progress update from content script:`, message.data);
            // Disabled: updateProgress(message.data.current, message.data.total, message.data.number);
            // We handle progress locally to avoid conflicts
        }
    };
    
    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener(progressListener);

    try {
        // Process each message one by one: generate → send → generate → send
        for (let i = 0; i < data.length; i++) {
            // Check if user pressed stop
            if (stopSendingBulk) {
                console.log(`🛑 Stopping bulk send at message ${i + 1}/${data.length}`);
                break;
            }

            console.log(`📝 Processing message ${i + 1}/${data.length} for ${data[i].number}`);
            
            // Generate message for this specific recipient
            let newMessage = msgBulk.replace(/@valueOne/g, data[i].valueOne);
            newMessage = newMessage.replace(/@valueTwo/g, data[i].valueTwo);

            // Generate AI variation if enabled
            if (useVariations && MISTRAL_API_KEY !== "your-mistral-api-key-here") {
                try {
                    console.log(`🤖 Generating AI variation for ${data[i].number}...`);
                    newMessage = await generateVariedMessage(newMessage, 160);
                    console.log(`✨ Generated variation for ${data[i].number}: "${newMessage}"`);
                } catch (error) {
                    console.log(`⚠️ Using original message for ${data[i].number} due to variation error:`, error);
                }
            }

            // Check if user pressed stop before sending
            if (stopSendingBulk) {
                console.log(`🛑 Stopping bulk send before sending to ${data[i].number}`);
                break;
            }

            // ---- Risk check ----
            let dynamicDelay = baseDelay;
            if (window.riskEngine) {
                const risk = await window.riskEngine.check(data[i].number);
                window.riskEngine.getStats().then(updateRiskUI);

                if (risk.shouldStop) {
                    console.warn(`[RiskEngine] HARD STOP — reason=${risk.reason}`);
                    if (risk.reason === 'daily_limit') {
                        showSimpleMessage(
                            `🚫 ${risk.detail} — продолжите завтра.`,
                            "error"
                        );
                    } else {
                        showSimpleMessage(
                            `⛔ Risk score ${risk.score}/100 — слишком много новых контактов подряд. Сделайте паузу и попробуйте позже.`,
                            "error"
                        );
                    }
                    break;
                }

                // Daily warn threshold (not a stop, just a heads-up)
                const stats = window.riskEngine.getStats ? await window.riskEngine.getStats() : null;
                if (stats && stats.sentToday >= stats.dailyWarnLimit && stats.sentToday < stats.dailyLimit) {
                    showSimpleMessage(
                        `⚠️ Сегодня отправлено ${stats.sentToday} сообщений — осталось ${stats.dailyRemaining} до лимита`,
                        "warning"
                    );
                } else if (risk.level === 'MEDIUM') {
                    showSimpleMessage(
                        `⚠️ Risk score ${risk.score}/100 — замедляю темп отправки`,
                        "warning"
                    );
                }

                dynamicDelay = risk.delay ?? baseDelay;
            }

            // Update progress before sending (show current message being processed)
            updateProgress(i + 1, data.length, data[i].number);

            // Send this single message with visual typing animation
            try {
                console.log(`📤 Sending message to ${data[i].number} with visual typing animation`);
                
                // Show typing animation that matches the actual timing
                const personalityInfo = await animateTypingWithPersonality(newMessage, data[i].number);
                
                // Check if user pressed stop during animation
                if (stopSendingBulk) {
                    console.log(`🛑 Stopping bulk send during typing animation`);
                    break;
                }
                
                const response = await sendMsgToActiveTab({
                    from: "home.js",
                    subject: MSG_SEND_MESSAGE,
                    data: {
                        messages: [{
                            number: data[i].number,
                            message: newMessage
                        }],
                        delay: baseDelay,
                        humanTyping: {
                            enabled: true,
                            personality: personalityInfo.personality,
                            typingTime: personalityInfo.typingTime,
                            thinkingTime: personalityInfo.thinkingTime,
                            animated: true // Flag to indicate animation was shown
                        }
                    }
                });

                console.log(`✅ Message sent to ${data[i].number}:`, response);
                
                // Add to message history after successful send
                await addToMessageHistory(data[i].number, newMessage);

            } catch (error) {
                console.error(`❌ Error sending to ${data[i].number}:`, error);
                hideTypingAnimation(); // Hide animation on error
            }

            // Wait before next message (except for the last one) but check for stop during wait
            if (i < data.length - 1 && !stopSendingBulk) {
                // Use dynamic delay from risk engine (or fallback)
                const randomDelay = dynamicDelay ?? getRandomDelay(2000, 5000);
                console.log(`⏰ Waiting ${randomDelay}ms before next message (risk-based delay)...`);
                
                // Break the delay into smaller chunks to check for stop more frequently
                const checkInterval = 500; // Check every 500ms
                const chunks = Math.ceil(randomDelay / checkInterval);
                
                for (let chunk = 0; chunk < chunks; chunk++) {
                    if (stopSendingBulk) break;
                    const waitTime = Math.min(checkInterval, randomDelay - (chunk * checkInterval));
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        if (stopSendingBulk) {
            console.log(`🛑 Bulk sending stopped by user`);
        } else {
            console.log(`🎉 All ${data.length} messages processed!`);
        }
        
    } catch (error) {
        console.error(`❌ Error in one-by-one send:`, error);
    } finally {
        // Remove progress listener
        chrome.runtime.onMessage.removeListener(progressListener);
        
        // Reset UI
        $("#stopSending").hide().prop("disabled", false).text("Остановить");
        $("#sendMessageBulk").show();
        stopSendingBulk = false;
        
        // Final cleanup
        setTimeout(() => {
            hideProgress();
            updateView();
        }, 1000);
    }
}

function addEventListenersBulkMessageView() {
    $("#sendMessageBulk").click(async function () {
        if (phoneNumberSendToBulk.length > 0) {
            const baseDelay = 5000;
            const useVariations = $("#useMessageVariations").is(":checked");
            sendToBulkOneByOne(phoneNumberSendToBulk, msgBulk, baseDelay, useVariations);
        }
    });

    $("#stopSending").click(function () {
        console.log("🛑 User clicked stop button for bulk sending");
        stopSendingBulk = true;
        $(this).prop("disabled", true).text("Остановка...");
    });
    $("#inputMessageBulk").on("input", async function () {
        msgBulk = $(this).val();
        await storageInstance.saveCurrentMessageBulk(msgBulk);
        updateView();
    });
    $("#inputNumbersBulk").on("input change paste", async function () {
        const rawInput = this.value;
        console.log(`📝 Processing phone number input: "${rawInput}"`);
        
        phoneNumbersBulk = rawInput.split("\n");
        phoneNumberSendToBulk = [];

        for (let i = 0; i < phoneNumbersBulk.length; i++) {
            const line = phoneNumbersBulk[i].trim();
            if (!line) continue; // Skip empty lines
            
            const splitedValue = line.split(",");
            const phoneNumber = splitedValue[0] ? splitedValue[0].trim().replace('+', '') : '';
            
            // Only add if phone number is not empty and looks valid (at least 7 digits)
            if (phoneNumber && phoneNumber.replace(/\D/g, '').length >= 7) {
                const data = {
                    number: phoneNumber,
                    valueOne: splitedValue[1] ? splitedValue[1].trim() : '',
                    valueTwo: splitedValue[2] ? splitedValue[2].trim() : ''
                }
                phoneNumberSendToBulk.push(data);
                console.log(`✅ Added valid number: ${phoneNumber}`);
            } else {
                console.log(`❌ Skipped invalid number: "${line}"`);
            }
        }
        
        console.log(`📊 Total valid numbers: ${phoneNumberSendToBulk.length}`);
        await storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
        updateView();
    });
    $("#btnUploadNumbersButton").click(function () {
        document.getElementById("inputUploadNumbers").click();
        updateView();
    });
    
    $("#btnCheckRecentNumbers").click(async function () {
        await checkAndRemoveRecentNumbers();
    });
    
    
    // Add double-click to clear message history for testing
    $("#btnCheckRecentNumbers").dblclick(async function () {
        if (confirm('Очистить всю историю сообщений? (Только для тестирования)')) {
            localStorage.removeItem(KEY_MESSAGE_HISTORY);
            await new Promise(resolve => {
                chrome.storage.local.remove(KEY_MESSAGE_HISTORY, resolve);
            });
            alert('История сообщений очищена!');
        }
    });
    $("#inputUploadNumbers").on("change", function () {
        const file = $(this)[0].files[0];
        var fr = new FileReader;
        fr.onload = async function (event) {
            phoneNumbersBulk = event.target.result.split("\n").filter(token => token.trim().length > 9);
            const csvData = event.target.result.split("\n");
            phoneNumberSendToBulk = [];

            for (let i = 0; i < csvData.length; i++) {
                const splitedValue = csvData[i].split(",");
                if (splitedValue[0]) {
                    const data = {
                        number: splitedValue[0] ? splitedValue[0].replace('+', '') : '',
                        valueOne: splitedValue[1] ? splitedValue[1] : '',
                        valueTwo: splitedValue[2] ? splitedValue[2] : ''
                    }
                    phoneNumberSendToBulk.push(data);
                }
            }
            await storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
            updateView();
        };
        fr.readAsText(file);
    });
}

/* *****************************-------SEND INDIVIDUAL MESSAGE--------******************************** */

async function sendMessageToIndividual(index, data, msgIndividual, delay) {
    console.log(`🚀 Starting individual message send`);
    const phoneNumber = data[index];
    
    stopSendingIndividual = false;
    
    // Show stop button and hide send button
    $("#sendMessageIndividual").hide();
    $("#stopSendingIndividual").show();

    try {
        // Check if user pressed stop
        if (stopSendingIndividual) {
            console.log(`🛑 Individual sending stopped by user`);
            return;
        }

        console.log(`📤 Sending individual message to ${data[index]} with visual typing animation`);
        
        // Show typing animation that matches the actual timing
        await animateTyping(msgIndividual, data[index]);
        
        // Check if user pressed stop during animation
        if (stopSendingIndividual) {
            console.log(`🛑 Individual sending stopped during typing animation`);
            return;
        }
        
        // Calculate realistic typing time for backend
        const typingTime = calculateMessageTypingTime(msgIndividual);
        console.log(`⌨️  Backend typing time: ${typingTime}ms for message: "${msgIndividual.substring(0, 50)}..."`);
        
        await sendMsgToActiveTab({
            from: "home.js",
            subject: MSG_SEND_MESSAGE,
            data: {
                message: msgIndividual,
                numbers: [data[index]],
                delay: delay,
                humanTyping: {
                    enabled: true,
                    typingTime: typingTime,
                    animated: true // Flag to indicate animation was shown
                }
            }
        });
        
        console.log(`✅ Individual message sent successfully`);
        
        // Add to message history after successful send
        await addToMessageHistory(phoneNumber, msgIndividual);
        
    } catch (error) {
        console.error(`❌ Error sending individual message:`, error);
        hideTypingAnimation(); // Hide animation on error
    } finally {
        // Reset UI
        $("#stopSendingIndividual").hide().prop("disabled", false).text("Остановить");
        $("#sendMessageIndividual").show();
        stopSendingIndividual = false;
    }
}

function addEventListenersIndividualMessageView() {

    $("#sendMessageIndividual").click(async function () {
        if (phoneNumberIndividual.length > 0) {
            await sendMessageToIndividual(0, phoneNumberIndividual, msgIndividual, delay);
        }
    });

    $("#stopSendingIndividual").click(function () {
        console.log("🛑 User clicked stop button for individual sending");
        stopSendingIndividual = true;
        $(this).prop("disabled", true).text("Остановка...");
    });
    $("#inputIndividualMessage").on("input", async function () {
        msgIndividual = $(this).val();
        await storageInstance.saveCurrentMessageIndividual(msgIndividual);
        updateView();
    });
    $("#individualMessageTabPhoneNumber").on("input change paste", async function () {
        const rawInput = this.value.trim();
        console.log(`📝 Processing individual phone number input: "${rawInput}"`);
        
        if (!rawInput) {
            phoneNumberIndividual = [];
        } else {
            phoneNumberIndividual = rawInput.split("\n");
            // Clean and validate the phone number
            phoneNumberIndividual[0] = phoneNumberIndividual[0] ? phoneNumberIndividual[0].trim().replace('+', '') : '';
            
            // Remove empty entries
            phoneNumberIndividual = phoneNumberIndividual.filter(num => num && num.trim().length >= 7);
        }
        
        console.log(`📊 Individual phone numbers processed:`, phoneNumberIndividual);
        await storageInstance.savePhoneNumbersIndividual(phoneNumberIndividual);
        updateView();
    });

    $("#valueOneLabel").click(function (evt) {
        var messageValue = document.getElementById("inputMessageBulk");
        var startPosition = messageValue.selectionStart;
        var endPosition = messageValue.selectionEnd;
        const textWithValueOne = '@valueOne';
        var fullString = messageValue.value.substring(0, startPosition) +
            textWithValueOne +
            messageValue.value.substring(endPosition, messageValue.value.length);
        document.getElementById("inputMessageBulk").value = fullString;
        msgBulk = $('#inputMessageBulk').val();
        document.getElementById("valueOneLabel").blur();
        evt.preventDefault();
        var input = $("#inputMessageBulk");
        var len = input.val().length;
        input[0].focus();
        input[0].setSelectionRange(len, len);
    });

    $("#valueTwoLabel").click(function (evt) {
        var messageValue = document.getElementById("inputMessageBulk");
        var startPosition = messageValue.selectionStart;
        var endPosition = messageValue.selectionEnd;
        var textWithValueTwo = '@valueTwo';
        var fullString = messageValue.value.substring(0, startPosition) +
            textWithValueTwo +
            messageValue.value.substring(endPosition, messageValue.value.length);
        document.getElementById("inputMessageBulk").value = fullString;
        msgBulk = $('#inputMessageBulk').val();
        document.getElementById("valueTwoLabel").blur();
        evt.preventDefault();
        var input = $("#inputMessageBulk");
        var len = input.val().length;
        input[0].focus();
        input[0].setSelectionRange(len, len);
    });
}

function addEventListenersClearAllFields() {

    $("#clearAllFieldsIndividual").click(async function () {
        document.getElementById("individualMessageTabPhoneNumber").value = '';
        document.getElementById("inputIndividualMessage").value = '';
        phoneNumberIndividual = [];
        msgIndividual = '';
        await storageInstance.savePhoneNumbersIndividual(phoneNumberIndividual);
        await storageInstance.saveCurrentMessageIndividual(msgIndividual);
    });

    $("#clearAllFieldsBulk").click(async function () {
        document.getElementById("inputNumbersBulk").value = '';
        document.getElementById("inputMessageBulk").value = '';
        document.getElementById("inputUploadNumbers").value = '';
        phoneNumbersBulk = [];
        phoneNumberSendToBulk = [];
        msgBulk = '';
        await storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
        await storageInstance.saveCurrentMessageBulk(msgBulk);
        updateView();
    });
}

function addEventListeners() {
    addEventListenersBulkMessageView();
    addEventListenersIndividualMessageView();
    addEventListenersClearAllFields();
    addTabAnimationListeners();
    addCheckerEventListeners();
}

// Enhanced Tab Animation System
function addTabAnimationListeners() {
    // Add click animation feedback
    $('[data-toggle="tab"]').on('click', function() {
        // Add subtle tab click animation
        $(this).addClass('tab-clicked');
        setTimeout(() => {
            $(this).removeClass('tab-clicked');
        }, 300);
        
        // Log tab switching
        const targetTab = $(this).attr('href').substring(1);
        console.log(`🎭 Tab clicked: ${targetTab}`);
    });
    
    // Let Bootstrap handle the tab switching while we add visual enhancements
    // The CSS animations will automatically apply when Bootstrap changes the active class
}

// Add CSS for tab click animation
const tabClickCSS = `
.nav-link.tab-clicked {
    transform: translateY(-3px) scale(1.1) !important;
    box-shadow: 0 15px 50px rgba(55, 114, 255, 0.6) !important;
    animation: tabPulse 0.3s ease-out !important;
}

@keyframes tabPulse {
    0% { transform: translateY(-3px) scale(1.05); }
    50% { transform: translateY(-5px) scale(1.12); }
    100% { transform: translateY(-3px) scale(1.1); }
}

.tab-pane.slide-out-right {
    transform: translateX(100%);
    opacity: 0;
}
`;

// Inject the CSS
if (!document.getElementById('tab-animation-styles')) {
    const style = document.createElement('style');
    style.id = 'tab-animation-styles';
    style.textContent = tabClickCSS;
    document.head.appendChild(style);
}

// Show message when all numbers are skipped
function showAllNumbersSkippedMessage(totalCount, skippedNumbers, showRemoveButton = false) {
    let content = `
        <div class="premium-success-message">
            <span class="premium-success-icon">⚠️</span>
            <div class="premium-success-title" style="background: linear-gradient(135deg, rgba(255, 193, 7, 0.9) 0%, rgba(255, 193, 7, 0.7) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;">
                Все номера недавно контактированы
            </div>
            <div class="premium-success-details">
                Все <strong>${totalCount}</strong> номеров получали сообщения в последние ${SKIP_DAYS} дня.
            </div>
            <div class="premium-success-subtitle">
                Рекомендуется подождать или использовать другие номера.
            </div>
        </div>
    `;
    
    if (skippedNumbers.length <= 5) {
        content += `
            <div class="premium-numbers-section">
                <div class="premium-numbers-header">
                    📋 Недавно контактированные номера
                </div>
                <div class="premium-numbers-list">
        `;
        
        skippedNumbers.forEach((item, index) => {
            const number = typeof item === 'string' ? item : item.number;
            content += `
                <div class="premium-number-item" data-number="${number}">
                    <div class="premium-number-info">${index + 1}. ${number}</div>
                    <div class="premium-number-days" id="days-${number}">...</div>
                </div>
            `;
        });
        
        content += `
                </div>
            </div>
        `;
    }
    
    $("#checkerContent").html(content);
    $("#checkerStatus").text("Результаты проверки");
    
    if (showRemoveButton) {
        $("#checkerActions").show(); // Show remove button
    } else {
        $("#checkerActions").hide(); // No actions needed - all are skipped
    }
    
    $("#checkerResultsContainer").show();
    
    // Update with actual days after rendering
    setTimeout(async () => {
        const history = await getMessageHistory();
        skippedNumbers.slice(0, 5).forEach((item) => {
            const number = typeof item === 'string' ? item : item.number;
            const entry = history[number];
            const daysSince = entry ? ((Date.now() - entry.lastSent) / (24 * 60 * 60 * 1000)).toFixed(1) : '?';
            $(`#days-${number}`).text(`${daysSince} дн. назад`);
        });
    }, 100);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideCheckerResults();
    }, 5000);
}

// Show premium success message
function showSuccessMessage(totalCount) {
    const content = `
        <div class="premium-success-message">
            <span class="premium-success-icon">✨</span>
            <div class="premium-success-title">Превосходно!</div>
            <div class="premium-success-details">
                Все <strong>${totalCount}</strong> номеров прошли проверку и готовы к отправке.
            </div>
            <div class="premium-success-subtitle">
                Никто из них не получал сообщения в последние ${SKIP_DAYS} дня
            </div>
        </div>
    `;
    
    $("#checkerContent").html(content);
    $("#checkerStatus").text("Анализ завершен");
    $("#checkerActions").hide();
    $("#checkerResultsContainer").show();
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        hideCheckerResults();
    }, 3000);
}

// Show premium detailed checker results
function showCheckerResults(totalCount, readyCount, skippedNumbers) {
    let content = `
        <div class="premium-stats-grid">
            <div class="premium-stat-card">
                <span class="premium-stat-number total">${totalCount}</span>
                <span class="premium-stat-label">Всего</span>
            </div>
            <div class="premium-stat-card">
                <span class="premium-stat-number ready">${readyCount}</span>
                <span class="premium-stat-label">Готовы</span>
            </div>
            <div class="premium-stat-card">
                <span class="premium-stat-number skip">${skippedNumbers.length}</span>
                <span class="premium-stat-label">Пропустить</span>
            </div>
        </div>
    `;
    
    if (skippedNumbers.length > 0) {
        content += `
            <div class="premium-numbers-section">
                <div class="premium-numbers-header">
                    📋 Номера для удаления (контакт в последние ${SKIP_DAYS} дня)
                </div>
                <div class="premium-numbers-list">
        `;
        
        // Add numbers immediately and update with history data
        skippedNumbers.forEach((item, index) => {
            const number = typeof item === 'string' ? item : item.number;
            content += `
                <div class="premium-number-item" data-number="${number}">
                    <div class="premium-number-info">${index + 1}. ${number}</div>
                    <div class="premium-number-days" id="days-${number}">...</div>
                </div>
            `;
        });
        
        content += `
                </div>
            </div>
        `;
        
        // Update with actual days after rendering
        setTimeout(async () => {
            const history = await getMessageHistory();
            skippedNumbers.forEach((item) => {
                const number = typeof item === 'string' ? item : item.number;
                const entry = history[number];
                const daysSince = entry ? ((Date.now() - entry.lastSent) / (24 * 60 * 60 * 1000)).toFixed(1) : '?';
                $(`#days-${number}`).text(`${daysSince} дн. назад`);
            });
        }, 100);
    }
    
    $("#checkerContent").html(content);
    $("#checkerStatus").text("Результаты анализа");
    $("#checkerActions").show();
    $("#checkerResultsContainer").show();
}

// Show premium simple message (warning/error)
function showSimpleMessage(message, type = "info") {
    const iconMap = {
        warning: "⚠️",
        error: "❌",
        info: "ℹ️",
        success: "✨"
    };
    
    const colorMap = {
        error: 'rgba(220, 53, 69, 0.9)',
        warning: 'rgba(255, 193, 7, 0.9)',
        success: 'rgba(40, 167, 69, 0.9)',
        info: 'rgba(55, 114, 255, 0.9)'
    };
    
    const titleMap = {
        error: 'Ошибка',
        warning: 'Предупреждение',
        success: 'Успешно',
        info: 'Информация'
    };
    
    const content = `
        <div class="premium-success-message">
            <span class="premium-success-icon">${iconMap[type] || iconMap.info}</span>
            <div class="premium-success-title" style="background: linear-gradient(135deg, ${colorMap[type]} 0%, ${colorMap[type]}CC 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;">
                ${titleMap[type] || titleMap.info}
            </div>
            <div class="premium-success-details">
                ${message}
            </div>
        </div>
    `;
    
    $("#checkerContent").html(content);
    $("#checkerStatus").text(titleMap[type] || titleMap.info);
    $("#checkerActions").hide();
    $("#checkerResultsContainer").show();
    
    // Auto-hide after 4 seconds for warnings/errors
    if (type === 'warning' || type === 'error') {
        setTimeout(() => {
            hideCheckerResults();
        }, 4000);
    }
}

// Hide checker results
function hideCheckerResults() {
    $("#checkerResultsContainer").hide();
    // Don't clear checkerData here - keep it until new check is performed
}

// Confirm and remove numbers
function confirmRemoveNumbers() {
    console.log('🔧 confirmRemoveNumbers called');
    console.log('📊 checkerData:', checkerData);
    
    // Try to restore from localStorage if checkerData is empty
    if (!checkerData || !checkerData.toSend || checkerData.toSend.length === 0) {
        try {
            const stored = localStorage.getItem('checkerData');
            if (stored) {
                checkerData = JSON.parse(stored);
                console.log('🔄 Restored checkerData from localStorage:', checkerData);
            }
        } catch (e) {
            console.error('Failed to restore from localStorage:', e);
        }
    }
    
    try {
        const { skipped, toSend } = checkerData;
        
        console.log('📊 skipped:', skipped);
        console.log('📊 toSend:', toSend);
        console.log('📊 checkerData keys:', Object.keys(checkerData));
        console.log('📊 toSend length:', toSend ? toSend.length : 'undefined');
        
        // If toSend is empty but we have skipped numbers, remove all (clear the field)
        if (!toSend || toSend.length === 0) {
            if (skipped && skipped.length > 0) {
                console.log('🧹 Removing ALL numbers (all were skipped)');
                
                // Clear the input field
                $("#inputNumbersBulk").val('');
                
                // Update global arrays
                phoneNumberSendToBulk = [];
                phoneNumbersBulk = [];
                
                // Save to storage and update view
                storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
                updateView();
                
                // Show success message
                const content = `
                    <div class="premium-success-message">
                        <span class="premium-success-icon">🗑️</span>
                        <div class="premium-success-title">Все номера удалены!</div>
                        <div class="premium-success-details">
                            Удалено <strong>${skipped.length}</strong> номеров из списка.
                        </div>
                        <div class="premium-success-subtitle">
                            Поле номеров очищено. Можете добавить новые номера.
                        </div>
                    </div>
                `;
                
                $("#checkerContent").html(content);
                $("#checkerActions").hide();
                
                // Clear stored data after successful operation
                localStorage.removeItem('checkerData');
                checkerData = { allNumbers: [], skipped: [], toSend: [] };
                
                // Auto-hide after 2.5 seconds
                setTimeout(() => {
                    hideCheckerResults();
                }, 2500);
                
                return;
            } else {
                console.error('❌ toSend is empty or undefined');
                showSimpleMessage("❌ Нет данных для обновления. Сначала выполните проверку номеров.", "error");
                return;
            }
        }
        
        // Reconstruct input with only non-skipped numbers
        const newLines = toSend.map(item => {
            if (item.originalLine) {
                return item.originalLine;
            } else {
                // Fallback: reconstruct from components
                let line = item.number;
                if (item.valueOne) line += ',' + item.valueOne;
                if (item.valueTwo) line += ',' + item.valueTwo;
                return line;
            }
        });
        const newInput = newLines.join('\n');
        
        $("#inputNumbersBulk").val(newInput);
        
        // Update global arrays with remaining numbers
        phoneNumberSendToBulk = [...toSend];
        phoneNumbersBulk = newLines;
        
        // Save to storage and update view
        storageInstance.savePhoneNumbersBulk(phoneNumbersBulk);
        updateView();
        
        // Show premium success message
        const content = `
            <div class="premium-success-message">
                <span class="premium-success-icon">🎉</span>
                <div class="premium-success-title">Операция завершена!</div>
                <div class="premium-success-details">
                    <div style="display: flex; gap: 20px; justify-content: center; margin: 16px 0;">
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: rgba(255, 193, 7, 0.9);">${skipped.length}</div>
                            <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">УДАЛЕНО</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: rgba(40, 167, 69, 0.9);">${toSend.length}</div>
                            <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">ОСТАЛОСЬ</div>
                        </div>
                    </div>
                </div>
                <div class="premium-success-subtitle">
                    Список обновлен и оптимизирован для максимальной эффективности
                </div>
            </div>
        `;
        
        $("#checkerContent").html(content);
        $("#checkerActions").hide();
        
        console.log(`🧹 Removed ${skipped.length} recent contacts, ${toSend.length} numbers remaining`);
        
        // Clear stored data after successful operation
        localStorage.removeItem('checkerData');
        checkerData = { allNumbers: [], skipped: [], toSend: [] };
        
        // Auto-hide after 2.5 seconds
        setTimeout(() => {
            hideCheckerResults();
        }, 2500);
        
    } catch (error) {
        console.error("❌ Error removing numbers:", error);
        showSimpleMessage("❌ Произошла ошибка при удалении номеров.", "error");
    }
}

// Add event listeners for checker buttons
function addCheckerEventListeners() {
    // Event listener for confirm remove button
    $(document).on('click', '#confirmRemoveBtn', function() {
        confirmRemoveNumbers();
    });
    
    // Event listeners for close/cancel buttons
    $(document).on('click', '#closeCheckerBtn, #cancelRemoveBtn', function() {
        hideCheckerResults();
    });
}

// Make functions globally available for HTML onclick handlers (backup)
window.hideCheckerResults = hideCheckerResults;
window.confirmRemoveNumbers = confirmRemoveNumbers;

// ============================================================
//  STATISTICS TAB
// ============================================================

async function refreshStatsTab() {
    if (!window.riskEngine) return;
    const stats   = await window.riskEngine.getStats();
    const history = await window.riskEngine.getFullHistory();

    // Daily card
    const dailyPct = Math.min(100, Math.round((stats.sentToday / stats.dailyLimit) * 100));
    const barColor  = dailyPct >= 100 ? '#dc3545' : dailyPct >= 67 ? '#ffc107' : '#28a745';

    $('#statSentToday').text(stats.sentToday);
    $('#statDailyLimit').text(`/ ${stats.dailyLimit} лимит`);
    $('#statDailyBar').css({ width: dailyPct + '%', background: barColor });
    $('#statDailyRemaining').text(`Осталось: ${stats.dailyRemaining}`);

    if (stats.isWarmup) {
        $('#statWarmupBadge').show();
        $('#statWarmupDay').text(`День ${stats.warmupDay} прогрева`);
    } else {
        $('#statWarmupBadge').hide();
        $('#statWarmupDay').text('');
    }

    // Session card
    const scoreColor = stats.level === 'HIGH' ? '#dc3545' : stats.level === 'MEDIUM' ? '#ffc107' : '#28a745';
    $('#statScore').text(stats.score).css('color', scoreColor);
    $('#statNewRatio').text(Math.round(stats.newContactRatio * 100) + '%');
    $('#statMsgPerHour').text(Math.round(stats.msgPerHour));
    $('#statSessionMin').text(stats.sessionMinutes);

    // History list
    const entries = Object.entries(history)
        .sort((a, b) => b[1].lastSent - a[1].lastSent)
        .slice(0, 50); // show last 50

    if (entries.length === 0) {
        $('#statsHistoryList').html('<div class="stats-empty">История пуста</div>');
    } else {
        const rows = entries.map(([number, data]) => {
            const date = new Date(data.lastSent);
            const dateStr = `${date.getDate().toString().padStart(2,'0')}.${(date.getMonth()+1).toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
            return `
                <div class="stats-history-row">
                    <span class="stats-history-number">+${number}</span>
                    <span class="stats-history-count">${data.count}x</span>
                    <span class="stats-history-date">${dateStr}</span>
                </div>`;
        }).join('');
        $('#statsHistoryList').html(rows);
    }
}

function exportHistoryCSV() {
    window.riskEngine.getFullHistory().then(history => {
        const entries = Object.entries(history)
            .sort((a, b) => b[1].lastSent - a[1].lastSent);

        if (entries.length === 0) {
            showSimpleMessage('История пуста — нечего экспортировать', 'warning');
            return;
        }

        const header = 'Номер,Количество отправок,Последняя отправка,Сообщение\n';
        const rows = entries.map(([number, data]) => {
            const date = new Date(data.lastSent).toLocaleString('ru-RU');
            const msg  = (data.message || '').replace(/,/g, ';').replace(/\n/g, ' ');
            return `+${number},${data.count},"${date}","${msg}"`;
        }).join('\n');

        const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = `itry_history_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    });
}

function initStatsTab() {
    // Refresh when tab is clicked
    $('#stats-tab').on('shown.bs.tab', refreshStatsTab);

    // Export CSV
    $(document).on('click', '#btnExportCSV', exportHistoryCSV);

    // Clear history
    $(document).on('click', '#btnClearHistory', async function() {
        if (!confirm('Очистить всю историю контактов?')) return;
        await new Promise(resolve => chrome.storage.local.remove('KEY_MESSAGE_HISTORY', resolve));
        await refreshStatsTab();
        showSimpleMessage('История очищена', 'success');
    });
}

// ---- Risk Engine UI updater ----
function updateRiskUI(stats) {
    if (!stats) return;

    const levelColors = { LOW: '#28a745', MEDIUM: '#ffc107', HIGH: '#dc3545' };
    const levelLabels = { LOW: 'Норма', MEDIUM: 'Осторожно', HIGH: 'Стоп' };
    const color = levelColors[stats.level] || '#6c757d';
    const label = levelLabels[stats.level] || stats.level;
    const ratio = Math.round(stats.newContactRatio * 100);

    const html = `
        <div class="risk-bar-container">
            <div class="risk-bar-header">
                <span>Risk Score</span>
                <span style="color:${color}; font-weight:600;">${stats.score}/100 — ${label}</span>
            </div>
            <div class="risk-bar-track">
                <div class="risk-bar-fill" style="width:${stats.score}%; background:${color};"></div>
            </div>
            <div class="risk-bar-stats">
                <span>Новых: ${stats.newContacts} (${ratio}%)</span>
                <span>Повторных: ${stats.repeatContacts}</span>
                <span>${stats.msgPerHour.toFixed(0)} msg/h</span>
            </div>
        </div>
    `;

    $('#riskIndicator').html(html).show();
}